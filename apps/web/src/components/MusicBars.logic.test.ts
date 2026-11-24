import { describe, expect, it } from "vite-plus/test";

import { rowLevel } from "./MusicBars.logic";

describe("rowLevel", () => {
  const spectrum = Array.from({ length: 40 }, (_, band) => band);

  it("puts the bass in the middle and mirrors treble to both edges", () => {
    expect(rowLevel(spectrum, 0, 81)).toBe(39);
    expect(rowLevel(spectrum, 40, 81)).toBe(0);
    expect(rowLevel(spectrum, 80, 81)).toBe(39);
    expect(rowLevel(spectrum, 20, 81)).toBeCloseTo(19.5);
  });
});
