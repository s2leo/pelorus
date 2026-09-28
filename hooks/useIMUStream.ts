import { useEffect, useRef, useState, useCallback } from "react";
import { Accelerometer, Gyroscope, Magnetometer } from "expo-sensors";
import { Platform } from "react-native";
import { RingBuffer, Sample3 } from "@/engine/buffer";
import { createFilterState, filterSample } from "@/engine/vibrationFilter";
import { rotateToVehicle, gravityCompensate } from "@/engine/orientation";
import { createSpeedState, estimateSpeed } from "@/engine/speedEstimator";
import { useNavStore } from "@/store/navStore";
import { useImuStore } from "@/store/imuStore";
import { neuralIdr } from "@/engine/neuralIdr";

export interface StreamOutput {
  forwardAcc: number; // m/s² vehicle forward after filter+gravity
  gyroYaw: number; // rad/s z vehicle
  speed: number; // m/s est
  isPothole: boolean;
  isVibration: boolean;
  raw: Sample3;
  filtered: Sample3;
  neuralSpeed?: number;
  neuralAcceleration?: number;
  neuralConfidence?: number;
}

// singleton buffers shared across all hook instances (tabs) — prevents double drift
const globalFilter = createFilterState();
const globalSpeed = createSpeedState();
const globalAccelBuf = new RingBuffer(512);
const globalGyroBuf = new RingBuffer(512);

