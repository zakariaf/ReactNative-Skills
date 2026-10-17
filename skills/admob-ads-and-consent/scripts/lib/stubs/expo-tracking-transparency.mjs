// Scripted stand-in for expo-tracking-transparency (SDK 57), used only by check-ad-behaviour.mjs
// (load-ts.mjs resolves the package to this file). It records every call in order and answers
// from the script: the status before the prompt and the user's answer to it. Not an entry point.
// The real package reports ATTrackingManager's restricted as 'denied' (like a declined prompt).

const state = { calls: [], status: 'undetermined', answer: 'denied', fail: false };

export const trackingStub = {
  /** status: 'granted' | 'denied' | 'undetermined'; answer: what the prompt returns; fail: reads reject. */
  reset({ status = 'undetermined', answer = 'denied', fail = false } = {}) {
    state.calls.length = 0;
    state.status = status;
    state.answer = answer;
    state.fail = fail;
  },
  calls: () => [...state.calls],
};

export const PermissionStatus = { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' };

const response = (status) => ({ status, granted: status === 'granted', canAskAgain: status === 'undetermined', expires: 'never' });

export async function getTrackingPermissionsAsync() {
  state.calls.push('getTrackingPermissionsAsync');
  if (state.fail) throw new Error('tracking module unavailable');
  return response(state.status);
}

export async function requestTrackingPermissionsAsync() {
  state.calls.push('requestTrackingPermissionsAsync');
  if (state.status === 'undetermined') state.status = state.answer;
  return response(state.status);
}
