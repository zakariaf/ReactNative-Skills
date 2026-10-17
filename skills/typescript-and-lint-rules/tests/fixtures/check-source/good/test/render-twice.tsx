// test/render-twice.tsx: a root test helper (a test file: no per-function limit, ! allowed).
export function firstOf(list: readonly string[]): string {
  return list[0]!;
}
