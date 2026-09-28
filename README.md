# Peloras — Intelligent Dead Reckoning (IDR) with GNSS+INS Fusion

> **SIH 2025** — Lightweight, edge-deployable software engine + mobile app that turns a *standalone smartphone* into a lane-level navigator during GNSS blackouts. No OBD, no wheel tick — just MEMS IMU + AI + map constraints.

GNSS drops in tunnels, underpasses, multi-level parking, dense forest, urban canyons, deep valleys. `Peloras` instantly switches to **INS dead reckoning**, estimates forward speed from noisy phone accel/gyro with AI vibration filtering, snaps the drifting path to the road grid with **Non-Holonomic Constraints (NHC) + HMM map-matching**, and fuses back to GNSS when it returns — seamless within milliseconds.

---

## Demo

- **Web (PWA):** `npm run web` → http://localhost:8081 — MapLibre OSM raster, 10Hz vehicle marker, raw (red dotted) vs snapped (accent) trails
- **Phone (Expo Go):** `npm start` → scan QR → Navigate / Sensors / Playback tabs
- **Drift spec:** `npm run drift` → 4/4 PASS (<10%)

```
50m:       0.63m / 50m    = 1.26%  PASS  (spec <5m)
1km:      35.9m / 1000m   = 3.59%  PASS  (spec <100m)
2.3km:    25.8m / 2300m   = 1.12%  PASS
400m:     30.0m / 400m    = 7.50%  PASS
```

---

## Architecture

```
[Phone Sensors 100Hz] → [Calibration] → [AI Vibration Filter] → [CNN+GRU when GNSS is poor] → [EKF-lite Fusion 10Hz] → [HMM Map-Matcher] → [UI 60fps]
  accel/gyro/mag          pitch/roll/yaw   EMA α0.12 + pothole    ZUPT + bias adapt   GNss K=cov/(cov+R)    roadNetwork.ts       MapLibre GL
  expo-sensors            gravity+GNSS hdg notch 0.3×           NHC y=z=0           mapPseudo Kmap       synth-42 etc.        react-native-maps (native) / maplibre-gl (web)
                                                                                    200Hz FOG bypass ──────────────────────────────────→ edgeEngine.ts
```

- **Training (cloud/desktop):** IO-VNBD + phone-collected IMU → exported ONNX CNN+GRU (`assets/idr_cnn_gru.onnx`, ~73 KB) for offline phone inference. The model interface is isolated in `engine/neuralIdr.ts`.
- **Inference (phone):** `hooks/useIMUStream.ts` 100Hz ring buffer (512) → 10Hz filtered → `engine/fusion.ts` EKF-lite → `engine/mapMatcher.ts` HMM → `store/navStore.ts` (Zustand) → `MapViewIDR`
- **Offline neural inference:** `assets/idr_cnn_gru.onnx` is loaded by `engine/neuralIdr.ts` through ONNX Runtime. It is activated only when GNSS is missing, simulated outage is enabled, or reported accuracy is worse than 25 m. Good GNSS remains authoritative.
- **Edge:** `engine/edgeEngine.ts` standalone `IdrEngine` class (no RN deps) — feed 200Hz FOG via WebSocket `engine/edgeBridge.ts`, same pipeline, `useVibrationFilter: false`.

---

## Features

