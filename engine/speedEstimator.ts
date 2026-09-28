import { Sample3 } from "./buffer";

export interface SpeedState {
  speed: number; // m/s forward
  bias: number; // accel bias estimate
  stationaryProb: number; // 0-1
  lastUpdateAt: number;
}

export function createSpeedState(): SpeedState {
  return { speed: 6.5, bias: 0.04, stationaryProb: 0, lastUpdateAt: Date.now() };
}

// Lightweight warm-up/fallback estimator. The production path uses the
// offline CNN+GRU in engine/neuralIdr.ts whenever GNSS quality is poor; this
// fallback keeps the first 2-second model window responsive.
export function estimateSpeed(
  forwardAcc: number, // m/s² vehicle x after gravity-comp & orientation, gated
  gyroNorm: number, // rad/s
  dt: number, // s
  state: SpeedState
): SpeedState {
  const now = Date.now();

  // Zero-velocity detection: low accel variance + low gyro + speed already low
  const isStationaryCandidate = Math.abs(forwardAcc) < 0.35 && gyroNorm < 0.08 && state.speed < 0.8;
  if (isStationaryCandidate) {
    state.stationaryProb = Math.min(1, state.stationaryProb + dt * 2.5);
  } else {
    state.stationaryProb = Math.max(0, state.stationaryProb - dt * 4);
  }

  if (state.stationaryProb > 0.7) {
    // ZUPT: snap speed to 0, learn bias
    state.bias = 0.9 * state.bias + 0.1 * forwardAcc;
    state.speed = Math.max(0, state.speed * 0.6 - 0.02);
    if (state.speed < 0.12) state.speed = 0;
  } else {
    // integrate with bias correction
    const accCorr = forwardAcc - state.bias;
    state.speed += accCorr * dt;

    // drag very light: 0.1% per second equivalent (pow handles variable dt)
    state.speed *= Math.pow(0.999, dt);

    // clamp
    if (state.speed < 0) state.speed = 0;
    if (state.speed > 35) state.speed = 35; // 126 kph cap

    // bias adapt slowly when moving straight
    if (Math.abs(gyroNorm) < 0.25) {
      state.bias += accCorr * 0.0008;
    }
  }

  state.lastUpdateAt = now;
  return state;
}

// windowed estimator for 10Hz decimation from 100Hz samples
export function estimateFromWindow(
  forwardAccWindow: Sample3[],
  gyroWindow: Sample3[],
  state: SpeedState
): number {
  if (forwardAccWindow.length === 0) return state.speed;
  const dt = 0.01; // 100Hz
  for (let i = 0; i < forwardAccWindow.length; i++) {
    const fwd = forwardAccWindow[i].x; // already vehicle-frame
    const g = Math.sqrt(gyroWindow[i].x ** 2 + gyroWindow[i].y ** 2 + gyroWindow[i].z ** 2);
    estimateSpeed(fwd, g, dt, state);
  }
  return state.speed;
}
