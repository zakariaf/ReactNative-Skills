// src/core/async/stop-if-aborted.ts
export function stopIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('aborted');
}
