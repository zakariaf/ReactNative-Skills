// src/data/document/peek-current-document.ts: the startup peek at the current document (for example its language), read-only.
// device-only: covered by the flow that restarts the app into its saved language; peekDatabase's reads run on node:sqlite.
import { SELECT_SLOT_SQL } from '@/data/document/document-tables';
import { peekDatabase } from '@/data/peek-database';

import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/**
 * The parsed `current` payload, or null. No validation, no migration, no write: a reload may
 * follow, and the full load (which can restore the backup) runs after it.
 */
export function peekCurrentDocument(errorLog: Pick<ErrorLogPort, 'record'>): unknown {
  return peekDatabase(
    (reader) => {
      const payload = reader.get(SELECT_SLOT_SQL, ['current'])?.['payload'];
      return typeof payload === 'string' ? (JSON.parse(payload) as unknown) : null;
    },
    null,
    errorLog,
  );
}
