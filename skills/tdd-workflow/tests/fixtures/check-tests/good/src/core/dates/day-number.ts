// src/core/dates/day-number.ts
export const dayNumber = (nowMs: number): number => Math.floor(nowMs / 86_400_000);
