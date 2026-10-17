// src/stores/session/session-selectors.ts
import { create } from 'zustand';

const useSession = create<{ readonly isSignedIn: boolean }>(() => ({ isSignedIn: false }));

export function useIsSignedIn(): boolean {
  return useSession((state) => state.isSignedIn);
}
