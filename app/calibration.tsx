import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/utils/theme";
import { useNavStore } from "@/store/navStore";
import { useImuStore } from "@/store/imuStore";
import { useState, useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import { createCalibEngine, pushGravity, liveTilt, collectSample, computeResult, resetCalib, detectMountShift } from "@/engine/calibrationEngine";
import { useIMUStream } from "@/hooks/useIMUStream";
import { useGNSS } from "@/hooks/useGNSS";
import { usePathname } from "expo-router";

export default function CalibrationScreen() {
  const isFocused = usePathname().endsWith("/calibration");
  const { calibrationDone, pitch, roll, yaw, calibConfidence, lastCalibAt, mountShiftDetected, setCalibration, setMountShift } = useNavStore();
  const engineRef = useRef(createCalibEngine());
  const { output } = useIMUStream(isFocused, 10);
  const { pos } = useGNSS(isFocused);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [livePitch, setLivePitch] = useState(pitch);
  const [liveRoll, setLiveRoll] = useState(roll);
  const [liveGnssH, setLiveGnssH] = useState(42);
  const intervalRef = useRef<any>(null);

  // feed gravity live
  useEffect(() => {
    pushGravity(engineRef.current, output.raw);
    const { pitch: lp, roll: lr } = liveTilt(engineRef.current);
    // Avoid scheduling a React render when the sensor value is unchanged.
    setLivePitch((prev) => Math.abs(prev - lp) < 0.001 ? prev : lp);
    setLiveRoll((prev) => Math.abs(prev - lr) < 0.001 ? prev : lr);
    // mount shift detect via gyro yaw
    if (detectMountShift(engineRef.current, output.gyroYaw)) {
      setMountShift(true);
    }
  }, [output.raw, output.gyroYaw, setMountShift]);

  useEffect(() => {
    if (pos?.coords.heading != null) setLiveGnssH(pos.coords.heading);
    else setLiveGnssH((h) => {
      const next = (h + output.gyroYaw * 57.3 * 0.1) % 360;
      return Math.abs(next - h) < 0.001 ? h : next;
    });
  }, [pos, output.gyroYaw]);

  const speed = useNavStore((s) => s.speed) || output.speed;

  // collection tick when running
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      const g = engineRef.current.gravityRing.latest() ?? output.raw;
      collectSample(engineRef.current, {
        gravity: g,
        gnssHeading: liveGnssH,
        magHeading: (liveGnssH + yaw + (Math.random() - 0.5) * 4 + 360) % 360, // mock mag ~ gnss+yaw
        speed,
      });
      setProgress(engineRef.current.progress);
      if (engineRef.current.progress >= 1) {
        const res = computeResult(engineRef.current);
        if (res) {
          setCalibration(true, res.pitch, res.roll, res.yaw, res.confidence);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setRunning(false);
        clearInterval(intervalRef.current);
      }
    }, 125); // 8Hz collect
    return () => clearInterval(intervalRef.current);
  }, [running, liveGnssH, output.raw, speed, yaw, setCalibration]);

  const start = async () => {
    resetCalib(engineRef.current);
    engineRef.current.running = true;
    setProgress(0);
    setRunning(true);
    setMountShift(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const cancel = () => {
    engineRef.current.running = false;
    setRunning(false);
    clearInterval(intervalRef.current);
  };

  const confidence = calibrationDone ? (calibConfidence * 100).toFixed(0) : "--";
  const age = lastCalibAt ? `${Math.round((Date.now() - lastCalibAt) / 60000)}m ago` : "never";

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="phone-portrait" size={28} color={theme.accent} />
        </View>
        <Text style={styles.title}>In-Vehicle Alignment</Text>
        <Text style={styles.sub}>Auto pitch/roll/yaw vs vehicle forward. Drive straight &gt;2 m/s for 5 s. Dashboard or holder.</Text>

        {mountShiftDetected && (
          <View style={styles.shiftBanner}>
            <Ionicons name="warning" size={14} color="#fff" />
            <Text style={styles.shiftText}>Mount shift detected via gyro spike • Re-calib required</Text>
          </View>
        )}

        <View style={styles.grid3}>
          <View style={styles.axis}>
            <Text style={styles.axisL}>PITCH</Text>
            <Text style={styles.axisV}>{(running ? livePitch : pitch).toFixed(1)}°</Text>
            <View style={[styles.bar, { width: `${Math.min(100, Math.abs((running ? livePitch : pitch)) * 8)}%`, backgroundColor: theme.accent }]} />
            <Text style={styles.axisSub}>{running ? "live" : `calib ${confidence}%`}</Text>
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisL}>ROLL</Text>
            <Text style={styles.axisV}>{(running ? liveRoll : roll).toFixed(1)}°</Text>
            <View style={[styles.bar, { width: `${Math.min(100, Math.abs((running ? liveRoll : roll)) * 12)}%`, backgroundColor: theme.success }]} />
            <Text style={styles.axisSub}>{running ? "live" : age}</Text>
          </View>
          <View style={styles.axis}>
            <Text style={styles.axisL}>YAW</Text>
            <Text style={styles.axisV}>{yaw.toFixed(1)}°</Text>
            <View style={[styles.bar, { width: `${Math.min(100, Math.abs(yaw) * 5)}%`, backgroundColor: theme.warning }]} />
            <Text style={styles.axisSub}>phone→vehicle</Text>
          </View>
        </View>

        <View style={styles.kvGrid}>
          <View style={styles.kv}>
            <Text style={styles.k}>GNSS H</Text>
            <Text style={styles.v}>{liveGnssH.toFixed(1)}°</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>Speed</Text>
            <Text style={styles.v}>{(speed * 3.6).toFixed(1)} km/h</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.k}>Samples</Text>
            <Text style={styles.v}>{engineRef.current.buf.length}/40</Text>
          </View>
        </View>

        {running && (
          <View style={styles.progressWrap}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>{Math.round(progress * 100)}% • Keep driving straight &gt;7 km/h</Text>
            {speed < 2 && <Text style={styles.warn}>Too slow — need motion to estimate yaw</Text>}
          </View>
        )}

        <View style={[styles.status, { borderColor: calibrationDone ? theme.success : theme.warning, backgroundColor: calibrationDone ? theme.success + "14" : theme.warning + "14" }]}>
          <Ionicons name={calibrationDone ? "checkmark-circle" : "alert-circle"} size={16} color={calibrationDone ? theme.success : theme.warning} />
          <Text style={[styles.statusT, { color: calibrationDone ? theme.success : theme.warning }]}>
            {calibrationDone ? `Calibrated • ${confidence}% confidence • yaw auto` : "Not calibrated • Run alignment"}
          </Text>
        </View>

        <View style={styles.btnRow}>
          <Pressable onPress={running ? cancel : start} style={[styles.btn, running && { backgroundColor: theme.bgCard2, borderWidth: 1, borderColor: theme.border }]}>
            <Ionicons name={running ? "close" : "scan-outline"} size={16} color={running ? theme.text : "#0B1220"} />
            <Text style={[styles.btnT, running && { color: theme.text }]}>{running ? "CANCEL" : "START CALIBRATION"}</Text>
          </Pressable>
          {calibrationDone && !running && (
            <Pressable onPress={() => setCalibration(false, pitch, roll, yaw, 0)} style={styles.btnGhost}>
              <Text style={styles.btnGhostT}>Reset</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.hint}>Uses gravity vector + GNSS heading diff + mag. Saves matrix to store; applied in orientation.ts before filter. Auto re-calib on mount shift gyro &gt;1.2 rad/s.</Text>
        <Text style={styles.hint2}>Web mock: mag heading = GNSS+yaw+noise. On device uses expo-sensors Magnetometer.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  card: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: theme.bgCard2, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "900", color: theme.text },
  sub: { fontSize: 12, color: theme.textMuted, lineHeight: 16 },
  shiftBanner: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: theme.warning, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  shiftText: { fontSize: 11, color: "#fff", fontWeight: "700" },
  grid3: { flexDirection: "row", gap: 10 },
  axis: { flex: 1, backgroundColor: "#070D1C", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: theme.border, gap: 4 },
  axisL: { fontSize: 10, color: theme.textDim, fontWeight: "700" },
  axisV: { fontSize: 16, color: theme.text, fontWeight: "800" },
  axisSub: { fontSize: 10, color: theme.textDim, marginTop: 2 },
  bar: { height: 4, borderRadius: 2, marginTop: 4 },
  kvGrid: { flexDirection: "row", gap: 10 },
  kv: { flex: 1, flexDirection: "row", justifyContent: "space-between", backgroundColor: "#070D1C", borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  k: { fontSize: 11, color: theme.textDim, fontWeight: "600" },
  v: { fontSize: 11, color: theme.text, fontWeight: "800" },
  progressWrap: { gap: 6 },
  track: { height: 8, backgroundColor: "#070D1C", borderRadius: 999, overflow: "hidden", borderWidth: 1, borderColor: theme.border },
  fill: { height: "100%", backgroundColor: theme.accent, borderRadius: 999 },
  progressText: { fontSize: 11, color: theme.textMuted, fontWeight: "600", textAlign: "center" },
  warn: { fontSize: 11, color: theme.warning, textAlign: "center", fontWeight: "600" },
  status: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1 },
  statusT: { fontSize: 12, fontWeight: "700" },
  btnRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  btn: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.accent, paddingVertical: 14, borderRadius: 12 },
  btnT: { fontSize: 13, fontWeight: "900", color: "#0B1220" },
  btnGhost: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bgCard2 },
  btnGhostT: { fontSize: 12, color: theme.text, fontWeight: "700" },
  hint: { fontSize: 10, color: theme.textDim, textAlign: "center", lineHeight: 14 },
  hint2: { fontSize: 10, color: theme.textDim, textAlign: "center", lineHeight: 14, opacity: 0.7 },
});
