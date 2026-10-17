// src/features/account/account-guards.ts: React Navigation static `if` hooks live in a guards file.
import { useTasksStore } from '@/stores/tasks-store';

export function useIsPremiumGuard(): boolean {
  return useTasksStore((state) => state.isPremium);
}
