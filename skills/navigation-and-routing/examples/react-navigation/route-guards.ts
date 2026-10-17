// src/features/root-navigator/route-guards.ts (React Navigation static API): the groups' `if` hooks.
// They run on every render of the navigator; a group whose hook returns false is not registered, so
// finishing onboarding is a store dispatch, never navigate() or reset().
import { isTestBuild } from '@/features/debug/test-build';
import { selectIsOnboarded } from '@/stores/onboarding/onboarding-selectors';
import { useOnboardingStore } from '@/stores/onboarding/onboarding-store';

export function useIsOnboarding(): boolean {
  return !useOnboardingStore(selectIsOnboarded);
}

export function useIsOnboarded(): boolean {
  return useOnboardingStore(selectIsOnboarded);
}

/** Debug group: test builds only. The gate drives the group, never what the bundle contains. */
export function useIsTestBuild(): boolean {
  return isTestBuild;
}
