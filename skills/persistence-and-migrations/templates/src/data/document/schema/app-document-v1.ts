// src/data/document/schema/app-document-v1.ts: document version 1. Frozen once shipped: a change is a v2 file, a step and new fixtures.
import * as v from 'valibot';

import { KEBAB_ID } from '@/data/document/schema/document-primitives';
import {
  ONBOARDING_V1,
  PREMIUM_V1,
  SETTINGS_V1,
  STATS_V1,
} from '@/data/document/schema/document-sections-v1';

/** strictObject everywhere: an unknown key is an error, so a typo in a step cannot slip through. */
export const APP_DOCUMENT_V1 = v.strictObject({
  schemaVersion: v.literal(1),
  appId: KEBAB_ID,
  settings: SETTINGS_V1,
  onboarding: ONBOARDING_V1,
  stats: STATS_V1,
  premium: PREMIUM_V1,
});

export type AppDocumentV1 = v.InferOutput<typeof APP_DOCUMENT_V1>;
