// src/data/migrations/fixtures/fixture-checksums.ts: the recorded checksums of the frozen database fixtures.
// A shipped schema is a compatibility contract: real phones hold these databases. A changed value
// here is a reviewed change (a Gate-Change commit trailer, or a CODEOWNERS rule on this folder).

/** fnv1a32 of each fixture's text with CRLF read as LF. One entry per shipped version. Append only. */
export const FIXTURE_CHECKSUMS = {
  'db-v1': '7cb0d956',
  'db-v2': 'e46016b6',
} as const;
