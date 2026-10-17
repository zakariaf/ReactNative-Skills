// document-rules.mjs: check-persistence rules for the save-document appendix (mode "document" or "both"):
// the file set, strict versioned schemas, the pure step chain, frozen JSON fixtures, the single writer
// with its guard, resets that keep protected sections, quarantine instead of delete, the slot tables.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fnv1a32 } from './database-health.mjs';
import { functionsOf, isTestFile } from './source-scan.mjs';
import { codeMatches, createTables } from './persistence-source.mjs';

const REQUIRED = [
  ['document-store.ts', 'the slot storage port'],
  ['sqlite-document-store.ts', 'the slots on SQL'],
  ['fake-document-store.ts', 'the in-memory store for tests'],
  ['document-tables.ts', 'the slot tables\' DDL and statements'],
  ['document-codec.ts', 'validate, encode, decode'],
  ['document-load-plan.ts', 'the pure load decision'],
  ['document-load-plan.test.ts', 'every branch of the load plan'],
  ['document-service.ts', 'the single writer'],
  ['document-service.test.ts', 'the writer\'s guard, counter and backup moments'],
  ['hydrate-document.ts', 'the synchronous startup load'],
  ['schema/app-document.ts', 'the latest version, named once'],
  ['schema/default-app-document.ts', 'the first-launch document'],
  ['migrations/document-migrations.ts', 'the ordered document steps'],
  ['migrations/document-migrations.test.ts', 'the step chain\'s test'],
  ['fixtures/fixture-checksums.ts', 'the frozen documents\' checksums'],
  ['fixtures/document-fixtures.test.ts', 'the test that replays every frozen document'],
];

export function checkDocument(ctx) {
  const dir = `${ctx.dataDir}/document`;
  for (const [file, why] of REQUIRED) {
    if (!ctx.exists(`${dir}/${file}`)) ctx.add({ file: `${dir}/${file}`, rule: 'missing-file', message: `required document file is missing (${why})`, fix: 'Copy it from the skill templates (templates/src/data/document/) and adapt it.' });
  }
  for (const rel of ctx.contract.document?.resetModules ?? [`${dir}/reset-document.ts`]) {
    if (!ctx.exists(rel)) ctx.add({ file: rel, rule: 'missing-file', message: 'a document reset module is missing', fix: 'Copy templates/src/data/document/reset-document.ts, or fix document.resetModules in the contract.' });
  }
  checkSlotTables(ctx, dir);
  checkService(ctx, dir);
  checkDocumentResets(ctx, dir);
  const latest = checkVersions(ctx, dir);
  checkSteps(ctx, dir, latest);
  checkDocumentFixtures(ctx, dir, latest);
}

