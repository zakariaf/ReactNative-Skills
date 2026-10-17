// src/features/root-navigator/use-session-gate.ts
// The owner of the signed-in guard reports it for incoming links.
import { useLinkGate } from '@/hooks/use-link-gate';

export function useSessionGate(isSignedIn: boolean): void {
  useLinkGate('signed-in', isSignedIn);
}
