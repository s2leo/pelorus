import { useMemo } from "react";
import { StyleSheet, View, Text } from "react-native";
import { Camera, GeoJSONSource, Layer, Map as MapLibreView, Marker } from "@maplibre/maplibre-react-native";
import { LatLng } from "@/store/navStore";
import { theme } from "@/utils/theme";
import { roadNetwork } from "@/engine/roadNetwork";

interface Props { position: LatLng; heading: number; rawTrail: LatLng[]; snappedTrail: LatLng[]; gnssStatus: string; }
const emptyLine = (p: LatLng) => [p, p];
function lineFeature(coords: LatLng[]) {
  // MapLibre rejects a LineString with fewer than two coordinates. During
  // startup a trail can contain zero or one live GNSS/IMU point.
  const safe = coords.length >= 2 ? coords : coords.length === 1 ? [coords[0], coords[0]] : [];
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: safe.map((c) => [c.longitude, c.latitude]) } };
}
function collection(features: ReturnType<typeof lineFeature>[]) { return { type: "FeatureCollection" as const, features }; }

// OSM raster tiles rendered by MapLibre; no Google Maps API key is needed.
const OSM_STYLE = { version: 8 as const, sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster" as const, source: "osm" }] };

export function MapViewIDR({ position, heading, rawTrail, snappedTrail, gnssStatus }: Props) {
  const roadData = useMemo(() => collection(roadNetwork.map((seg) => lineFeature(seg.poly))), []);
  const rawData = useMemo(() => lineFeature(rawTrail.length ? rawTrail : emptyLine(position)), [rawTrail, position]);
  const snappedData = useMemo(() => lineFeature(snappedTrail.length ? snappedTrail : emptyLine(position)), [snappedTrail, position]);
  return (
    <View style={styles.container}>
      <MapLibreView style={styles.map} mapStyle={OSM_STYLE} attribution attributionPosition={{ bottom: 8, right: 8 }} logo={false} compass compassPosition={{ top: 12, right: 12 }} onDidFailLoadingMap={() => console.warn("MapLibre: OSM tiles failed to load")}>
        <Camera center={[position.longitude, position.latitude]} zoom={15} duration={300} />
        <GeoJSONSource id="road-network" data={roadData}>
          <Layer id="road-network-line" type="line" source="road-network" paint={{ "line-color": "#38516f", "line-width": 5, "line-opacity": 0.9 }} layout={{ "line-cap": "round", "line-join": "round" }} />
        </GeoJSONSource>
        <GeoJSONSource id="raw-trail" data={rawData}>
          <Layer id="raw-trail-line" type="line" source="raw-trail" paint={{ "line-color": theme.danger, "line-width": 3, "line-opacity": 0.95, "line-dasharray": [2, 2] }} layout={{ "line-cap": "round", "line-join": "round" }} />
        </GeoJSONSource>
        <GeoJSONSource id="snapped-trail" data={snappedData}>
          <Layer id="snapped-trail-line" type="line" source="snapped-trail" paint={{ "line-color": theme.accent, "line-width": gnssStatus === "OUTAGE" ? 5 : 4, "line-opacity": 0.98 }} layout={{ "line-cap": "round", "line-join": "round" }} />
        </GeoJSONSource>
        <Marker id="vehicle" lngLat={[position.longitude, position.latitude]}>
          <View style={[styles.vehicle, { transform: [{ rotate: `${heading}deg` }] }]}><View style={styles.vehicleArrow} /></View>
        </Marker>
      </MapLibreView>
      <View style={styles.header}><Text style={styles.headerText}>MapLibre · OpenStreetMap · {gnssStatus === "OUTAGE" ? "IDR 10Hz" : "GNSS"}</Text></View>
      <View style={styles.footer}>
        <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: theme.danger }]} /><Text style={styles.legendText}>Raw INS</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: theme.accent }]} /><Text style={styles.legendText}>AI/map-matched</Text></View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#1E2F4A", backgroundColor: "#0B1220" }, map: { flex: 1 },
  header: { position: "absolute", top: 8, left: 8, backgroundColor: "rgba(11,18,32,0.86)", borderWidth: 1, borderColor: "#1E2F4A", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }, headerText: { fontSize: 9, color: theme.textMuted, fontWeight: "600" },
  footer: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", gap: 10, backgroundColor: "rgba(11,18,32,0.86)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "#1E2F4A" }, legendItem: { flexDirection: "row", alignItems: "center", gap: 6 }, legendLine: { width: 16, height: 3, borderRadius: 2 }, legendText: { fontSize: 10, color: theme.textMuted, fontWeight: "600" },
  vehicle: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.accent, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 6 }, vehicleArrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 11, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#0B1220" },
});