export function useIMUStream(enabled: boolean, targetFilterHz = 10, neuralEnabled = false) {
  const filterRef = useRef(globalFilter);
  const speedRef = useRef(globalSpeed);
  const accelBufRef = useRef(globalAccelBuf);
  const gyroBufRef = useRef(globalGyroBuf);

  const [output, setOutput] = useState<StreamOutput>({
    forwardAcc: 0,
    gyroYaw: 0,
    speed: 0,
    isPothole: false,
    isVibration: false,
    raw: { x: 0, y: 0, z: 9.81, t: Date.now() },
    filtered: { x: 0, y: 0, z: 9.81, t: Date.now() },
  });

  const [running, setRunning] = useState(false);
  const lastFilterAtRef = useRef(0);
  const rawCountRef = useRef(0);
  const lastRateAtRef = useRef(Date.now());
  const latestMagRef = useRef({ x: 0, y: 0, z: 0 });
  const gravityRef = useRef({ x: 0, y: 0, z: 9.81 });

  const onRaw = useCallback(
    (type: "accel" | "gyro", data: { x: number; y: number; z: number }) => {
      const sample: Sample3 = { x: data.x, y: data.y, z: data.z, t: Date.now() };
      if (type === "accel") accelBufRef.current.push(sample);
      else gyroBufRef.current.push(sample);
      rawCountRef.current++;

      // throttle filter to targetHz
      const now = Date.now();
      const interval = 1000 / targetFilterHz;
      if (now - lastFilterAtRef.current < interval) return;
      lastFilterAtRef.current = now;

      const store = useNavStore.getState();
      const imuStore = useImuStore.getState();

      // latest raw
      const latestAcc = accelBufRef.current.latest() ?? sample;
      const latestGyro = gyroBufRef.current.latest() ?? { x: 0, y: 0, z: 0, t: now };
      const mag = latestMagRef.current;
      gravityRef.current = {
        x: gravityRef.current.x * 0.9 + latestAcc.x * 0.1,
        y: gravityRef.current.y * 0.9 + latestAcc.y * 0.1,
        z: gravityRef.current.z * 0.9 + latestAcc.z * 0.1,
      };

      // filter step (single sample; batch already collapsed via EMA)
      const { filtered, isPothole, isVibration } = filterSample(latestAcc, filterRef.current);

      // rotate to vehicle frame using calibration
      const euler = { pitch: store.pitch, roll: store.roll, yaw: store.yaw };
      const accVeh = rotateToVehicle(filtered, euler);
      const gyroVeh = rotateToVehicle(latestGyro, euler);
      const accComp = gravityCompensate(accVeh);

      // speed est
      const dt = 1 / targetFilterHz;
      const gyroNorm = Math.sqrt(gyroVeh.x ** 2 + gyroVeh.y ** 2 + gyroVeh.z ** 2);
      const sState = speedRef.current;
      estimateSpeed(accComp.x, gyroNorm, dt, sState);

      // update diagnostics store throttled
      const sinceRate = now - lastRateAtRef.current;
      if (sinceRate > 500) {
        const rawHz = (rawCountRef.current / sinceRate) * 1000 / 2; // accel+gyro counted, divide 2 for per-sensor Hz
        imuStore.setRates(Math.round(rawHz), targetFilterHz);
        imuStore.setDiagnostics({
          bufferFill: accelBufRef.current.length,
          forwardAcc: accComp.x,
          speedEst: sState.speed,
          bias: sState.bias,
          stationaryProb: sState.stationaryProb,
          vibrationFlag: isVibration,
          vibeRms: filterRef.current.vibeRms,
          lastFilteredAt: now,
          rateHz: rawHz,
        });
        rawCountRef.current = 0;
        lastRateAtRef.current = now;
      }
      if (isPothole) imuStore.incPothole();

      const baseOutput = {
        forwardAcc: accComp.x,
        gyroYaw: gyroVeh.z,
        speed: sState.speed,
        isPothole,
        isVibration,
        raw: latestAcc,
        filtered,
      };
      setOutput(baseOutput);
      if (neuralEnabled) {
        const features = [latestAcc.x, latestAcc.y, latestAcc.z,
          gravityRef.current.x, gravityRef.current.y, gravityRef.current.z,
          latestGyro.x, latestGyro.y, latestGyro.z, mag.x, mag.y, mag.z];
        void neuralIdr.infer(features).then((result) => {
          if (!result) return;
          setOutput((previous) => ({ ...previous, neuralSpeed: result.speed,
            neuralAcceleration: result.acceleration, neuralConfidence: result.confidence }));
        });
      }
    },
    [targetFilterHz, neuralEnabled]
  );

  useEffect(() => {
    if (!enabled) return;
    if (Platform.OS === "web") {
      // web mock at 100Hz raw → filtered at targetHz already via onRaw throttling
      setRunning(true);
      let t = 0;
      const id = setInterval(() => {
        t += 0.01;
        const mockAcc = {
          x: Math.sin(t * 3) * 0.45 + (Math.random() - 0.5) * 0.25,
          y: Math.cos(t * 2.2) * 0.2 + (Math.random() - 0.5) * 0.15,
          z: 9.81 + Math.sin(t * 8) * 0.18 + (Math.random() - 0.5) * 0.2 + (Math.random() < 0.008 ? 8 : 0),
        };
        const mockGyro = {
          x: Math.sin(t * 1.5) * 0.015,
          y: Math.cos(t * 1.2) * 0.015,
          z: Math.sin(t * 0.8) * 0.03 + (Math.random() - 0.5) * 0.008,
        };
        onRaw("accel", mockAcc);
        onRaw("gyro", mockGyro);
      }, 10); // 100Hz
      return () => {
        clearInterval(id);
        setRunning(false);
      };
    }

    let accSub: any, gyroSub: any, magSub: any;
    (async () => {
      const aAvail = await Accelerometer.isAvailableAsync().catch(() => false);
      const gAvail = await Gyroscope.isAvailableAsync().catch(() => false);
      if (!aAvail && !gAvail) {
        setRunning(false);
        return;
      }
      setRunning(true);
      Accelerometer.setUpdateInterval(10); // 100Hz
      Gyroscope.setUpdateInterval(10);
      Magnetometer.setUpdateInterval(10);
      accSub = Accelerometer.addListener((d) => onRaw("accel", d));
      gyroSub = Gyroscope.addListener((d) => onRaw("gyro", d));
      magSub = Magnetometer.addListener((d) => { latestMagRef.current = { x: d.x, y: d.y, z: d.z }; });
    })();

    return () => {
      accSub?.remove();
      gyroSub?.remove();
      magSub?.remove();
      setRunning(false);
    };
  }, [enabled, onRaw]);

  return { output, running, filterState: filterRef.current, speedState: speedRef.current };
}
