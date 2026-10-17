// __mocks__/@sentry/react-native.ts — root manual mock (automatic in every Jest project).
// @sentry/react-native 7.11 starts a setInterval when it is imported (its time-to-display fallback
// map), so any suite that reaches the crash reporter adapter, even through the composition root,
// keeps Jest from exiting ("A worker process has failed to exit gracefully"). Nothing in a test may
// reach Sentry's servers either. The functions below are the ones the adapter calls; the adapter
// test scripts and asserts them through jest.mock('@sentry/react-native') + a typed
// jest.requireMock('@sentry/react-native').
export const init = jest.fn();
export const captureException = jest.fn();
export const addBreadcrumb = jest.fn();
export const close = jest.fn(() => Promise.resolve(true));
export const flush = jest.fn(() => Promise.resolve(true));
export const reactNativeErrorHandlersIntegration = jest.fn((options: object = {}) => ({
  name: 'ReactNativeErrorHandlers',
  options,
}));
