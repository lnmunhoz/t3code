import type { KokoroWorkerRequest, KokoroWorkerResponse } from "./kokoroProtocol";

/** Curated English voices; grades are from the Kokoro model card. */
export const KOKORO_VOICES = [
  { id: "af_heart", label: "Heart · US female" },
  { id: "af_bella", label: "Bella · US female" },
  { id: "af_nicole", label: "Nicole · US female, soft" },
  { id: "af_aoede", label: "Aoede · US female" },
  { id: "af_kore", label: "Kore · US female" },
  { id: "af_sarah", label: "Sarah · US female" },
  { id: "am_michael", label: "Michael · US male" },
  { id: "am_fenrir", label: "Fenrir · US male" },
  { id: "am_puck", label: "Puck · US male" },
  { id: "bf_emma", label: "Emma · UK female" },
  { id: "bf_isabella", label: "Isabella · UK female" },
  { id: "bm_george", label: "George · UK male" },
  { id: "bm_fable", label: "Fable · UK male" },
] as const;

export const KOKORO_DOWNLOAD_LABEL = "about 330 MB, or 90 MB without GPU acceleration";

const MODEL_URL_PREFIX = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/";
const MODEL_FILE_URLS = [
  `${MODEL_URL_PREFIX}resolve/main/onnx/model.onnx`,
  `${MODEL_URL_PREFIX}resolve/main/onnx/model_quantized.onnx`,
];
const TRANSFORMERS_CACHE = "transformers-cache";
const VOICES_CACHE = "kokoro-voices";
// The model holds a few hundred MB while loaded; drop it when notifications go quiet.
const IDLE_UNLOAD_MS = 10 * 60_000;
const SPEAK_TIMEOUT_MS = 30_000;

export type KokoroState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly progress: number | null }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly message: string };

let state: KokoroState = { status: "idle" };
const listeners = new Set<() => void>();

function setState(next: KokoroState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getKokoroState(): KokoroState {
  return state;
}

/** null until the cache has been checked. */
let downloaded: boolean | null = null;

export function getKokoroDownloaded(): boolean | null {
  return downloaded;
}

function setDownloaded(next: boolean) {
  downloaded = next;
  for (const listener of listeners) listener();
}

export function subscribeKokoroState(listener: () => void): () => void {
  listeners.add(listener);
  if (downloaded === null) void isKokoroDownloaded().then(setDownloaded);
  return () => listeners.delete(listener);
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  number,
  {
    resolve: (audio: { samples: Float32Array; sampleRate: number }) => void;
    reject: (error: Error) => void;
  }
>();

function unload() {
  worker?.terminate();
  worker = null;
  ready = null;
  for (const request of pending.values()) request.reject(new Error("Kokoro unloaded"));
  pending.clear();
  if (state.status === "ready" || state.status === "loading") setState({ status: "idle" });
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(unload, IDLE_UNLOAD_MS);
}

function send(request: KokoroWorkerRequest) {
  worker?.postMessage(request);
}

// Measured on an M-series Mac: WebGPU fp32 speaks in ~0.3-0.6 s; single-threaded WASM q8 takes 4-8 s.
async function pickBackend(): Promise<Extract<KokoroWorkerRequest, { type: "load" }>> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter()))
      return { type: "load", device: "webgpu", dtype: "fp32" };
  } catch {
    // No usable adapter; use WASM.
  }
  return { type: "load", device: "wasm", dtype: "q8" };
}

/** Downloads the model on first use (cached by the browser afterwards) and loads it in a worker. */
export function loadKokoro(): Promise<void> {
  touch();
  if (ready) return ready;
  setState({ status: "loading", progress: null });
  const instance = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  worker = instance;
  ready = new Promise<void>((resolve, reject) => {
    instance.addEventListener("message", (event: MessageEvent<KokoroWorkerResponse>) => {
      const message = event.data;
      switch (message.type) {
        case "progress":
          if (state.status === "loading" && message.total > 0) {
            setState({ status: "loading", progress: message.loaded / message.total });
          }
          return;
        case "ready":
          downloaded = true;
          setState({ status: "ready" });
          resolve();
          return;
        case "audio":
          pending.get(message.id)?.resolve(message);
          pending.delete(message.id);
          return;
        case "error":
          if (message.id === null) {
            reject(new Error(message.message));
            unload();
            setState({ status: "error", message: message.message });
            return;
          }
          pending.get(message.id)?.reject(new Error(message.message));
          pending.delete(message.id);
      }
    });
    instance.addEventListener("error", (event) => {
      const message = event.message || "Kokoro worker failed to start";
      reject(new Error(message));
      unload();
      setState({ status: "error", message });
    });
  });
  void pickBackend().then(send);
  return ready;
}

let audioContext: AudioContext | undefined;

function play(samples: Float32Array, sampleRate: number): Promise<void> {
  audioContext ??= new AudioContext();
  const context = audioContext;
  return context.resume().then(
    () =>
      new Promise<void>((resolve, reject) => {
        if (context.state !== "running") {
          reject(new Error("Audio is blocked until the page is clicked"));
          return;
        }
        const buffer = context.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(new Float32Array(samples), 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.addEventListener("ended", () => resolve());
        source.start();
      }),
  );
}

/** Rejects when Kokoro cannot speak, so callers can fall back to the system voice. */
export async function speakWithKokoro(text: string, voice: string, speed: number): Promise<void> {
  await loadKokoro();
  const id = nextId++;
  const audio = await new Promise<{ samples: Float32Array; sampleRate: number }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Kokoro took too long"));
      }, SPEAK_TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      send({ type: "speak", id, text, voice, speed });
    },
  );
  touch();
  await play(audio.samples, audio.sampleRate);
}

async function isKokoroDownloaded(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE);
    for (const url of MODEL_FILE_URLS) if (await cache.match(url)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Unloads the model and deletes its cached files; other cached models stay. */
export async function removeKokoro(): Promise<void> {
  unload();
  setState({ status: "idle" });
  if (typeof caches === "undefined") return;
  const cache = await caches.open(TRANSFORMERS_CACHE);
  for (const request of await cache.keys()) {
    if (request.url.startsWith(MODEL_URL_PREFIX)) await cache.delete(request);
  }
  await caches.delete(VOICES_CACHE);
  setDownloaded(false);
}
