import { useEffect, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { LatLng } from "@/store/navStore";
import { theme } from "@/utils/theme";
import { roadNetwork } from "@/engine/roadNetwork";
import * as MapLibre from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const maplibregl: any = (MapLibre as any).default ?? MapLibre;

interface Props {
  position: LatLng;
  heading: number;
  rawTrail: LatLng[];
  snappedTrail: LatLng[];
  gnssStatus: string;
}

const STYLE_URL: any = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function toGeoJSON(coords: LatLng[]): any {
  const safe = coords.length >= 2 ? coords : coords.length === 1 ? [coords[0], coords[0]] : [];
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: safe.map((c) => [c.longitude, c.latitude]),
    },
  };
}

export function MapViewIDR({ position, heading, rawTrail, snappedTrail, gnssStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [position.longitude, position.latitude],
      zoom: 15,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
      map.on("load", () => {
        // ensure canvas sized correctly after container height fixed
        setTimeout(() => map.resize(), 100);
        roadNetwork.forEach((seg) => {
          const id = `road-${seg.id}`;
          map.addSource(id, { type: "geojson", data: toGeoJSON(seg.poly) as any });
          map.addLayer({
            id: `${id}-bg`,
            type: "line",
            source: id,
            paint: { "line-color": "#2A3F5E", "line-width": 6, "line-opacity": 0.9 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          map.addLayer({
            id: `${id}-fg`,
            type: "line",
            source: id,
            paint: { "line-color": "#3A4F6A", "line-width": 2, "line-opacity": 0.9 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        });
      map.addSource("raw", {
        type: "geojson",
        data: toGeoJSON(rawTrail.length ? rawTrail : [position, position]) as any,
      });
      map.addLayer({
        id: "raw-line",
        type: "line",
        source: "raw",
        paint: { "line-color": theme.danger, "line-width": 3, "line-dasharray": [2, 2], "line-opacity": 0.9 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addSource("snapped", {
        type: "geojson",
        data: toGeoJSON(snappedTrail.length ? snappedTrail : [position, position]) as any,
      });
      map.addLayer({
        id: "snapped-line",
        type: "line",
        source: "snapped",
        paint: { "line-color": theme.accent, "line-width": gnssStatus === "OUTAGE" ? 5 : 4, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    });
    const el = document.createElement("div");
    el.style.width = "36px";
    el.style.height = "36px";
    el.style.borderRadius = "18px";
    el.style.background = theme.accent;
    el.style.border = "3px solid #fff";
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.boxShadow = "0 2px 8px rgba(0,229,255,0.5)";
    el.innerHTML = `<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid #0B1220;margin-bottom:2px;"></div>`;
    const marker = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" })
      .setLngLat([position.longitude, position.latitude])
      .addTo(map);
    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      try { marker.remove(); } catch {}
      try { map.remove(); } catch {}
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    map.easeTo({ center: [position.longitude, position.latitude], duration: 300 });
    marker.setLngLat([position.longitude, position.latitude]);
    const el = marker.getElement();
    if (el) el.style.transform = `rotate(${heading}deg)`;
    const rawSource = map.getSource("raw") as any;
    if (rawSource) rawSource.setData(toGeoJSON(rawTrail.length ? rawTrail : [position, position]) as any);
    const snapSource = map.getSource("snapped") as any;
    if (snapSource) snapSource.setData(toGeoJSON(snappedTrail.length ? snappedTrail : [position, position]) as any);
    if (map.getLayer("snapped-line")) {
      map.setPaintProperty("snapped-line", "line-width", gnssStatus === "OUTAGE" ? 5 : 4);
      map.setPaintProperty("snapped-line", "line-color", theme.accent);
    }
  }, [position, heading, rawTrail, snappedTrail, gnssStatus]);

  return (
    <View style={[styles.container, { height: 360 }]}>
      <View style={styles.header}>
        <Text style={styles.headerText}>MapLibre • OSM • {gnssStatus === "OUTAGE" ? "IDR 10Hz" : "GNSS"}</Text>
      </View>
      <div ref={containerRef as any} style={{ width: "100%", height: 360, minHeight: 360, flex: 1 }} />
      <View style={styles.footer}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: theme.danger }]} />
          <Text style={styles.legendText}>Raw INS</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: theme.accent }]} />
          <Text style={styles.legendText}>Map-matched</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#1E2F4A", backgroundColor: "#0B1220", position: "relative" },
  header: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(11,18,32,0.85)",
    borderWidth: 1,
    borderColor: "#1E2F4A",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 10,
  },
  headerText: { fontSize: 9, color: theme.textMuted, fontWeight: "600" },
  footer: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(11,18,32,0.85)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1E2F4A",
    zIndex: 10,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendLine: { width: 16, height: 3, borderRadius: 2 },
  legendText: { fontSize: 10, color: theme.textMuted, fontWeight: "600" },
});
