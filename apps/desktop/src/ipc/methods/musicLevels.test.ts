import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ webContents: { fromId: () => undefined } }));

const { parseMeterReading } = await import("./musicLevels.ts");

describe("parseMeterReading", () => {
  const spectrum = Array.from({ length: 40 }, (_, band) => band / 40);

  it("keeps a 40-band line from the meter", () => {
    expect(parseMeterReading(JSON.stringify(spectrum))).toEqual(spectrum);
  });

  it.each([
    ["a partial line", JSON.stringify(spectrum).slice(0, 30)],
    ["the wrong band count", JSON.stringify(spectrum.slice(1))],
    ["a level above 1", JSON.stringify([...spectrum.slice(1), 1.5])],
    ["an object", JSON.stringify({ spectrum })],
  ])("drops %s", (_, line) => {
    expect(parseMeterReading(line)).toBeNull();
  });
});
