#!/usr/bin/env node
// check-mutation-report.mjs: reads Stryker's JSON report (reports/stryker/mutation.json by default),
// computes the mutation score, lists every surviving or uncovered mutant with its line and
// replacement, and fails when the score is under the break threshold (at least 75) or a file named
// with --changed still has one.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-mutation-report.mjs [repo-root] --changed <file>

import { existsSync, readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { isAbsolute, join, relative } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, requireFile, run, toPosix } from './check-lib.mjs';

const DEFAULT_REPORT = 'reports/stryker/mutation.json';

const SPEC = {
  name: 'check-mutation-report',
  summary: 'Checks a Stryker mutation report: overall score at or above the break threshold, and no surviving or uncovered mutant in the files you just finished.',
  usage: '[repo-root] [options]',
  options: {
    report: { type: 'string', value: 'file', help: `The Stryker JSON report, relative to the repo root (default: ${DEFAULT_REPORT})` },
    changed: { type: 'string', multiple: true, value: 'file', help: 'A source file (repo-relative) that must have no Survived or NoCoverage mutant' },
    allow: { type: 'string', multiple: true, value: 'id', help: 'A mutant id accepted as equivalent (write why in the change report)' },
    break: { type: 'string', value: 'n', help: 'Minimum score in percent (default: the report\'s thresholds.break, at least 75)' },
    all: { type: 'boolean', help: 'List every undetected mutant of every file (default: one summary line per file)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    `The json reporter in stryker.config.json writes ${DEFAULT_REPORT}.`,
    'Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage); Ignored, CompileError and',
    'RuntimeError mutants do not count.',
    '',
    'Rules:',
    '  mutation-score       the overall score is below the break threshold',
    '  survivor             a mutant in a --changed file survived (no test failed when the code changed)',
    '  no-coverage          a mutant in a --changed file was never run by any test',
    '  changed-not-mutated  a --changed file is not in the report (run: npx stryker run --mutate <file>); a file that',
    '                       holds only types (nothing left once the types are stripped) has no mutant and gets a note',
    '  allow-unknown        an --allow id matches no mutant in the report',
    '  no-valid-mutant      a file in the report (named with --changed or not), or the whole report, has mutants but',
    '                       none was tested (all Ignored, CompileError or RuntimeError): usually static mutants,',
    '                       because the tests call the code at module scope and ignoreStatic skips them; the file then',
    '                       drops out of the score, and when every file does Stryker reports a score of NaN as a pass.',
    '                       A file whose every mutant is a CompileError gets a note instead: the TypeScript checker',
    '                       rejected each change (Stryker\'s dry-run compile passed, so the types themselves rule it',
    '                       out), as with the canonical src/core/result.ts (verified with Stryker 10, 12 of 12)',
    '',
    'Other files get one note line each (counts and first line); --all lists every mutant, for the change report.',
  ].join('\n'),
};

const DETECTED = new Set(['Killed', 'Timeout']);
const STATIC_FIX = 'Call the code under test inside it() (a module-level const in a test file runs at import, so Stryker\'s perTest coverage marks every mutant static and ignoreStatic skips it); if the checker rejected them, fix the type errors; then rerun Stryker.';
const UNDETECTED = new Set(['Survived', 'NoCoverage']);
/** Every mutant failed to compile: the TypeScript checker rejected each change, so nothing is left for a test. */
const allTypeRejected = (mutants) => mutants.length > 0 && mutants.every((mutant) => mutant.status === 'CompileError');
const typeRejectedNote = (file, count) => `note ${file} all ${count} of its mutants failed to compile (CompileError): its types already rule out every change, so no test can or must kill them`;

function loadReport(path, label) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${String(error.message).split('\n')[0]}`, 'Rerun Stryker (npm run test:mutation) to write a fresh report.');
  }
  if (typeof data !== 'object' || data === null || typeof data.files !== 'object' || data.files === null) {
    fail(`${label} has no "files" object; it is not a Stryker mutation report`, `Point --report at ${DEFAULT_REPORT}.`);
  }
  return data;
}

/**
 * True when the file holds only types: once Node strips the TypeScript syntax, nothing but comments
 * and whitespace is left, so Stryker has no mutant to make and leaves the file out of its report.
 * False when the file is missing or Node lacks stripTypeScriptTypes (Node 22.13+): then the file must
 * be in the report.
 */
function isTypesOnly(path) {
  if (!existsSync(path) || typeof nodeModule.stripTypeScriptTypes !== 'function') return false;
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    const code = nodeModule.stripTypeScriptTypes(readFileSync(path, 'utf8'));
    return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim() === '';
  } catch {
    return false;
  } finally {
    process.emitWarning = emit;
  }
}

const clean = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 80);

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const label = toPosix(options.report ?? DEFAULT_REPORT);
  const path = isAbsolute(label) ? label : join(root, label);
  if (!existsSync(path)) fail(`nothing to check: ${label} does not exist`, 'Run npx stryker run --mutate <file> (or npm run test:mutation) first; the json reporter writes this file.');
  requireFile(path, 'mutation report');
  const data = loadReport(path, label);
  const breakAt = options.break === undefined ? Math.max(75, Number(data.thresholds?.break ?? 75)) : Number(options.break);
  if (!Number.isFinite(breakAt) || breakAt < 75) fail(`--break ${options.break} is below 75`, 'The break threshold is a gate: never run with less than 75.');
  const allowed = new Set(options.allow);
  // Stryker writes file keys relative to the project it ran in; accept --changed relative to the root.
  const changed = new Set(options.changed.map((file) => toPosix(isAbsolute(file) ? relative(root, file) : file).replace(/^\.\//, '')));
  const report = createReporter({ name: SPEC.name, json: options.json });
  let detected = 0;
  let undetected = 0;
  let total = 0;
  const seenIds = new Set();
  for (const [file, entry] of Object.entries(data.files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const mutants = Array.isArray(entry?.mutants) ? entry.mutants : [];
    const summary = { Survived: 0, NoCoverage: 0, firstLine: 0 };
    // Every file, changed or not: in a nightly run a file whose mutants were all skipped silently leaves the score.
    if (allTypeRejected(mutants)) {
      report.note(typeRejectedNote(file, mutants.length));
    } else if (mutants.length > 0 && !mutants.some((mutant) => DETECTED.has(mutant.status) || UNDETECTED.has(mutant.status))) {
      const statuses = [...new Set(mutants.map((mutant) => mutant.status))].join(', ');
      const reason = clean(mutants.find((mutant) => mutant.statusReason)?.statusReason ?? statuses);
      report.problem({ file, line: mutants[0].location?.start?.line ?? 0, rule: 'no-valid-mutant', message: `none of its ${mutants.length} mutants was tested (${statuses}: ${reason})`, fix: STATIC_FIX });
    }
    for (const mutant of mutants) {
      total += 1;
      seenIds.add(String(mutant.id));
      if (DETECTED.has(mutant.status)) detected += 1;
      if (!UNDETECTED.has(mutant.status)) continue;
      const isAllowed = allowed.has(String(mutant.id));
      if (!isAllowed) undetected += 1;
      const line = mutant.location?.start?.line ?? 0;
      const what = `${mutant.mutatorName} mutant ${mutant.id} ${mutant.status === 'Survived' ? 'survived' : 'was never run by a test'}: "${clean(mutant.replacement ?? '')}"`;
      if (isAllowed) {
        report.note(`note ${file}:${line} ${what} (accepted as equivalent with --allow)`);
      } else if (changed.has(file)) {
        report.problem({ file, line, rule: mutant.status === 'Survived' ? 'survivor' : 'no-coverage', message: what, fix: mutant.status === 'Survived' ? 'Add the example that tells the real code from this change (usually a boundary: exactly the limit, the same millisecond, an empty list), or delete dead code.' : 'Add a test that runs this line (often a branch or action no test reaches).' });
      } else if (options.all) {
        report.note(`note ${file}:${line} ${what}`);
      } else {
        summary[mutant.status] += 1;
        summary.firstLine = summary.firstLine || line;
      }
    }
    if (summary.Survived + summary.NoCoverage > 0) report.note(`note ${file}:${summary.firstLine} ${summary.Survived} survived, ${summary.NoCoverage} without coverage (details: --changed ${file} or --all)`);
  }
  for (const file of changed) {
    if (file in data.files) continue;
    if (isTypesOnly(join(root, file))) {
      report.note(`note ${file} holds only types: Stryker has nothing to mutate`);
      continue;
    }
    report.problem({ file, line: 0, rule: 'changed-not-mutated', message: 'is not in the mutation report', fix: `Run npx stryker run --mutate ${file}, then rerun this check.` });
  }
  for (const id of allowed) {
    if (!seenIds.has(id)) report.problem({ file: label, line: 0, rule: 'allow-unknown', message: `--allow ${id} matches no mutant in the report`, fix: 'Pass the id shown in the survivor line, or drop the --allow.' });
  }
  const valid = detected + undetected;
  const score = valid === 0 ? 100 : (detected / valid) * 100;
  if (valid === 0 && total > 0) {
    report.note(`mutation score n/a (0 valid mutants; ${total} in the report; break ${breakAt}%)`);
    const all = Object.values(data.files).flatMap((entry) => (Array.isArray(entry?.mutants) ? entry.mutants : []));
    if (allTypeRejected(all)) return report.finish({ checked: total, unit: 'mutants' });
    report.problem({ file: label, line: 0, rule: 'no-valid-mutant', message: `none of the ${total} mutants in the report was tested, so no score was measured`, fix: STATIC_FIX });
    return report.finish({ checked: total, unit: 'mutants' });
  }
  report.note(`mutation score ${score.toFixed(1)}% (${detected} detected of ${valid} valid mutants; ${total} in the report; break ${breakAt}%)`);
  if (score < breakAt) report.problem({ file: label, line: 0, rule: 'mutation-score', message: `mutation score ${score.toFixed(1)}% is below the break threshold ${breakAt}%`, fix: 'Kill the listed survivors with boundary examples (never by relaxing thresholds or disabling mutants), then rerun Stryker.' });
  return report.finish({ checked: total, unit: 'mutants' });
});
