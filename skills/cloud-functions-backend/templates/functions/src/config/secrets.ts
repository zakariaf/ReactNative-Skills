// functions/src/config/secrets.ts
// Every secret is declared here and bound only on the functions that read it (their `secrets` option).
// Values live in Cloud Secret Manager (`firebase functions:secrets:set SUMMARY_API_KEY`, run by the
// developer) and, for the emulator, in the git-ignored functions/.secret.local.
import { defineSecret } from 'firebase-functions/params';

export const SUMMARY_API_KEY = defineSecret('SUMMARY_API_KEY');
