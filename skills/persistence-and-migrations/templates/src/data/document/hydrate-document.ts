// src/data/document/hydrate-document.ts: the synchronous startup load of the app document: read, plan, write, return the service.
import { lastWriteCount, planLoad } from '@/data/document/document-load-plan';
import { createDocumentService } from '@/data/document/document-service';

import type { LoadOutcome } from '@/data/document/document-load-plan';
import type { DocumentService, DocumentServiceDeps } from '@/data/document/document-service';

export type HydrateDocumentDeps = DocumentServiceDeps & {
  /** The identity every stored document must carry (contracts/persistence.json document.appId). */
  readonly appId: string;
};

export type HydratedDocument = {
  readonly document: DocumentService;
  /** Drives the message on the first screen (backup restored, please update, ...). */
  readonly outcome: LoadOutcome;
};

/**
 * Runs after openAppDatabase and before the first render. Never throws for a data reason: a
 * damaged row falls back to the backup, and a document from a newer build plays in memory.
 */
export function hydrateDocument(deps: HydrateDocumentDeps): HydratedDocument {
  const { store, appId } = deps;
  const input = { current: store.read('current'), backup: store.read('backup'), appId };
  const plan = planLoad(input);
  const document = createDocumentService(deps, plan, lastWriteCount(input));
  document.applyLoadWrites();
  return { document, outcome: plan.outcome };
}
