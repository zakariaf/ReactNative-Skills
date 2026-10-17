// A clean module: nothing here matches a rule. A match inside a comment is ignored: __FILL_PATTERN__

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
