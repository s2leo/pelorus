import { Asset } from "expo-asset";
import { NativeModules } from "react-native";
import type * as Ort from "onnxruntime-react-native";

type NeuralResult = { speed: number; acceleration: number; confidence: number };

// The exported model consumes 20 samples at 10 Hz, with 12 channels:
// accelerometer, gravity, gyroscope, and magnetometer XYZ.
const MODEL_ASSET = require("../assets/idr_cnn_gru.onnx");
const META = require("../assets/idr_cnn_gru.meta.json");

class NeuralIdr {
  private session: Ort.InferenceSession | null = null;
  private ort: typeof Ort | null = null;
  private loading: Promise<void> | null = null;
  private window: number[][] = [];
  private inFlight = false;

  async load(): Promise<void> {
    if (this.session) return;
    if (!this.loading) {
      this.loading = (async () => {
        // Load lazily so Expo Go or an old binary without the native module
        // can still boot. A native dev/release build is required for AI.
        const nativeOrt = (NativeModules as any)?.Onnxruntime;
        if (!nativeOrt || typeof nativeOrt.install !== "function") {
          this.ort = null;
          return;
        }
        try {
          this.ort = require("onnxruntime-react-native") as typeof Ort;
        } catch {
          this.ort = null;
          return;
        }
        const asset = Asset.fromModule(MODEL_ASSET);
        await asset.downloadAsync();
        this.session = await this.ort.InferenceSession.create(asset.localUri ?? asset.uri);
      })();
    }
    await this.loading;
  }

  reset() { this.window = []; }

  async infer(features: number[]): Promise<NeuralResult | null> {
    if (features.length !== 12) return null;
    this.window.push(features.slice());
    if (this.window.length > META.window) this.window.shift();
    if (this.window.length < META.window) return null;
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      await this.load();
      if (!this.session) return null;
      const values = new Float32Array(12 * META.window);
      for (let channel = 0; channel < 12; channel++) {
        for (let t = 0; t < META.window; t++) {
          const normalized = (this.window[t][channel] - META.feature_mean[channel]) / META.feature_std[channel];
          values[channel * META.window + t] = normalized;
        }
      }
      if (!this.ort) return null;
      const input = new this.ort.Tensor("float32", values, [1, 12, META.window]);
      const output = await this.session.run({ imu_window: input });
      const speed = Number((output.velocity_kmh ?? Object.values(output)[0] as Ort.Tensor).data[0]);
      const acceleration = Number((output.acceleration_g ?? Object.values(output)[1] as Ort.Tensor).data[0]);
      const logVariance = Number((output.log_variance ?? Object.values(output)[2] as Ort.Tensor).data[0]);
      return { speed: Math.max(0, speed) / 3.6, acceleration, confidence: Math.exp(-0.5 * logVariance) };
    } catch {
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}

export const neuralIdr = new NeuralIdr();
