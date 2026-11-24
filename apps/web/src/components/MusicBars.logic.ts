/**
 * Level for one row of a strip of `rows`: bass in the vertical middle, treble mirrored toward
 * the top and bottom, interpolated between the meter's bands.
 */
export function rowLevel(spectrum: ReadonlyArray<number>, row: number, rows: number): number {
  const position = Math.abs((2 * row) / Math.max(1, rows - 1) - 1);
  const offset = position * (spectrum.length - 1);
  const lower = Math.floor(offset);
  const blend = offset - lower;
  const upper = Math.min(spectrum.length - 1, lower + 1);
  return (spectrum[lower] ?? 0) * (1 - blend) + (spectrum[upper] ?? 0) * blend;
}
