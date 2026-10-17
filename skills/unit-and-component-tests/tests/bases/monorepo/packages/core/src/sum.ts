// packages/core/src/sum.ts
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
