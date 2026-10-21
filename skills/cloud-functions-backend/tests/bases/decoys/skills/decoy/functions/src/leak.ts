// Planted findings: an installed or vendored skill's fixture. Every scan must skip this file.
import * as functions from 'firebase-functions/v1';
import { onCall } from 'firebase-functions/v2/https';

export const leaky = onCall(async (request) => request.data.title);
export const legacy = functions.https.onCall(() => process.env.SUMMARY_API_KEY);