function checkSlotTables(ctx, dir) {
  const tables = ctx.sources.get(`${dir}/document-tables.ts`);
  for (const entry of tables?.strings ?? []) {
    for (const table of createTables(entry.value).filter((item) => !item.isStrict)) {
      ctx.add({ file: tables.rel, line: entry.line, rule: 'pragmas', message: `document table ${table.name} is not STRICT`, fix: 'End every CREATE TABLE with ") STRICT".' });
    }
  }
  const steps = [...ctx.sources.values()].filter((src) => src.rel.startsWith(`${ctx.dataDir}/migrations/`) && !isTestFile(src.rel));
  const creates = steps.filter((src) => src.strings.some((entry) => createTables(entry.value).some((table) => table.name === 'document_slots')));
  if (creates.length === 0) {
    ctx.add({ file: `${ctx.dataDir}/migrations/vNNNN-create-document-slots.ts`, rule: 'migration-chain', message: 'no migration creates the document_slots table', fix: 'Add a step whose up() runs the DOCUMENT_SLOTS_DDL text (pasted as a literal) and append it to MIGRATIONS.' });
  }
  for (const src of ctx.sources.values()) {
    if (isTestFile(src.rel)) continue;
    for (const entry of src.strings.filter((item) => /DELETE\s+FROM\s+document_slots/i.test(item.value))) {
      ctx.add({ file: src.rel, line: entry.line, rule: 'quarantine-not-delete', message: 'deletes document slots', fix: 'Copy a bad row into document_quarantine (store.quarantine) and overwrite the slot; the damaged payload is the only evidence.' });
    }
  }
  const store = ctx.sources.get(`${dir}/sqlite-document-store.ts`);
  if (store !== undefined) {
    const writeAt = store.code.search(/\bwrite\s*:/);
    const body = writeAt === -1 ? '' : store.code.slice(writeAt, writeAt + 400).split(/\n\s{4}\w+\s*:/)[0];
    if (writeAt === -1 || !/\.transaction\s*\(/.test(body)) ctx.add({ file: store.rel, line: store.lineOf(writeAt), rule: 'transaction-write', message: 'write() does not run inside driver.transaction', fix: 'Wrap both UPSERTs in driver.transaction(() => ...) so current and backup commit together.' });
  }
}

function checkService(ctx, dir) {
  const src = ctx.sources.get(`${dir}/document-service.ts`);
  if (src === undefined) return;
  const validate = src.code.search(/\bvalidateAppDocument\s*\(/);
  const write = src.code.search(/\.write\s*\(/);
  if (validate === -1 || (write !== -1 && write < validate)) ctx.add({ file: src.rel, line: src.lineOf(Math.max(write, 0)), rule: 'validate-before-write', message: 'the document is not validated before it is written', fix: 'In the writer: validateAppDocument(next) first; an invalid document is logged (thrown in strict builds) and never written.' });
  const sections = ctx.contract.document?.protectedSections ?? ['premium'];
  const factory = functionsOf(src.scan).find((fn) => fn.name === 'createDocumentService' && fn.bodyStart !== -1);
  const found = factory === undefined ? -1 : src.code.slice(factory.bodyStart, factory.bodyEnd).search(/\bupdate\s*:\s*\(/);
  const updateAt = found === -1 ? -1 : factory.bodyStart + found;
  const update = updateAt === -1 ? '' : src.code.slice(updateAt, updateAt + 600).split(/\n\s{4}\w+\s*:/)[0];
  if (updateAt === -1) ctx.add({ file: src.rel, rule: 'validate-before-write', message: 'no update(recipe, options) method', fix: 'The service exposes update(recipe, { refreshBackup }); stores call it and nothing else writes.' });
  else {
    if (sections.length > 0 && !/\bkeep\w*Unless\w*\s*\(/.test(update)) ctx.add({ file: src.rel, line: src.lineOf(updateAt), rule: 'validate-before-write', message: `update() does not guard the protected sections (${sections.join(', ')})`, fix: 'const next = keepPremiumUnlessRevoked(doc, recipe(doc)) inside update(): an entitlement turns off only with a dated revocation, whoever writes.' });
    if (!/\bisReadOnly\b/.test(update)) ctx.add({ file: src.rel, line: src.lineOf(updateAt), rule: 'validate-before-write', message: 'update() ignores plan.isReadOnly', fix: 'A document from a newer build is never written: in update(), skip the write when plan.isReadOnly.' });
  }
}

function checkDocumentResets(ctx, dir) {
  const sections = ctx.contract.document?.protectedSections ?? ['premium'];
  for (const rel of ctx.contract.document?.resetModules ?? [`${dir}/reset-document.ts`]) {
    const src = ctx.sources.get(rel);
    if (src === undefined) continue;
    for (const section of sections) {
      for (const { index } of codeMatches(src, new RegExp(`\\b${section}\\s*:`, 'g'))) {
        ctx.add({ file: rel, line: src.lineOf(index), rule: 'protected-reset', message: `a reset writes the protected section ${section}`, fix: `Resets spread ...doc and replace only the sections they clear; ${sections.join(', ')} are never written by a reset.` });
      }
    }
  }
}

function checkVersions(ctx, dir) {
  const versions = [];
  for (const src of ctx.sources.values()) {
    const match = new RegExp(`^${dir}/schema/app-document-v(\\d+)\\.ts$`).exec(src.rel);
    if (match === null) continue;
    const version = Number(match[1]);
    versions.push(version);
    if (!new RegExp(`schemaVersion\\s*:\\s*v\\.literal\\(\\s*${version}\\s*\\)`).test(src.code)) {
      ctx.add({ file: src.rel, rule: 'schema-version', message: `app-document-v${version}.ts does not pin schemaVersion: v.literal(${version})`, fix: `Set schemaVersion: v.literal(${version}) in APP_DOCUMENT_V${version}.` });
    }
  }
  const latest = versions.length === 0 ? 0 : Math.max(...versions);
  const docRel = `${dir}/schema/app-document.ts`;
  const doc = ctx.sources.get(docRel);
  if (latest === 0) ctx.add({ file: `${dir}/schema/app-document-v1.ts`, rule: 'missing-file', message: 'no schema/app-document-vN.ts file', fix: 'Copy app-document-v1.ts and the section files from the templates.' });
  else if (doc !== undefined) {
    if (!new RegExp(`LATEST_DOCUMENT_VERSION\\s*=\\s*${latest}\\b`).test(doc.code)) ctx.add({ file: docRel, rule: 'schema-version', message: `LATEST_DOCUMENT_VERSION is not ${latest} (the highest app-document-vN.ts)`, fix: `Set LATEST_DOCUMENT_VERSION = ${latest} and LATEST_DOCUMENT_SCHEMA = APP_DOCUMENT_V${latest} together.` });
    if (!new RegExp(`LATEST_DOCUMENT_SCHEMA\\s*=\\s*APP_DOCUMENT_V${latest}\\b`).test(doc.code)) ctx.add({ file: docRel, rule: 'schema-version', message: `LATEST_DOCUMENT_SCHEMA is not APP_DOCUMENT_V${latest}`, fix: `Point LATEST_DOCUMENT_SCHEMA at APP_DOCUMENT_V${latest}.` });
  }
  return latest;
}

function checkSteps(ctx, dir, latest) {
  const listRel = `${dir}/migrations/document-migrations.ts`;
  const list = ctx.sources.get(listRel)?.code ?? '';
  for (let k = 1; k < latest; k += 1) {
    const step = `${dir}/migrations/v${k}-to-v${k + 1}.ts`;
    const src = ctx.sources.get(step);
    if (src === undefined) {
      ctx.add({ file: step, rule: 'migration-chain', message: `no document step v${k} -> v${k + 1}`, fix: `Write the pure step V${k}_TO_V${k + 1} = { from: ${k}, migrate } and append it to DOCUMENT_MIGRATIONS.` });
      continue;
    }
    if (!new RegExp(`from\\s*:\\s*${k}\\b`).test(src.code)) ctx.add({ file: step, rule: 'migration-chain', message: `the step does not declare from: ${k}`, fix: `Set from: ${k}.` });
    if (!new RegExp(`\\bV${k}_TO_V${k + 1}\\b`).test(list)) ctx.add({ file: listRel, rule: 'migration-chain', message: `DOCUMENT_MIGRATIONS does not list V${k}_TO_V${k + 1}`, fix: 'Append the step to DOCUMENT_MIGRATIONS (ordered, append-only).' });
    if (!ctx.exists(step.replace(/\.ts$/, '.test.ts'))) ctx.add({ file: step, rule: 'migration-chain', message: 'the step has no test', fix: `Add v${k}-to-v${k + 1}.test.ts: the v${k} minimal fixture becomes the exact v${k + 1} JSON, the full one validates, plus a fast-check property.` });
  }
  for (const src of ctx.sources.values()) {
    if (!new RegExp(`^${dir}/migrations/v\\d+-to-v\\d+\\.ts$`).test(src.rel)) continue;
    for (const entry of src.imports.filter((item) => !item.typeOnly)) {
      ctx.add({ file: src.rel, line: entry.line, rule: 'migration-pure', message: `imports ${entry.spec} at run time`, fix: "A step is frozen plain-JSON code: literal values only, at most `import type { DocumentMigration }`; never today's schema, defaults or runtime code." });
    }
    for (const { index, match } of codeMatches(src, /\b(Date\.now|new\s+Date|Math\.random)\s*\(/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'migration-pure', message: `calls ${match[1]}()`, fix: 'A step never reads the clock or randomness: the same old document must always give the same new one.' });
    }
  }
}

function checkDocumentFixtures(ctx, dir, latest) {
  const checksumsRel = `${dir}/fixtures/fixture-checksums.ts`;
  const checksums = ctx.sources.get(checksumsRel)?.raw ?? '';
  const testRel = `${dir}/fixtures/document-fixtures.test.ts`;
  const test = ctx.sources.get(testRel)?.raw ?? '';
  for (let version = 1; version <= latest; version += 1) {
    for (const kind of ['minimal', 'full']) {
      const name = `app-document-v${version}.${kind}`;
      const rel = `${dir}/fixtures/${name}.json`;
      if (!existsSync(join(ctx.root, rel))) {
        ctx.add({ file: rel, rule: 'fixture-missing', message: `no ${name}.json`, fix: `Write it with the v${version} build (minimal = the default document, full = every section filled), then freeze it.` });
        continue;
      }
      let json;
      try {
        json = JSON.parse(readFileSync(join(ctx.root, rel), 'utf8'));
      } catch {
        ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.json is not valid JSON`, fix: 'Restore the frozen file from git; fixtures are never edited.' });
        continue;
      }
      if (json?.schemaVersion !== version) ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.json has schemaVersion ${json?.schemaVersion}, expected ${version}`, fix: 'Restore the frozen file from git.' });
      const recorded = new RegExp(`['"]${name.replace(/\./g, '\\.')}['"]\\s*:\\s*['"]([0-9a-f]{8})['"]`).exec(checksums)?.[1];
      const actual = fnv1a32(JSON.stringify(json));
      if (recorded === undefined) ctx.add({ file: checksumsRel, rule: 'fixture-missing', message: `no checksum entry for ${name}`, fix: `Add '${name}': '${actual}' to DOCUMENT_FIXTURE_CHECKSUMS (a reviewed change).` });
      else if (recorded !== actual) ctx.add({ file: rel, rule: 'fixture-frozen', message: `${name}.json changed: fnv1a32 is ${actual}, the recorded checksum is ${recorded}`, fix: 'A shipped fixture is frozen: restore it from git. A new format is a new version with its own fixtures, never an edit.' });
      if (!test.includes(`'${name}'`)) ctx.add({ file: testRel, rule: 'fixture-untested', message: `${name} is not in FIXTURES`, fix: `Import ${name}.json and add { name: '${name}', version: ${version}, json } to FIXTURES.` });
    }
  }
}
