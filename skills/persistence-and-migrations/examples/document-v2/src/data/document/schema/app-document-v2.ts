// src/data/document/schema/app-document-v2.ts: document version 2. Frozen once shipped: a change is a v3 file, a step and new fixtures.
import * as v from 'valibot';

import { APP_DOCUMENT_V1 } from '@/data/document/schema/app-document-v1';
import { SETTINGS_V2 } from '@/data/document/schema/document-sections-v2';

export const APP_DOCUMENT_V2 = v.strictObject({
  ...APP_DOCUMENT_V1.entries,
  schemaVersion: v.literal(2),
  settings: SETTINGS_V2,
});

export type AppDocumentV2 = v.InferOutput<typeof APP_DOCUMENT_V2>;
