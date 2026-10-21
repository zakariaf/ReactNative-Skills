// functions/src/subscriptions/revenuecat-webhook.ts (With Firebase): the HTTP shell around the handler.
// A shape to imitate, not a template: copy server/src/subscriptions/ to functions/src/subscriptions/,
// then adapt this file. 2nd-gen HTTPS function (not a callable: the caller is RevenueCat, so no App
// Check and no Firebase Auth); the Authorization header is the authentication. Verified to compile
// with firebase-functions 7.4.0 and firebase-admin 14.5.0 on 2026-10-21.
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

import { createRevenueCatSubscriberApi } from './revenuecat-rest-subscriber-api';
import { handleRevenueCatWebhook } from './revenuecat-webhook-handler';

import type { EventLedger, EntitlementWriter, WebhookDeps } from './webhook-ports';

/** The exact Authorization header value typed into the RevenueCat dashboard's webhook settings. */
const WEBHOOK_AUTHORIZATION = defineSecret('REVENUECAT_WEBHOOK_AUTHORIZATION');
/** The RevenueCat project's secret REST API key (sk_...), for GET /v1/subscribers. */
const REVENUECAT_SECRET_API_KEY = defineSecret('REVENUECAT_SECRET_API_KEY');

/** Firestore's ALREADY_EXISTS: `create` refused because the document is there. */
const ALREADY_EXISTS = 6;

function firestoreLedger(): EventLedger {
  const events = getFirestore().collection('webhookEvents');
  return {
    claim: async (eventId) => {
      try {
        await events.doc(eventId).create({ claimedAtMs: Date.now() });
        return 'claimed';
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === ALREADY_EXISTS) return 'duplicate';
        throw error;
      }
    },
    release: async (eventId) => {
      await events.doc(eventId).delete();
    },
  };
}

/** users/{uid}/entitlement/main: written only here and by the sync callable; security rules deny every client write. */
function firestoreEntitlements(): EntitlementWriter {
  return {
    write: async (userId, doc) => {
      await getFirestore().doc(`users/${userId}/entitlement/main`).set(doc);
    },
  };
}

export const revenuecatWebhook = onRequest(
  { secrets: [WEBHOOK_AUTHORIZATION, REVENUECAT_SECRET_API_KEY], maxInstances: 5, timeoutSeconds: 50 },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('method not allowed');
      return;
    }
    const deps: WebhookDeps = {
      expectedAuthorization: WEBHOOK_AUTHORIZATION.value(),
      entitlementId: 'premium',
      ledger: firestoreLedger(),
      subscribers: createRevenueCatSubscriberApi({ secretApiKey: REVENUECAT_SECRET_API_KEY.value() }),
      entitlements: firestoreEntitlements(),
      nowMs: () => Date.now(),
      // Structured, receipt-free entries: event id, type, environment, outcome; never a user id or receipt.
      log: (entry) => {
        logger.info('revenuecat-webhook', entry);
      },
    };
    const result = await handleRevenueCatWebhook(
      { authorization: request.get('authorization') ?? null, body: request.body as unknown },
      deps,
    );
    response.status(result.status).send(result.body);
  },
);
