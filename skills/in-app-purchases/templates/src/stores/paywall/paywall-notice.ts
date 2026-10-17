// src/stores/paywall/paywall-notice.ts: the restore outcomes the paywall shows as notices over the page.
import type { PaywallFlowKind, PaywallState } from './paywall-state';

export type PaywallNotice = 'restoring' | 'restore-success' | 'restore-empty' | 'restore-failed';

const FLOW_NOTICE: Partial<Readonly<Record<PaywallFlowKind, PaywallNotice>>> = {
  restoring: 'restoring',
  'restore-empty': 'restore-empty',
  'restore-failed': 'restore-failed',
};

/**
 * The screen shows a notice when this value changes (not on every render) and announces it; after
 * 'restore-success' it dispatches 'clear-restore-notice' so the notice shows once.
 */
export function paywallNotice(state: PaywallState): PaywallNotice | null {
  const notice = FLOW_NOTICE[state.flow.kind];
  if (notice !== undefined) return notice;
  return state.didJustRestore ? 'restore-success' : null;
}
