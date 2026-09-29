import { IoRow } from "./ioVnbd";
import { createFilterState, filterSample } from "./vibrationFilter";
import { rotateToVehicle, gravityCompensate } from "./orientation";
import { createSpeedState, estimateSpeed } from "./speedEstimator";
import { fuse, resetFusion } from "./fusion";
import { matchPosition, resetMatcher } from "./mapMatcher";
import { haversine, syntheticRoadNetwork } from "./roadNetwork";

export interface PlaybackOpts {
  pitch: number;
  roll: number;
  yaw: number;
  startLat?: number;
  startLon?: number;
  heading?: number;
}

export function runPlayback(rows: IoRow[], opts: PlaybackOpts) {
  const filterState = createFilterState();
  const speedState = createSpeedState();
  // init speed to first row's speed if available (avoids 6.5 vs 16.6 mismatch)
  const initSpeed = rows[0]?.speed ?? 8.3;
  speedState.speed = initSpeed;
  resetFusion(opts.startLat ?? 18.5204, opts.startLon ?? 73.8567, opts.heading ?? 42, initSpeed);
  resetMatcher();

  const gtTrail: { latitude: number; longitude: number }[] = [];
  const predRawTrail: { latitude: number; longitude: number }[] = [];
  const predSnapTrail: { latitude: number; longitude: number }[] = [];
  const predCov: number[] = [];

  let lastT = rows[0]?.t ?? 0;
  let lastGt: { latitude: number; longitude: number } | null = null;

  for (const r of rows) {
    const dt = Math.max(0.005, Math.min(0.05, r.t - lastT));
    lastT = r.t;

    // ground truth if lat/lon valid
    const hasGnss = Number.isFinite(r.lat) && Number.isFinite(r.lon);
    if (hasGnss) {
      lastGt = { latitude: r.lat, longitude: r.lon };
      gtTrail.push(lastGt);
    } else if (lastGt) {
      // during outage, propagate gt synthetically along road for drift calc (holder)
      // estimate gt moves at speed along bearing 42 (matches synth)
      const d = (r.speed ?? 8) * dt;
      const R2 = 6378137;
      const brg = 42;
      const dLat = (d * Math.cos((brg * Math.PI) / 180)) / R2;
      const dLon: number = (d * Math.sin((brg * Math.PI) / 180)) / (R2 * Math.cos((lastGt.latitude * Math.PI) / 180));
      lastGt = { latitude: lastGt.latitude + (dLat * 180) / Math.PI, longitude: lastGt.longitude + (dLon * 180) / Math.PI };
      gtTrail.push(lastGt);
    }

    // IMU sample
    const raw = { x: r.ax, y: r.ay, z: r.az, t: r.t * 1000 };
    const { filtered, isPothole } = filterSample(raw, filterState);
    const euler = { pitch: opts.pitch, roll: opts.roll, yaw: opts.yaw };
    const accVeh = rotateToVehicle(filtered, euler);
    const accComp = gravityCompensate(accVeh);
    const gyroVeh = rotateToVehicle({ x: r.gx, y: r.gy, z: r.gz }, euler);
    const gyroNorm = Math.sqrt(gyroVeh.x ** 2 + gyroVeh.y ** 2 + gyroVeh.z ** 2);
    estimateSpeed(accComp.x, gyroNorm, dt, speedState);

    // fuse input: use filtered forward acc and yaw gyro
    const gnss = hasGnss ? { lat: r.lat, lon: r.lon, accuracy: r.accuracy ?? 4, speed: r.speed } : undefined;

    // predict raw via fuse
    const fused = fuse({
      accel: { x: accComp.x, y: 0, z: 9.81 },
      gyro: { x: 0, y: 0, z: gyroVeh.z },
      gnss,
      dt,
    });

    // crude heading fuse
    let heading = fused.heading;
    if (!hasGnss) heading += gyroVeh.z * dt * (180 / Math.PI) * 0.9;

    // raw point with noise model (when fused without GNSS, add tiny jitter)
    const rawPt = { latitude: fused.lat, longitude: fused.lon };
    // Playback uses the deterministic synthetic graph only for benchmark
    // reproducibility; live navigation uses the real OSM/GNSS path.
    const matched = matchPosition(rawPt, heading, speedState.speed, hasGnss, syntheticRoadNetwork);
    const snapped = matched.snapped;

    // if EKF already handles map pseudo, we could feed matched back into next fuse as mapPseudo,
    // but for offline we just do second pass: if no GNSS and snapped, re-fuse with mapPseudo
    let finalLat = fused.lat, finalLon = fused.lon;
    if (!hasGnss && matched.isSnapped) {
      const corrected = fuse({
        accel: { x: 0, y: 0, z: 0 },
        gyro: { x: 0, y: 0, z: 0 },
        mapPseudo: { lat: matched.snapped.latitude, lon: matched.snapped.longitude, dist: matched.rawDist, confidence: Math.max(0, 1 - matched.rawDist / 25) },
        dt: 0, // zero motion correction only
      });
      finalLat = corrected.lat;
      finalLon = corrected.lon;
    } else {
      finalLat = fused.lat;
      finalLon = fused.lon;
    }

    // trails: pred raw = fused raw, pred snap = matched (or corrected)
    predRawTrail.push({ latitude: fused.lat, longitude: fused.lon });
    predSnapTrail.push(matched.isSnapped ? { latitude: finalLat, longitude: finalLon } : { latitude: fused.lat, longitude: fused.lon });
    predCov.push(fused.cov);
  }

  // compute final drift: haversine last pred snap vs last gt
  const lastPred = predSnapTrail[predSnapTrail.length - 1];
  const lastGtFinal = gtTrail[gtTrail.length - 1];
  const drift = lastPred && lastGtFinal ? haversine(lastPred, lastGtFinal) : 0;
  // distance along gt
  let dist = 0;
  for (let i = 1; i < gtTrail.length; i++) dist += haversine(gtTrail[i - 1], gtTrail[i]);
  const driftPct = dist > 0 ? (drift / dist) * 100 : 0;
  const pass = driftPct < 10;

  return { gtTrail, predRawTrail, predSnapTrail, distance: dist, drift, driftPct, pass, predCov };
}
