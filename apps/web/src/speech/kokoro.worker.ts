import { env } from "@huggingface/transformers";
import ortMjsUrl from "@t3-onnx-runtime/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "@t3-onnx-runtime/ort-wasm-simd-threaded.jsep.wasm?url";
import { KokoroTTS } from "kokoro-js";

import type { KokoroWorkerRequest, KokoroWorkerResponse } from "./kokoroProtocol";

// Transformers.js loads the ONNX runtime from jsDelivr by default, which the desktop CSP blocks.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
  env.backends.onnx.wasm.numThreads = 1;
}

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let model: Promise<KokoroTTS> | null = null;

function post(message: KokoroWorkerResponse, transfer: Array<Transferable> = []) {
  self.postMessage(message, { transfer });
}

function load(device: "webgpu" | "wasm", dtype: "fp32" | "q8"): Promise<KokoroTTS> {
  if (model) return model;
  const files = new Map<string, { loaded: number; total: number }>();
  model = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device,
    progress_callback: (event) => {
      if (event.status !== "progress") return;
      files.set(event.file, { loaded: event.loaded, total: event.total });
      let loaded = 0;
      let total = 0;
      for (const file of files.values()) {
        loaded += file.loaded;
        total += file.total;
      }
      post({ type: "progress", loaded, total });
    },
  });
  model.catch(() => {
    model = null;
  });
  return model;
}

self.addEventListener("message", async (event: MessageEvent<KokoroWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "load") {
      await load(request.device, request.dtype);
      post({ type: "ready" });
      return;
    }
    if (!model) throw new Error("Kokoro is not loaded");
    const tts = await model;
    const audio = await tts.generate(request.text, {
      voice: request.voice as never,
      speed: request.speed,
    });
    const samples = audio.audio;
    post({ type: "audio", id: request.id, samples, sampleRate: audio.sampling_rate }, [
      samples.buffer,
    ]);
  } catch (error) {
    post({
      type: "error",
      id: request.type === "speak" ? request.id : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
