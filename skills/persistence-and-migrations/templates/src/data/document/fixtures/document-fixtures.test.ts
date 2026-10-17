// src/data/document/fixtures/document-fixtures.test.ts: every frozen document stays unchanged, upgrades, and survives a round trip.
import { fnv1a32 } from '@/data/checksum';
import { decodeSlot, encodeAppDocument } from '@/data/document/document-codec';
import { LATEST_DOCUMENT_VERSION } from '@/data/document/schema/app-document';

import appDocumentV1Full from './app-document-v1.full.json';
import appDocumentV1Minimal from './app-document-v1.minimal.json';
import { DOCUMENT_FIXTURE_CHECKSUMS } from './fixture-checksums';

import type { SlotRecord } from '@/data/document/document-store';

const APP_ID = 'tasks-app';

/** Every document version ever shipped, as the JSON that version wrote. Append only. */
const FIXTURES = [
  { name: 'app-document-v1.minimal', version: 1, json: appDocumentV1Minimal },
  { name: 'app-document-v1.full', version: 1, json: appDocumentV1Full },
] as const;

function asStoredRow(json: unknown, version: number): SlotRecord {
  const payload = JSON.stringify(json);
  return {
    schemaVersion: version,
    appVersion: 'fixture',
    writtenAtMs: 0,
    writeCount: 1,
    checksum: fnv1a32(payload),
    payload,
  };
}

describe('document fixtures', () => {
  it('covers every shipped version with a minimal and a full document', () => {
    const versions = FIXTURES.map((fixture) => fixture.version);
    for (let version = 1; version <= LATEST_DOCUMENT_VERSION; version += 1) {
      expect(versions.filter((each) => each === version)).toHaveLength(2);
    }
  });

  it.each(FIXTURES)('keeps $name frozen', ({ name, json }) => {
    expect(fnv1a32(JSON.stringify(json))).toBe(DOCUMENT_FIXTURE_CHECKSUMS[name]);
  });

  it.each(FIXTURES)('upgrades $name to a valid latest document', ({ json, version }) => {
    expect(decodeSlot(asStoredRow(json, version), APP_ID).kind).toBe('ok');
  });

  it.each(FIXTURES)('keeps $name through an encode and decode round trip', ({ json, version }) => {
    const first = decodeSlot(asStoredRow(json, version), APP_ID);
    if (first.kind !== 'ok') throw new Error('the fixture must decode');
    const meta = { appVersion: 't', writtenAtMs: 1, writeCount: 2 };
    const again = decodeSlot(encodeAppDocument(first.doc, meta), APP_ID);
    expect(again).toStrictEqual({ kind: 'ok', doc: first.doc, migratedFrom: null });
  });
});
