// src/data/document/fixtures/fixture-checksums.ts: the recorded checksums of the frozen document fixtures.
// A shipped document version is a compatibility contract: real phones hold these documents. A
// changed value here is a reviewed change (a Gate-Change commit trailer, or CODEOWNERS on this folder).

/** fnv1a32(JSON.stringify(fixture)): formatting may change, content may not. Append only. */
export const DOCUMENT_FIXTURE_CHECKSUMS = {
  'app-document-v1.minimal': '582156a1',
  'app-document-v1.full': 'f98df6f5',
  'app-document-v2.minimal': '3f518676',
  'app-document-v2.full': '5ec7d0c8',
} as const;
