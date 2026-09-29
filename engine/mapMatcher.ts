import { LatLng } from "@/store/navStore";
import { RoadSegment, roadNetwork, haversine, bearing, projectOnSegment } from "./roadNetwork";

export interface MatchCandidate {
  segmentId: string;
  name: string;
  point: LatLng;
  dist: number; // meters to road
  bearing: number; // road bearing deg
  bearingDiff: number; // deg
  score: number;
}

export interface MatchResult {
  snapped: LatLng;
  candidate: MatchCandidate | null;
  isSnapped: boolean;
  rawDist: number;
  usedHMM: boolean;
}

let prevMatched: LatLng | null = null;
let prevSegmentId: string | null = null;

const SIGMA = 18; // emission std meters
const MAX_SNAP_M = 50; // beyond -> no snap, keep raw (NHC still)
const HEADING_TOL = 60; // deg

function headingDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

export function matchPosition(
  raw: LatLng,
  heading: number,
  _speed: number,
  gnssAvailable: boolean,
  network: RoadSegment[] = roadNetwork,
): MatchResult {
  // GNSS available: moderate snap, GNSS denied: allow larger to keep road lock
  const maxSnap = gnssAvailable ? 35 : MAX_SNAP_M;

  let best: MatchCandidate | null = null;

  for (const seg of network) {
    for (let i = 0; i < seg.poly.length - 1; i++) {
      const a = seg.poly[i];
      const b = seg.poly[i + 1];
      const { point, dist } = projectOnSegment(raw, a, b);
      const segBear = bearing(a, b);
      const hDiff = headingDiff(heading, segBear);
      // NHC: car cannot be sideways >90°, bias score
      if (hDiff > 90) continue;

      // transition penalty: prefer same segment as prev (HMM)
      const transitionBonus = prevSegmentId === seg.id ? 8 : 0;
      const emission = -0.5 * (dist / SIGMA) ** 2;
      const headingPenalty = -0.5 * (hDiff / 30) ** 2;
      const score = emission + headingPenalty + transitionBonus / 10;

      if (!best || score > best.score) {
        best = { segmentId: seg.id, name: seg.name, point, dist, bearing: segBear, bearingDiff: hDiff, score };
      }
    }
  }

  if (!best) {
    return { snapped: raw, candidate: null, isSnapped: false, rawDist: 0, usedHMM: false };
  }

  const distOk = best.dist <= maxSnap;
  const headingOk = best.bearingDiff <= HEADING_TOL;

  // if GNSS available, require stricter heading when snapping
  if (gnssAvailable && !headingOk) {
    return { snapped: raw, candidate: best, isSnapped: false, rawDist: best.dist, usedHMM: true };
  }

  if (distOk && headingOk) {
    // hysteresis: if previously snapped, prefer staying even if second best close
    // simple: accept best
    prevMatched = best.point;
    prevSegmentId = best.segmentId;
    return { snapped: best.point, candidate: best, isSnapped: true, rawDist: best.dist, usedHMM: true };
  }

  // fallback: if raw very close to prev snapped (<20m) keep prev projection (avoid jump)
  if (prevMatched && haversine(raw, prevMatched) < 20) {
    return { snapped: prevMatched, candidate: best, isSnapped: true, rawDist: best.dist, usedHMM: true };
  }

  return { snapped: raw, candidate: best, isSnapped: false, rawDist: best.dist, usedHMM: true };
}

export function resetMatcher() {
  prevMatched = null;
  prevSegmentId = null;
}

export function getRoadName(snapped: MatchCandidate | null): string {
  return snapped?.name ?? "Off-road";
}
