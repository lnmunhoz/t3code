export type KokoroWorkerRequest =
  | {
      readonly type: "load";
      readonly device: "webgpu" | "wasm";
      readonly dtype: "fp32" | "q8";
    }
  | {
      readonly type: "speak";
      readonly id: number;
      readonly text: string;
      readonly voice: string;
      readonly speed: number;
    };

export type KokoroWorkerResponse =
  | { readonly type: "progress"; readonly loaded: number; readonly total: number }
  | { readonly type: "ready" }
  | {
      readonly type: "audio";
      readonly id: number;
      readonly samples: Float32Array;
      readonly sampleRate: number;
    }
  | { readonly type: "error"; readonly id: number | null; readonly message: string };
