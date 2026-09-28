import { useEffect, useRef } from "react";
import { useNavStore } from "@/store/navStore";
import { fuse } from "@/engine/fusion";
import { useGNSS } from "./useGNSS";
import { useIMUStream } from "./useIMUStream";
import { matchPosition } from "@/engine/mapMatcher";
import { haversine } from "@/engine/roadNetwork";

export function useFusionLoop(enabled: boolean) {
  const { pos: gnssPos } = useGNSS(enabled);
  const isOutageSim = useNavStore((state) => state.isOutageSim);
  // Do not start native ONNX while location permission/fix is still loading.
  // A missing first fix is an initialization state, not a confirmed outage.
  const gnssPoor = isOutageSim || (!!gnssPos && (gnssPos.coords.accuracy ?? 999) > 25);
  const { output } = useIMUStream(enabled, 10, gnssPoor);
  const lastAtRef = useRef(Date.now());
  const fusedRef = useRef({ lat: 18.5204, lon: 73.8567, heading: 42 });
  // The sensor stream changes many times per second. Keep the latest values in
  // refs so the navigation timer is not torn down and recreated on every IMU
  // sample (which can create a React/Zustand update loop).
  const outputRef = useRef(output);
  const gnssPosRef = useRef(gnssPos);
  const outageRef = useRef(isOutageSim);
  outputRef.current = output;
  gnssPosRef.current = gnssPos;
  outageRef.current = isOutageSim;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastAtRef.current) / 1000;
      lastAtRef.current = now;
      const store = useNavStore.getState();

      // GNSS gating: OUTAGE sim overrides real fix
      const currentOutput = outputRef.current;
      const currentGnssPos = gnssPosRef.current;
      const isOutage = outageRef.current;
      const rawGnss = !isOutage && currentGnssPos
        ? {
            lat: currentGnssPos.coords.latitude,
            lon: currentGnssPos.coords.longitude,
            accuracy: currentGnssPos.coords.accuracy ?? 5,
            speed: currentGnssPos.coords.speed ?? undefined,
          }
        : undefined;
      // AI is deliberately gated: good GNSS always remains authoritative.
      const gnss = rawGnss && rawGnss.accuracy <= 25 ? rawGnss : undefined;

      // --- step 1: EKF predict + GNSS correct (if available)
      const res = fuse({
        accel: { x: currentOutput.forwardAcc, y: 0, z: 9.81 },
        gyro: { x: 0, y: 0, z: currentOutput.gyroYaw },
        gnss,
        dt,
      });

      let heading = res.heading;
      if (!gnss) heading = (heading + currentOutput.gyroYaw * dt * (180 / Math.PI) * 0.9) % 360;
      if (heading < 0) heading += 360;

      const speed = !gnss && currentOutput.neuralSpeed != null
        ? currentOutput.neuralSpeed
        : (currentOutput.speed > 0 ? currentOutput.speed : res.speed);
      fusedRef.current = { lat: res.lat, lon: res.lon, heading };

      store.setSpeed(speed);
      store.setGnssStatus(gnss ? "FIX" : rawGnss ? "FLOAT" : "OUTAGE");
      store.setFusionMode(res.mode);

      // raw point with INS noise (blow up when GNSS denied / pothole)
      const raw = {
        latitude: res.lat + (currentOutput.isPothole ? 0.00002 : 0) + (Math.random() - 0.5) * (gnss ? 0 : 0.000035),
        longitude: res.lon + (Math.random() - 0.5) * (gnss ? 0 : 0.000035),
      };

      // --- step 2: HMM map-match with NHC
      const matched = matchPosition(raw, heading, speed, !!gnss);
      let snapped = matched.snapped;
      let displayPos = matched.isSnapped ? snapped : raw;
      let displayHeading = heading;

      if (matched.isSnapped && matched.candidate && matched.candidate.bearingDiff < 20) {
        const roadBrg = matched.candidate.bearing;
        let diff = ((roadBrg - heading + 540) % 360) - 180;
        displayHeading = (heading + diff * 0.3 + 360) % 360;
      }

      // --- step 3: EKF map-pseudo correction when GNSS denied but snapped (reduces lateral drift)
      if (!gnss && matched.isSnapped) {
        const conf = Math.max(0, 1 - matched.rawDist / 25);
        const corr = fuse({
          accel: { x: 0, y: 0, z: 0 },
          gyro: { x: 0, y: 0, z: 0 },
          mapPseudo: { lat: matched.snapped.latitude, lon: matched.snapped.longitude, dist: matched.rawDist, confidence: conf },
          dt: 0,
        });
        // blend display toward EKF-corrected (which is Kmap blended)
        displayPos = { latitude: corr.lat, longitude: corr.lon };
        snapped = displayPos; // trail snapped follows EKF not pure projection, tighter
      }

      store.setPosition(displayPos);
      store.setHeading(displayHeading);
      store.setSnap(matched.candidate?.name ?? null, matched.rawDist, matched.isSnapped);

      store.appendTrail(raw, snapped);

      // distance & drift: dist += speed*dt, drift = haversine(raw,snapped) bounded by map, else GNSS decay
      if (!gnss) {
        const prev = useNavStore.getState().distanceTravelled;
        const nextDist = prev + speed * dt;
        const err = haversine(raw, snapped); // proxy ground truth when no GT (snapped close to truth)
        // smooth drift with EMA to avoid jitter
        const prevDrift = useNavStore.getState().drift;
        const drift = prevDrift * 0.85 + err * 0.15;
        const pct = nextDist > 0 ? (drift / nextDist) * 100 : 0;
        useNavStore.setState({ distanceTravelled: nextDist, drift, driftPct: pct });
      } else {
        const s = useNavStore.getState();
        // GNSS fix: snap drift toward 0 with decay, but keep distance
        const nextDist = s.distanceTravelled + speed * dt;
        const drift = s.drift * 0.92;
        const pct = nextDist > 0 ? (drift / nextDist) * 100 : 0;
        useNavStore.setState({ distanceTravelled: nextDist, drift, driftPct: pct, accuracy: gnss.accuracy });
      }
    }, 100); // 10Hz

    return () => clearInterval(id);
  }, [enabled]);

  return { fused: fusedRef.current, imu: output, gnssPos };
}