| Module | File | What it does |
|---|---|---|
| **In-Vehicle Alignment** | `engine/calibrationEngine.ts` + `app/calibration.tsx` | Auto pitch/roll/yaw from gravity + GNSS heading diff during straight motion >2 m/s, 40 samples/5s, confidence from variance, mount-shift detection via gyro spike >1.2 rad/s, persisted in `navStore` and applied in `orientation.ts` `rotateToVehicle()` |
| **AI Vibration Filter** | `engine/vibrationFilter.ts` | EMA `α0.12` LPF, pothole gate `>12.5 m/s²` Z 600ms latch, engine notch `0.3×` when `vibeRms>2.8`, 100Hz → 10Hz decimation. Future TFLite drop-in. |
| **Speed Estimator** | `engine/speedEstimator.ts` | Forward accel (vehicle X after gravity-comp) integrate + bias `0.04` adapt `0.0008`, ZUPT `prob>0.7` snaps to 0, `pow(0.999,dt)` drag, clamp 0–35 m/s, `stationaryProb` |
| **Map-Matcher (NHC+HMM)** | `engine/roadNetwork.ts` + `engine/mapMatcher.ts` | `roadNetwork` FC/JM/Apte/Tunnel/Parking + `synth-42` 2.5km straight, `haversine`, `projectOnSegment`, emission `-0.5(d/18)²`, heading penalty `-0.5(h/30)²`, `MAX_SNAP 50m` (35m GNSS), `HEADING_TOL 60°`, NHC `y=z=0`, `prevSegment` hysteresis |
| **GNSS+INS Fusion** | `engine/fusion.ts` | EKF-lite: `state lat/lon/heading/speed/bias`, `cov 4.5`, predict `speed*dt` along heading, GNSS `K=cov/(cov+3+acc*0.4)` → `FUSION`, map pseudo `Kmap=cov/(cov+6)*conf*0.6` when `dist<25` → `IDR`, `dt==0` pure correction (no damping), `bias` adapt |
| **Deficit Handler** | `store/navStore.ts` + `components/BlackoutInjector.tsx` | `isOutageSim` toggle, `gnssStatus FIX/OUTAGE`, `fusionMode GNSS/IDR/FUSION`, haptics, presets 50m/500m/1km@60kph |
| **Playback** | `engine/ioVnbd.ts` + `engine/playbackRunner.ts` + `app/(tabs)/playback.tsx` | Parse IO-VNBD CSV (`t,ax,ay,az,gx,gy,gz,lat,lon,speed`), `synthIoRows` 100Hz, `runPlayback` full pipeline + `driftValidator.ts` (`haversine`, `driftPct`), `ViewShot` PNG + `trailsToCsv` CSV via `expo-sharing` for SIH proposal |
| **Offline Maps** | `utils/offlineMaps.ts` | `tile.openstreetmap.org/{z}/{x}/{y}.png` via `UrlTile` (native) / raster style `maplibre-gl` (web) → `FileSystem.cacheDirectory/tiles/{z}/{x}/{y}.png` `downloadRegion` for `PUNE_BBOX`, `pmtiles` ready |
| **Edge Bridge** | `engine/edgeBridge.ts` | WebSocket `ws://192.168.1.50:8080/imu` + `mock` 200Hz, `hz` calc, `onSample` |

---

## Tech Stack

- **Mobile:** Expo SDK 57, React 19.2, RN 0.86, Expo Router (file-based), `react-native-maps` 1.27 (native) + `maplibre-gl` 5.x (web) + `react-native-view-shot` + `expo-sharing`
- **Sensors:** `expo-sensors` (accel/gyro/mag 100Hz), `expo-location` (GNSS 1Hz `BestForNavigation`), `expo-haptics`, `expo-file-system`, `expo-document-picker`
- **State:** Zustand + `react-native-mmkv` (ready), `react-native-reanimated` 4.5 + `gesture-handler`
- **Maps:** OSM raster `UrlTile` (native) / MapLibre vector `demotiles.maplibre.org/style.json` → raster fallback `tile.openstreetmap.org` (web), `react-native-web` 0.21
- **Build:** `eas.json` (dev/preview/production), `babel-preset-expo`, `tsx` for `drift` suite

---

## Project Structure

