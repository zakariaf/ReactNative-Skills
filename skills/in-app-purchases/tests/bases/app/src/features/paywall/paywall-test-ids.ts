// src/features/paywall/paywall-test-ids.ts: the paywall's state test IDs (the screen renders one per state).
export const PAYWALL_TEST_IDS = {
  'state-loading': 'paywall.state.loading',
  'state-unavailable': 'paywall.state.unavailable',
  'state-purchasing': 'paywall.state.purchasing',
  'state-pending': 'paywall.state.pending',
  'state-success': 'paywall.state.success',
  'state-error': 'paywall.state.error',
  'state-save-failed': 'paywall.state.save-failed',
  'state-owned': 'paywall.state.owned',
  'buy-button': 'paywall.buy-button',
  'restore-button': 'paywall.restore-button',
  'try-again-button': 'paywall.try-again-button',
  'restoring-notice': 'paywall.restoring-notice',
  'restore-success-notice': 'paywall.restore-success-notice',
  'restore-empty-notice': 'paywall.restore-empty-notice',
  'restore-failed-notice': 'paywall.restore-failed-notice',
} as const;
