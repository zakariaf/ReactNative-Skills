// src/features/parity/parity-session.ts
// The request of the running parity launch, held for the parity root (which turns it into the screens'
// FrameRequest and draws the launch marker). One launch per process: the launch route starts it, a
// normal start never does. A tiny external store, so React reads it with useSyncExternalStore.
import type { ParityRequest } from './parity-request';

let current: ParityRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function startParitySession(request: ParityRequest): void {
  current = request;
  notify();
}

export function endParitySession(): void {
  current = null;
  notify();
}

export function currentParityRequest(): ParityRequest | null {
  return current;
}

export function subscribeParitySession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