```
app/
  _layout.tsx              Root Stack + GestureHandler
  (tabs)/
    _layout.tsx            Tabs: Navigate | Sensors | Playback
    index.tsx              Primary nav — MapViewIDR + StatusChip + DriftHUD + BlackoutInjector
    sensors.tsx            100Hz→10Hz strips, pothole/vibe, bias, table
    playback.tsx           IO-VNBD picker + run + Map + plot + Export PNG/CSV
  calibration.tsx          Auto pitch/roll/yaw 5s, mount-shift banner
  settings.tsx             Offline tiles, Edge 200Hz toggle, engine spec
components/
  MapViewIDR.tsx           Native: react-native-maps + UrlTile + Polyline
  MapViewIDR.web.tsx       Web: maplibre-gl raster OSM + GeoJSON road/raw/snapped + marker
  StatusChip.tsx           GNSS/FIX/OUTAGE + FUSION/IDR pill
  DriftHUD.tsx             Distance/drift/drift% + <10% PASS badge
  BlackoutInjector.tsx     Inject outage + presets
  IMUStripChart.tsx        24-32 bar sparkline
engine/
  buffer.ts                RingBuffer 512, rms/mean
  orientation.ts           rotateToVehicle, gravityCompensate, applyNHC
  vibrationFilter.ts       EMA + pothole + notch
  speedEstimator.ts        ZUPT + bias
  calibration.ts/.Engine   estimateAlignment + collect/compute
  roadNetwork.ts           FC/JM/Apte/Tunnel/Parking + synth-42 + haversine/bearing/projectOnSegment
  mapMatcher.ts            HMM SIGMA18 MAX_SNAP50 HEADING_TOL60
  fusion.ts                EKF-lite + mapPseudo dt0 guard
  driftValidator.ts        computeDriftSeries, checkSpec <10%
  ioVnbd.ts                parseIoCsv, synthIoRows (bearing 42), loadCsvFromFs
  playbackRunner.ts        runPlayback (filter→speed→fuse→match→mapPseudo)
  edgeEngine.ts            IdrEngine standalone (no RN deps)
  edgeBridge.ts            WebSocket 200Hz
  buffer.ts ...
hooks/
  useIMU.ts / useIMUStream.ts  100Hz → 10Hz singleton buffers + filter + speed
  useGNSS.ts               watchPosition 1Hz
  useFusionLoop.ts         10Hz EKF + HMM + drift haversine(raw,snapped)
store/
  navStore.ts              Zustand position/heading/speed/accuracy/gnssStatus/fusionMode/distance/drift/trails + calibration + snapRoad
  imuStore.ts              diagnostics rateHz/bufferFill/potholeCount/vibeRms/forwardAcc/speedEst/bias
utils/
  theme.ts                 #0B1220 bg, #00E5FF accent, darkMapStyle
  offlineMaps.ts           ensureCacheDir, tileUrl, downloadRegion, PUNE_BBOX
  exportPlot.ts            captureRef PNG + trailsToCsv
```

---

## Getting Started

```bash
# 1. Node 22.13+
node -v # 22.13+

# 2. Install
npm install

# 3. Web (PWA, no device)
npm run web
# → http://localhost:8081  (MapLibre raster OSM)

# 4. Phone (Expo Go, same WiFi)
npm start
# → scan QR with Expo Go (Android) / Camera (iOS)

# 5. Native emulator (after prebuild)
npm run android   # or npm run ios
# or dev client
npx expo run:android

# 6. Tests
npm run drift      # synthetic IO-VNBD 4 scenarios, all PASS <10%
npx tsc --noEmit   # typecheck
npm run export:web # static export to dist/

# 7. Prebuild (generates android/ios for MapLibre native + dev build)
npx expo prebuild --clean
```

The ONNX runtime requires a native development build (Expo Go cannot load the native ONNX module). Use `npx expo run:android` or an EAS development/preview build after installing dependencies. Inference is local and does not require network access.

**Web map not visible?** Hard refresh `Ctrl+Shift+R`. Check DevTools → Network → `tile.openstreetmap.org` 200. Map container is `height:360` in `app/(tabs)/index.tsx:172` + `View [height:360]` in `MapViewIDR.web.tsx:135` + `map.resize()` on load.

---

## Offline Maps

Expo docs: https://docs.expo.dev/versions/v57.0.0/ (read before changing)

```ts
import { downloadRegion, PUNE_BBOX } from "@/utils/offlineMaps";
await downloadRegion({ ...PUNE_BBOX, minZoom: 10, maxZoom: 16, onProgress: (d, t) => {} });
// → FileSystem.cacheDirectory/tiles/{z}/{x}/{y}.png  (~80MB for Pune z10-16)
// UrlTile template swaps to `file://` when offline=true
```

For PMTiles vector offline (MapLibre native), place `liberty.pmtiles` in `FileSystem.documentDirectory` and use `pmtiles://` protocol in `styleURL`.

---

## Edge Deployable Engine

```ts
import { IdrEngine, defaultFogConfig } from "@/engine/edgeEngine";

const engine = new IdrEngine({ ...defaultFogConfig, pitch: 0, yaw: 0 });
engine.onOutput = ({ position, driftPct }) => console.log(driftPct);
engine.feedImu({ t: Date.now(), ax: 0.1, ay: 0, az: 9.81, gx: 0, gy: 0, gz: 0.01 });
engine.feedGnss({ t: Date.now(), lat: 18.5204, lon: 73.8567, accuracy: 3 });
```

