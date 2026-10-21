// functions/src/config/global-options.ts
// Imported first by index.ts: onCall() and every other trigger read the global options when they are
// created (at import time), so this module must run before any function module is evaluated.
import { setGlobalOptions } from 'firebase-functions/v2/options';

export const FUNCTION_REGION = '__FUNCTIONS_REGION__';

setGlobalOptions({
  region: FUNCTION_REGION,
  // A hard ceiling on concurrent instances, so a loop or an abusive client cannot scale spend without limit.
  maxInstances: 10,
  timeoutSeconds: 30,
  memory: '256MiB',
});
