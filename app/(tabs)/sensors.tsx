import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/utils/theme";
import { IMUStripChart } from "@/components/IMUStripChart";
import { useIMUStream } from "@/hooks/useIMUStream";
import { useNavStore } from "@/store/navStore";
import { useImuStore } from "@/store/imuStore";
import { usePathname } from "expo-router";

export default function SensorsScreen() {
  const isFocused = usePathname().endsWith("/sensors");
  const [filterOn, setFilterOn] = useState(true);
  const { output, running } = useIMUStream(isFocused, 10);
  const { diagnostics, rawHz, filteredHz } = useImuStore();
  const { gnssStatus, fusionMode } = useNavStore();

  const [accBuf, setAccBuf] = useState<number[]>(Array(32).fill(0));
  const [gyroBuf, setGyroBuf] = useState<number[]>(Array(32).fill(0));
  const [speedBuf, setSpeedBuf] = useState<number[]>(Array(32).fill(0));
  const [zBuf, setZBuf] = useState<number[]>(Array(32).fill(0));

  // stash last pothole toast
  const [potholeToast, setPotholeToast] = useState(false);
  const potholeRef = useRef(0);

  useEffect(() => {
    setAccBuf((prev) => [...prev.slice(1), output.forwardAcc]);
    setGyroBuf((prev) => [...prev.slice(1), output.gyroYaw * 57.3]);
    setSpeedBuf((prev) => [...prev.slice(1), output.speed * 3.6]);
    setZBuf((prev) => [...prev.slice(1), output.raw.z]);
    if (output.isPothole && Date.now() - potholeRef.current > 800) {
      potholeRef.current = Date.now();
      setPotholeToast(true);
      setTimeout(() => setPotholeToast(false), 900);
    }
  }, [output.forwardAcc, output.gyroYaw, output.speed, output.raw.z, output.isPothole]);

  const forwardAvg = output.forwardAcc.toFixed(2);
  const gyroAvg = (output.gyroYaw * 57.3).toFixed(1);
  const speedKph = (output.speed * 3.6).toFixed(1);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Sensors</Text>
          <Text style={styles.sub}>
            MEMS 100 Hz → {filteredHz || 10} Hz filtered • {running ? "STREAMING" : "IDLE"} {Platform.OS === "web" ? "• mock" : ""} • buf {diagnostics.bufferFill}/512
          </Text>
        </View>
        {potholeToast && (
          <View style={styles.toast}>
            <Ionicons name="warning" size={12} color="#fff" />
            <Text style={styles.toastT}>POTHOLE GATED</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <View style={[styles.statusCard, { borderColor: gnssStatus === "OUTAGE" ? theme.outage : theme.success }]}>
            <Text style={styles.statusLabel}>GNSS</Text>
            <Text style={[styles.statusVal, { color: gnssStatus === "OUTAGE" ? theme.outage : theme.success }]}>{gnssStatus}</Text>
            <Text style={styles.rate}>{rawHz} Hz raw</Text>
          </View>
          <View style={[styles.statusCard, { borderColor: fusionMode === "IDR" ? theme.warning : theme.accent }]}>
            <Text style={styles.statusLabel}>MODE</Text>
            <Text style={[styles.statusVal, { color: fusionMode === "IDR" ? theme.warning : theme.accent }]}>{fusionMode}</Text>
            <Text style={styles.rate}>{filteredHz} Hz fused</Text>
          </View>
          <Pressable
            onPress={() => setFilterOn((v) => !v)}
            style={[styles.filterBtn, { backgroundColor: filterOn ? theme.accent : theme.bgCard2, borderColor: filterOn ? theme.accent : theme.border }]}
          >
            <Ionicons name={filterOn ? "filter" : "filter-outline"} size={14} color={filterOn ? "#0B1220" : theme.text} />
            <Text style={[styles.filterText, { color: filterOn ? "#0B1220" : theme.text }]}>AI FILTER {filterOn ? "ON" : "OFF"}</Text>
          </Pressable>
        </View>

        {/* vibration / pothole banner */}
        {(output.isVibration || output.isPothole) && (
          <View style={[styles.alert, { borderColor: output.isPothole ? theme.warning : theme.border, backgroundColor: output.isPothole ? theme.warning + "14" : theme.bgCard }]}>
            <Ionicons name={output.isPothole ? "car-sport" : "pulse"} size={14} color={output.isPothole ? theme.warning : theme.textDim} />
            <Text style={[styles.alertT, { color: output.isPothole ? theme.warning : theme.textMuted }]}>
              {output.isPothole ? `POTHOLLE GATED • Z ${output.raw.z.toFixed(1)} m/s² → clamped to ${output.filtered.z.toFixed(1)}` : `ENGINE VIB • rms ${diagnostics.vibeRms ?? 0} → notch 0.3×`}
            </Text>
          </View>
        )}

        <View style={styles.row}>
          <IMUStripChart title="FWD ACC (veh X)" unit="m/s²" values={accBuf} color={diagnostics.vibrationFlag ? theme.warning : theme.accent} avg={forwardAvg} />
          <IMUStripChart title="GYRO YAW Z" unit="°/s" values={gyroBuf} color={theme.warning} avg={gyroAvg} />
        </View>
        <View style={styles.row}>
          <IMUStripChart title="SPEED EST" unit="km/h" values={speedBuf} color={theme.success} avg={speedKph} />
          <IMUStripChart title="RAW ACC Z" unit="m/s²" values={zBuf} color={output.isPothole ? theme.danger : theme.textMuted} avg={output.raw.z.toFixed(2)} />
        </View>

        <View style={styles.table}>
          <Text style={styles.tableTitle}>Live pipeline @ 100 Hz → 10 Hz</Text>
          {[
            { k: "Forward Acc", v: `${output.forwardAcc.toFixed(3)} m/s²`, ok: Math.abs(output.forwardAcc) < 4 },
            { k: "Gyro Yaw", v: `${output.gyroYaw.toFixed(4)} rad/s (${gyroAvg} °/s)`, ok: Math.abs(output.gyroYaw) < 0.6 },
            { k: "Speed Est", v: `${output.speed.toFixed(2)} m/s • ${speedKph} km/h`, ok: output.speed >= 0 },
            { k: "Bias", v: `${diagnostics.bias.toFixed(4)} m/s²`, ok: Math.abs(diagnostics.bias) < 0.2 },
            { k: "Stationary", v: `${(diagnostics.stationaryProb * 100).toFixed(0)}%`, ok: diagnostics.stationaryProb < 0.8 || output.speed < 0.2 },
            { k: "Potholes gated", v: `${diagnostics.potholeCount}`, ok: diagnostics.potholeCount < 5 },
            { k: "Vibration", v: diagnostics.vibrationFlag ? "YES • notch active" : "no", ok: !diagnostics.vibrationFlag },
            { k: "Buffer", v: `${diagnostics.bufferFill}/512`, ok: diagnostics.bufferFill > 0 },
            { k: "Raw/Filtered Hz", v: `${rawHz} / ${filteredHz}`, ok: rawHz >= 80 },
            { k: "Filter", v: filterOn ? "EMA α0.12 + pothole gate + notch" : "bypass (raw)", ok: filterOn },
            { k: "Orientation", v: `P${useNavStore.getState().pitch.toFixed(1)} R${useNavStore.getState().roll.toFixed(1)} Y${useNavStore.getState().yaw.toFixed(1)}`, ok: true },
          ].map((r) => (
            <View key={r.k} style={styles.rowLine}>
              <Text style={styles.k}>{r.k}</Text>
              <Text style={[styles.v, { color: r.ok ? theme.text : theme.warning }]}>{r.v}</Text>
            </View>
          ))}
        </View>

        <View style={styles.note}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.textDim} />
          <Text style={styles.noteText}>
            Pipeline: RingBuffer 512 @100Hz → EMA denoise α0.12 → pothole gate (&gt;12.5 m/s² Z) → vibration notch 0.3× → rotate by calib matrix → gravity-comp → AI speed (ZUPT + bias adapt) @10Hz. Future TFLite replaces EMA; interface identical. Edge 200Hz FOG bypasses filter via WebSocket.
          </Text>
        </View>

        <View style={styles.docs}>
          <Text style={styles.docsTitle}>How to test on device</Text>
          <Text style={styles.docsText}>1. Expo Go: shake phone → forwardAcc spike. 2. Tap pothole: Z 8+ m/s² injected on web, gated. 3. Hold still 2 s → stationaryProb 70%+ → speed →0 (ZUPT). 4. Walk → speed climbs 1–2 m/s.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.bgCard, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "900", color: theme.text },
  sub: { fontSize: 10, color: theme.textDim, marginTop: 2 },
  toast: { flexDirection: "row", gap: 4, backgroundColor: theme.warning, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignItems: "center" },
  toastT: { fontSize: 10, fontWeight: "800", color: "#fff" },
  scroll: { padding: 12, gap: 12, paddingBottom: 24 },
  statusRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  statusCard: { flex: 1, backgroundColor: theme.bgCard, borderWidth: 1, borderRadius: 12, padding: 10, alignItems: "center" },
  statusLabel: { fontSize: 10, color: theme.textDim, fontWeight: "700" },
  statusVal: { fontSize: 13, fontWeight: "900", marginTop: 2 },
  rate: { fontSize: 10, color: theme.textDim, marginTop: 2 },
  filterBtn: { flexDirection: "row", gap: 6, alignItems: "center", paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  filterText: { fontSize: 11, fontWeight: "800" },
  alert: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1 },
  alertT: { flex: 1, fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  table: { backgroundColor: theme.bgCard, borderColor: theme.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  tableTitle: { fontSize: 12, fontWeight: "800", color: theme.text, marginBottom: 4 },
  rowLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#162544" },
  k: { fontSize: 11, color: theme.textMuted, flex: 1 },
  v: { fontSize: 11, fontWeight: "700", textAlign: "right", flex: 1 },
  note: { flexDirection: "row", gap: 8, backgroundColor: "#070D1C", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: theme.border },
  noteText: { flex: 1, fontSize: 11, color: theme.textDim, lineHeight: 15 },
  docs: { backgroundColor: theme.bgCard2, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, gap: 4 },
  docsTitle: { fontSize: 11, fontWeight: "800", color: theme.text },
  docsText: { fontSize: 11, color: theme.textMuted, lineHeight: 14 },
});
