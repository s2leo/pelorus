import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { useNavStore } from "@/store/navStore";
import { useImuStore } from "@/store/imuStore";
import { MapViewIDR } from "@/components/MapViewIDR";
import { StatusChip } from "@/components/StatusChip";
import { DriftHUD } from "@/components/DriftHUD";
import { BlackoutInjector } from "@/components/BlackoutInjector";
import { theme } from "@/utils/theme";
import { useFusionLoop } from "@/hooks/useFusionLoop";

export default function NavigateScreen() {
  const pathname = usePathname();
  const isFocused = pathname === "/" || pathname.endsWith("/index");
  const {
    position,
    heading,
    speed,
    accuracy,
    gnssStatus,
    fusionMode,
    rawTrail,
    snappedTrail,
    distanceTravelled,
    drift,
    driftPct,
    snapRoad,
    snapDist,
    isSnapped,
  } = useNavStore();
  const { diagnostics, rawHz } = useImuStore();

  // drive whole pipeline: 100Hz IMU → 10Hz filter → 10Hz GNSS+INS fuse → navStore
  const { imu } = useFusionLoop(isFocused);

  const speedKph = (speed * 3.6).toFixed(0);
  const forwardAcc = imu.forwardAcc.toFixed(2);
  const gyroZ = imu.gyroYaw.toFixed(3);

  const vibeBadge = diagnostics.vibrationFlag ? " • VIB NOTCH" : "";
  const potholeBadge = imu.isPothole ? " • POTHOLE GATED" : "";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>PELORAS</Text>
          <Text style={styles.brandSub}>Intelligent Dead Reckoning • {rawHz}Hz{vibeBadge}{potholeBadge}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.speedPill}>
            <Text style={styles.speedVal}>{speedKph}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <Link href="/settings" asChild>
            <Pressable style={styles.iconBtn}>
              <Ionicons name="settings-outline" size={18} color={theme.text} />
            </Pressable>
          </Link>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <StatusChip gnssStatus={gnssStatus} fusionMode={fusionMode} />
        {useNavStore((s) => s.mountShiftDetected) && (
          <View style={styles.shiftBanner}>
            <Ionicons name="warning" size={12} color="#fff" />
            <Text style={styles.shiftText}>Mount shifted — recalibrate from dashboard banner below</Text>
          </View>
        )}

        <View style={styles.mapWrap}>
          <MapViewIDR
            position={position}
            heading={heading}
            rawTrail={rawTrail}
            snappedTrail={snappedTrail}
            gnssStatus={gnssStatus}
          />
          <View style={styles.mapOverlayTop}>
            <View style={styles.accPill}>
              <View style={[styles.dot, { backgroundColor: gnssStatus === "OUTAGE" ? theme.outage : theme.success }]} />
              <Text style={styles.accText}>±{accuracy.toFixed(1)}m • {fusionMode} • {diagnostics.speedEst.toFixed(1)} m/s est</Text>
            </View>
          </View>
          <View style={styles.mapLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: theme.danger }]} />
              <Text style={styles.legendText}>Raw INS</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: theme.accent }]} />
              <Text style={styles.legendText}>Map-matched</Text>
            </View>
          </View>
          {snapRoad && (
            <View style={styles.roadPill}>
              <View style={[styles.dotSm, { backgroundColor: isSnapped ? theme.success : theme.warning }]} />
              <Text style={styles.roadText}>{snapRoad}</Text>
              <Text style={styles.roadDist}>{snapDist.toFixed(1)}m • {isSnapped ? "SNAPPED" : "off"}</Text>
            </View>
          )}
        </View>

        <DriftHUD distance={distanceTravelled} drift={drift} driftPct={driftPct} />

        <BlackoutInjector />

        <View style={styles.grid2}>
          <View style={styles.miniCard}>
            <Text style={styles.miniLabel}>HEADING</Text>
            <Text style={styles.miniVal}>{heading.toFixed(1)}°</Text>
            <Text style={styles.miniSub}>{gyroZ} rad/s yaw • fwd {forwardAcc} m/s²</Text>
          </View>
          <View style={styles.miniCard}>
            <Text style={styles.miniLabel}>IMU RATE</Text>
            <Text style={styles.miniVal}>{rawHz || 100} Hz</Text>
            <Text style={styles.miniSub}>buf {diagnostics.bufferFill}/512 • bias {diagnostics.bias.toFixed(3)}</Text>
          </View>
        </View>

        <View style={styles.nextTurn}>
          <View style={styles.turnIcon}>
            <Ionicons name="arrow-forward" size={20} color="#0B1220" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.turnLabel}>LIVE NAVIGATION</Text>
            <Text style={styles.turnRoad}>Live OSM/GNSS route</Text>
          </View>
          <Text style={styles.turnDist}>GNSS/IDR</Text>
        </View>

        <Link href="/calibration" asChild>
          <Pressable style={styles.calibBanner}>
            <Ionicons name="phone-portrait-outline" size={18} color={theme.accent} />
            <Text style={styles.calibText}>Calibration • Tap to align phone → vehicle</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textDim} />
          </Pressable>
        </Link>

        <Text style={styles.footerNote}>
          Pipeline: 100Hz ring buf → EMA α0.12 → pothole gate → notch → vehicle rotate → gravity-comp → ZUPT speed → 10Hz fuse. Edge 200Hz FOG bypasses filter via WS.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.bgCard,
  },
  brand: { fontSize: 16, fontWeight: "900", color: theme.text, letterSpacing: 1.2 },
  brandSub: { fontSize: 10, color: theme.textDim, fontWeight: "600", letterSpacing: 0.6, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  speedPill: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: theme.bgCard2,
    borderColor: theme.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 4,
  },
  speedVal: { fontSize: 16, fontWeight: "900", color: theme.text },
  speedUnit: { fontSize: 11, color: theme.textMuted, fontWeight: "600" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.bgCard2,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: 12, gap: 12, paddingBottom: 24 },
  mapWrap: { height: 360, position: "relative" },
  mapOverlayTop: { position: "absolute", top: 10, left: 10, right: 10, alignItems: "flex-start" },
  accPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(11,18,32,0.85)",
    borderColor: theme.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  accText: { fontSize: 10, fontWeight: "700", color: theme.text },
  mapLegend: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(11,18,32,0.85)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
  },
  roadPill: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: "rgba(11,18,32,0.88)",
    borderColor: theme.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dotSm: { width: 6, height: 6, borderRadius: 3 },
  roadText: { fontSize: 11, color: theme.text, fontWeight: "800" },
  roadDist: { fontSize: 10, color: theme.textMuted, fontWeight: "600" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 16, height: 3, borderRadius: 2 },
  legendText: { fontSize: 10, color: theme.textMuted, fontWeight: "600" },
  grid2: { flexDirection: "row", gap: 12 },
  miniCard: {
    flex: 1,
    backgroundColor: theme.bgCard,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  miniLabel: { fontSize: 10, color: theme.textDim, fontWeight: "700", letterSpacing: 0.7 },
  miniVal: { fontSize: 18, color: theme.text, fontWeight: "800", marginTop: 4 },
  miniSub: { fontSize: 11, color: theme.textMuted, marginTop: 2 },
  nextTurn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.bgCard,
    borderColor: theme.accent + "40",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  turnIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  turnLabel: { fontSize: 11, color: theme.textDim, fontWeight: "700", letterSpacing: 0.6 },
  turnRoad: { fontSize: 14, color: theme.text, fontWeight: "800", marginTop: 2 },
  turnDist: { fontSize: 13, color: theme.accent, fontWeight: "800" },
  calibBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.bgCard,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  calibText: { flex: 1, fontSize: 12, color: theme.textMuted, fontWeight: "600" },
  footerNote: { fontSize: 10, color: theme.textDim, textAlign: "center", lineHeight: 14, marginTop: 4 },
  shiftBanner: { flexDirection: "row", gap: 6, alignItems: "center", backgroundColor: theme.warning, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  shiftText: { fontSize: 11, color: "#fff", fontWeight: "700" },
});
