// An installed skill's planted bug: never scanned (agent skill folders are skipped).
const IS_TEST = process.env.EXPO_PUBLIC_APP_VARIANT !== 'production';
export const DEBUG = IS_TEST ? require('./debug-menu') : null;
export const TOKEN = process.env.SENTRY_AUTH_TOKEN;
export const DECOY_SENTINEL = 'DECOY_AGENTS_SENTINEL';