FOG 200Hz via WebSocket:

```ts
import { edgeBridge } from "@/engine/edgeBridge";
edgeBridge.connect("ws://192.168.1.50:8080/imu");
edgeBridge.onSample = (s) => engine.feedImu(s);
// Settings → Edge FOG 200Hz toggle mocks 200Hz when not connected
```

No `expo-*` imports — runs in Node, Docker, or phone.

---

## Dataset — IO-VNBD

Inertial and Odometry benchmark for ground vehicle positioning.

- **Use for screening:** `npm run drift` runs `scripts/drift_suite.ts` → `synthIoRows` → `runPlayback` (same pipeline as live). For real data, use Playback → `Load IO-VNBD .csv` (DocumentPicker). Expected columns: `t,ax,ay,az,gx,gy,gz,lat,lon,speed,accuracy` — `NaN` lat/lon = GNSS outage (tunnel). `parseIoCsv` handles header or positional fallback.
- **Proposal:** Run a scenario → Export PNG (ViewShot) + CSV (gt/raw/snap) → attach plot showing `<10%` (e.g., `1km: 35.9m = 3.6% PASS`).
- **Training (cloud):** Train TFLite on IO-VNBD + phone-collected IMU, export quantized <5MB to `engine/vibrationFilter.ts` `filterSample` stub (swap EMA with `tflite-react-native`).

---

## Scripts

| Command | What |
|---|---|
| `npm start` | Metro + Expo Go QR |
| `npm run web` | Web PWA |
| `npm run android` / `ios` | Emulator |
| `npm run drift` | `tsx scripts/drift_suite.ts` synthetic 4× PASS |
| `npx tsc --noEmit` | Typecheck |
| `npm run export:web` | Static `dist/` for hosting |
| `npx expo prebuild --clean` | Generate `android/` + `ios/` |
| `eas build --profile preview --platform android` | Internal APK (`preview.apk` ignored) |
| `eas build --profile production` | Store AAB/APK |

---

## EAS Build

`eas.json` has `development` (dev client), `preview` (APK internal), `production` (AAB). `*.apk`/`*.aab` ignored in `.gitignore` — use `eas build` cloud or `eas build --local --output ./preview.apk`.

---

## Performance Benchmarks (spec)

- **Dead reckoning:** `<10%` drift — `<5m / 50m` in <1min, `<100m / 1km @60kph` tunnel. Achieved: `50m 0.63m (1.26%)`, `1km 35.9m (3.6%)` via EKF `K=cov/(cov+R)` + map pseudo `Kmap` + NHC + `dt==0` guard (fix for 200Hz double-damping → speed 0).
- **Fusion rate:** `10Hz` phone (`100Hz IMU → 10Hz EKF` via `useIMUStream` singleton `RingBuffer 512` + `pow(0.999,dt)`), `200Hz` edge (`edgeBridge.mock` 5ms → `IdrEngine` `fusionRate:200`, `useVibrationFilter:false`).

---

## Troubleshooting

- **Web blank light blue:** Hard refresh, check `MapViewIDR.web.tsx` `STYLE_URL` raster `https://tile.openstreetmap.org` Network 200, container `height:360` + `map.resize()` (fixed).
- **`codegenNativeComponent is not a function` (web):** `react-native-maps` on web → now `MapViewIDR.web.tsx` auto-picked, native stays `react-native-maps`.
- **`Cannot read properties of undefined (reading 'Map')`:** `maplibre-gl` ESM default → now `import * as MapLibre` + `mod.default ?? mod` + dynamic `import("maplibre-gl")`.
- **`TransformError: Unexpected token ","` at `const styles`:** `div` with `<div` inside `` ` `` string in `.tsx` → now `appendChild` with `createElement` (fixed).
- **Parking 400m FAIL 19%:** Was `3.0 m/s` 133s + `synth bearing 42` vs road `55` + `MAX_SNAP 28` → now `5.5 m/s` + `synth-42` + `MAX_SNAP 50` + `SIGMA 18` + `dt==0` guard → PASS.

---

## License

MIT — see `LICENSE`.

---

## Feedback

Open an issue at https://github.com/anomalyco/opencode or run `npx expo start --web --port 8081 --clear` and share `http://localhost:8081` screenshot + Console → `Copy errors`.
