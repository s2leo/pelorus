import { create } from "zustand";

export type GnssStatus = "FIX" | "FLOAT" | "OUTAGE";
export type FusionMode = "GNSS" | "IDR" | "FUSION";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface NavState {
  // position
  position: LatLng;
  heading: number;
  speed: number; // m/s
  accuracy: number; // m
  gnssStatus: GnssStatus;
  fusionMode: FusionMode;

  // drift metrics
  distanceTravelled: number; // m
  drift: number; // m
  driftPct: number; // %

  // outage control
  isOutageSim: boolean;
  outageStartAt: number | null;
  outageDistance: number;

  // calibration
  calibrationDone: boolean;
  pitch: number;
  roll: number;
  yaw: number;
  calibConfidence: number;
  lastCalibAt: number | null;
  mountShiftDetected: boolean;

  // trajectory buffers
  rawTrail: LatLng[];
  snappedTrail: LatLng[];
  snapRoad: string | null;
  snapDist: number;
  isSnapped: boolean;

  // actions
  setPosition: (p: LatLng) => void;
  setHeading: (h: number) => void;
  setSpeed: (s: number) => void;
  setGnssStatus: (s: GnssStatus) => void;
  setFusionMode: (m: FusionMode) => void;
  appendTrail: (raw: LatLng, snapped: LatLng) => void;
  startOutageSim: () => void;
  stopOutageSim: () => void;
  setCalibration: (done: boolean, pitch: number, roll: number, yaw: number, confidence?: number) => void;
  setMountShift: (v: boolean) => void;
  setSnap: (road: string | null, dist: number, isSnapped: boolean) => void;
  reset: () => void;
}

const PUNE_CENTER: LatLng = { latitude: 18.5204, longitude: 73.8567 };

export const useNavStore = create<NavState>((set, get) => ({
  position: PUNE_CENTER,
  heading: 42,
  speed: 0,
  accuracy: 3.2,
  gnssStatus: "FIX",
  fusionMode: "GNSS",
  distanceTravelled: 0,
  drift: 0,
  driftPct: 0,
  isOutageSim: false,
  outageStartAt: null,
  outageDistance: 0,
  calibrationDone: false,
  pitch: 2.1,
  roll: -0.8,
  yaw: 4.5,
  calibConfidence: 0,
  lastCalibAt: null,
  mountShiftDetected: false,
  // Live app starts with empty trails; positions are populated from GNSS/IMU.
  // No synthetic FC Road/JM Road route is shown by default.
  rawTrail: [],
  snappedTrail: [],
  snapRoad: null,
  snapDist: 0,
  isSnapped: false,

  setPosition: (p) => set({ position: p }),
  setHeading: (h) => set({ heading: h }),
  setSpeed: (s) => set({ speed: s }),
  setGnssStatus: (s) => set({ gnssStatus: s }),
  setFusionMode: (m) => set({ fusionMode: m }),
  appendTrail: (raw, snapped) =>
    set((st) => ({
      rawTrail: [...st.rawTrail.slice(-200), raw],
      snappedTrail: [...st.snappedTrail.slice(-200), snapped],
    })),
  startOutageSim: () =>
    set({
      isOutageSim: true,
      gnssStatus: "OUTAGE",
      fusionMode: "IDR",
      outageStartAt: Date.now(),
    }),
  stopOutageSim: () =>
    set({
      isOutageSim: false,
      gnssStatus: "FIX",
      fusionMode: "GNSS",
      outageStartAt: null,
      outageDistance: 0,
    }),
  setCalibration: (done, pitch, roll, yaw, confidence = 0.92) =>
    set({ calibrationDone: done, pitch, roll, yaw, calibConfidence: confidence, lastCalibAt: done ? Date.now() : null, mountShiftDetected: false }),
  setMountShift: (v) => set({ mountShiftDetected: v }),
  setSnap: (road, dist, isSnapped) => set({ snapRoad: road, snapDist: dist, isSnapped }),
  reset: () =>
    set({
      position: PUNE_CENTER,
      rawTrail: [],
      snappedTrail: [],
      distanceTravelled: 0,
      drift: 0,
      driftPct: 0,
      snapRoad: null,
      snapDist: 0,
      isSnapped: false,
    }),
}));
