import { LatLng } from "@/store/navStore";

export interface RoadSegment {
  id: string;
  name: string;
  poly: LatLng[]; // ordered
  bearing: number; // deg main bearing
}

// Synthetic graph retained only for the offline benchmark/playback fixtures.
// It must never be used by the live phone navigation path.
export const syntheticRoadNetwork: RoadSegment[] = [
  {
    id: "fc-road",
    name: "FC Road",
    bearing: 42,
    poly: [
      { latitude: 18.518, longitude: 73.85 },
      { latitude: 18.5204, longitude: 73.8567 },
      { latitude: 18.523, longitude: 73.861 },
      { latitude: 18.5255, longitude: 73.865 },
    ],
  },
  {
    id: "jm-road",
    name: "JM Road",
    bearing: 135,
    poly: [
      { latitude: 18.5204, longitude: 73.8567 },
      { latitude: 18.5185, longitude: 73.8605 },
      { latitude: 18.516, longitude: 73.864 },
    ],
  },
  {
    id: "ap-road",
    name: "Apte Road",
    bearing: 90,
    poly: [
      { latitude: 18.522, longitude: 73.855 },
      { latitude: 18.5215, longitude: 73.858 },
      { latitude: 18.521, longitude: 73.8615 },
    ],
  },
  {
    id: "tunnel-mock",
    name: "Underpass (GNSS denied)",
    bearing: 42,
    poly: [
      { latitude: 18.523, longitude: 73.861 },
      { latitude: 18.5245, longitude: 73.8635 },
      { latitude: 18.526, longitude: 73.866 },
    ],
  },
  {
    id: "parking-loop",
    name: "Parking Ramp",
    bearing: 180,
    poly: [
      { latitude: 18.519, longitude: 73.857 },
      { latitude: 18.5188, longitude: 73.8572 },
      { latitude: 18.5186, longitude: 73.857 },
      { latitude: 18.5188, longitude: 73.8568 },
    ],
  },
  {
    id: "synth-42",
    name: "Synth Straight 42°",
    bearing: 42,
    poly: [
      { latitude: 18.5204, longitude: 73.8567 },
      { latitude: 18.523747, longitude: 73.859876 },
      { latitude: 18.527094, longitude: 73.863052 },
      { latitude: 18.530441, longitude: 73.866228 },
      { latitude: 18.533788, longitude: 73.869404 },
      { latitude: 18.537135, longitude: 73.87258 },
    ],
  },
];

// Live navigation has no hard-coded FC/JM/Apte route. A real road graph can be
// injected later from OSM/MBTiles; until then map matching safely returns the
// raw GNSS/INS position instead of snapping to a fictional Pune route.
export const roadNetwork: RoadSegment[] = [];

// utility: haversine meters
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6378137;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// project point onto segment a-b, return closest point + t 0-1
export function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number; dist: number } {
  // equirectangular approx for small distances (~km)
  const R = 6378137;
  const lat0 = (p.latitude * Math.PI) / 180;
  const xP = ((p.longitude - a.longitude) * Math.PI) / 180 * Math.cos(lat0) * R;
  const yP = ((p.latitude - a.latitude) * Math.PI) / 180 * R;
  const xB = ((b.longitude - a.longitude) * Math.PI) / 180 * Math.cos(lat0) * R;
  const yB = ((b.latitude - a.latitude) * Math.PI) / 180 * R;
  const len2 = xB * xB + yB * yB;
  let t = len2 === 0 ? 0 : (xP * xB + yP * yB) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj: LatLng = {
    latitude: a.latitude + t * (b.latitude - a.latitude),
    longitude: a.longitude + t * (b.longitude - a.longitude),
  };
  return { point: proj, t, dist: haversine(p, proj) };
}
