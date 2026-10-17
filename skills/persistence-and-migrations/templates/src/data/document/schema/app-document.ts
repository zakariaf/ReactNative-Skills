// src/data/document/schema/app-document.ts: the one place that names the latest document version.
import { APP_DOCUMENT_V1 } from '@/data/document/schema/app-document-v1';

import type { AppDocumentV1 } from '@/data/document/schema/app-document-v1';

/** Deeply immutable view of the latest document; reducers return new objects. */
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Bump the two lines together, and the type below with them. */
export const LATEST_DOCUMENT_VERSION = 1;
export const LATEST_DOCUMENT_SCHEMA = APP_DOCUMENT_V1;

/** Code outside schema/ imports these types only, never a -vN file: a version bump changes one file. */
export type AppDocument = DeepReadonly<AppDocumentV1>;
export type AppSettings = AppDocument['settings'];
