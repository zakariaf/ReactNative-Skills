// src/data/document/schema/document-sections-v2.ts: the sections document version 2 changes. Frozen once shipped.
import * as v from 'valibot';

import { SETTINGS_V1 } from '@/data/document/schema/document-sections-v1';

/** Text size in percent of the system size (text scales up to 200 %). */
export const TEXT_SCALE = v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(200));

/** Only CHANGED sections live here; every other section stays the frozen v1 schema. */
export const SETTINGS_V2 = v.strictObject({ ...SETTINGS_V1.entries, textScale: TEXT_SCALE });
