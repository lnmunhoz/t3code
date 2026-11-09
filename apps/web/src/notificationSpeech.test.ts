import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const spoken: Array<{ text: string; onend: (() => void) | null }> = [];

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

beforeEach(() => {
  vi.resetModules();
  spoken.length = 0;
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", {
    speak: (utterance: FakeUtterance) => spoken.push(utterance),
    getVoices: () => [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("threadSpeechText", () => {
  it("phrases each alert and keeps long titles short at a word boundary", async () => {
    const { threadSpeechText } = await import("./notificationSpeech");
    expect(threadSpeechText("Fix login", "completion")).toBe("Fix login complete");
    expect(threadSpeechText("Fix login", "approval")).toBe("Fix login needs approval");
    expect(threadSpeechText("Fix login", "request")).toBe("Fix login needs your input");
    expect(threadSpeechText("Fix login", "failed")).toBe("Fix login failed");
    expect(threadSpeechText("  ", "completion")).toBe("Thread complete");
    expect(
      threadSpeechText(
        "Refactor the websocket reconnect logic so that remote clients, survive tunnel restarts",
        "completion",
      ),
    ).toBe("Refactor the websocket reconnect logic so that remote complete");
  });
});

describe("speakNotification", () => {
  it("speaks one utterance at a time and drops repeats and overflow", async () => {
    const { speakNotification } = await import("./notificationSpeech");
    for (const text of ["a", "a", "b", "c", "d"]) speakNotification(text);
    expect(spoken.map((utterance) => utterance.text)).toEqual(["a"]);

    for (const expected of ["b", "c"]) {
      spoken.at(-1)!.onend!();
      await vi.waitFor(() => expect(spoken.at(-1)!.text).toBe(expected));
    }
    spoken.at(-1)!.onend!();
    await Promise.resolve();
    expect(spoken).toHaveLength(3);
  });
});
