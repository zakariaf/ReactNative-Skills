// review-record.mjs: one design review's record (design-review/<review-id>/review.json): loading it,
// its shape, and the rules check-review.mjs and check-signoff.mjs share (findings and grades, the
// on-device pass, the one fix round, the sign-off). Not an entry point. Also the JSON writer
// new-review.mjs uses, laid out the way Prettier lays out JSON (printWidth 100), so a generated record
// passes the app's prettier --check.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toPosix, UsageError } from '../check-lib.mjs';
import { CORE_STEPS, isIsoDay, isObject, jsonLine, KEBAB, localToday, MIN_WHY } from './review-plan.mjs';

export const RECORD_FILE = 'review.json';
export const GRADES = ['BLOCKER', 'FIX', 'NOTE'];
export const LENSES = ['floor', 'identity', 'parity', 'motion', 'behaviour'];
/** The accessibility floor: a finding of any of these kinds is a BLOCKER, however good the rest looks. */
export const FLOOR_KINDS = ['contrast', 'touch-target', 'text-scale', 'colour-alone', 'direction', 'reduce-motion', 'screen-reader', 'assistive-access'];
export const STATUSES = ['open', 'fixed', 'deferred', 'escalated'];
export const OPENED_IN = ['sweep', 'device-pass', 'verify'];
export const RESULTS = ['pass', 'fail', 'n/a'];
export const VERDICTS = ['SIGNED OFF', 'NOT SIGNED OFF'];
const RECORD_KEYS = new Set(['$comment', 'version', 'id', 'startedOn', 'plan', 'screens', 'build', 'cells', 'videos', 'devicePass', 'findings', 'fixRound', 'signoff']);
const FINDING_KEYS = new Set(['grade', 'lens', 'floor', 'what', 'cells', 'videos', 'step', 'screen', 'status', 'openedIn', 'seen', 'backlog', 'fix']);
const COMMIT = /^[0-9a-f]{7,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The review folders of the repo, oldest first (ids start with the day, so names sort by date). */
export function reviewIds(root, reviewsDir) {
  const abs = join(root, reviewsDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(abs, entry.name, RECORD_FILE)))
    .map((entry) => entry.name)
    .sort();
}

/** One review record: the given id, or the newest; a UsageError when there is none (nothing to check). */
export function loadReview(root, loaded, id) {
  const ids = reviewIds(root, loaded.reviewsDir);
  const chosen = id ?? ids.at(-1);
  if (!chosen) {
    throw new UsageError(`nothing to check: no ${toPosix(join(loaded.reviewsDir, '<review-id>', RECORD_FILE))}`, 'Start the review with new-review.mjs (it writes the record from the plan).');
  }
  const rel = toPosix(join(loaded.reviewsDir, chosen, RECORD_FILE));
  const abs = join(root, rel);
  if (!existsSync(abs)) throw new UsageError(`nothing to check: ${rel} not found`, `Pass an existing review id (${ids.join(', ') || 'none yet'}).`);
  const text = readFileSync(abs, 'utf8');
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${error.message})`, 'Fix the record; templates and examples/tasks-review.json show the shape.');
  }
  return { id: chosen, rel, text, record, capturesDir: toPosix(join(loaded.capturesDir, chosen)) };
}

/** Shape problems (rule review-record); an empty list means the other rules can read it. */
export function recordShapeProblems(review) {
  const { record, text, rel, id } = review;
  const problems = [];
  const add = (message, needle, fix = 'Keep the shape new-review.mjs writes (references/record-and-signoff.md).') =>
    problems.push({ file: rel, line: needle ? jsonLine(text, needle) : 1, rule: 'review-record', message, fix });
  if (!isObject(record)) {
    add('the record is not a JSON object');
    return problems;
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) add(`unknown key "${key}"`, `"${key}"`, key === 'fixRounds' ? 'A review has exactly one fix round: a surviving BLOCKER is escalated, never fixed in a second round.' : undefined);
  }
  if (record.version !== 1) add('"version" must be 1', '"version"');
  if (record.id !== id) add(`"id" must be the folder name "${id}"`, '"id"');
  if (!isIsoDay(record.startedOn)) add('"startedOn" must be a YYYY-MM-DD day', '"startedOn"');
  for (const key of ['plan', 'screens']) {
    if (!isObject(record[key]) || typeof record[key].file !== 'string' || !SHA256.test(record[key].sha256 ?? '')) add(`"${key}" must hold the file and its sha256 at review time`, `"${key}"`);
  }
  if (!isObject(record.build)) add('"build" must name the variant, appVersion, commit and the verify result', '"build"');
  for (const key of ['cells', 'videos']) {
    if (!isObject(record[key]) || Object.values(record[key]).some((v) => v !== null && !SHA256.test(String(v)))) add(`"${key}" must map each name to the capture's sha256 (null until captured)`, `"${key}"`);
  }
  if (!isObject(record.devicePass)) add('"devicePass" must map each hardware id to its results', '"devicePass"');
  if (!isObject(record.findings)) add('"findings" must map each finding id (F1, F2, ...) to the finding', '"findings"');
  if (record.fixRound !== null && record.fixRound !== undefined && !isObject(record.fixRound)) add('"fixRound" must be one object or null (a review has exactly one fix round)', '"fixRound"');
  if (record.signoff !== null && record.signoff !== undefined && !isObject(record.signoff)) add('"signoff" must be an object or null', '"signoff"');
  return problems;
}

/** Build facts every rule reads. */
export function buildProblems(review, plan, report) {
  const { record, rel, text } = review;
  const build = record.build;
  const line = jsonLine(text, '"build"');
  if (build.variant !== plan.build.variant) {
    report.problem({ file: rel, line, rule: 'review-record', message: `the review swept variant ${JSON.stringify(build.variant)}, the plan says "${plan.build.variant}"`, fix: 'Sweep the build the plan names (a release build), then record it.' });
  }
  if (typeof build.appVersion !== 'string' || build.appVersion.trim() === '') {
    report.problem({ file: rel, line, rule: 'review-record', message: '"build.appVersion" is empty', fix: 'Write the app version of the swept build (app config "version").' });
  }
  if (!COMMIT.test(build.commit ?? '')) {
    report.problem({ file: rel, line, rule: 'review-record', message: `"build.commit" must be the commit the swept build came from (found ${JSON.stringify(build.commit)})`, fix: 'Write `git rev-parse HEAD` of the build.' });
  }
  if (build.verify !== 'pass') {
    report.problem({ file: rel, line, rule: 'review-record', message: '"build.verify" is not "pass": the review starts only when every gate and test is green', fix: 'Run the gates (npm run verify) on that commit first; the review judges only what machines cannot.' });
  }
}

const findingLine = (review, id) => jsonLine(review.text, '"findings"', `"${id}"`);

/** Findings: shape, references, grade rules (review-findings, review-floor). */
export function checkFindings(review, plan, report) {
  const { record, rel } = review;
  const cells = record.cells;
  const videos = record.videos;
  const steps = new Set(plan.devicePass.steps.map((s) => s.id));
  const hardware = new Set(plan.devicePass.hardware.map((h) => h.id));
  for (const [id, finding] of Object.entries(record.findings)) {
    const line = findingLine(review, id);
    const add = (rule, message, fix) => report.problem({ file: rel, line, rule, message: `finding ${id}: ${message}`, fix });
    if (!/^F[1-9][0-9]*$/.test(id) || !isObject(finding)) {
      add('review-findings', 'needs an id F1, F2, ... and an object', 'Number findings in the order they are found.');
      continue;
    }
    for (const key of Object.keys(finding)) if (!FINDING_KEYS.has(key)) add('review-findings', `unknown key "${key}"`, 'Keep the finding format of references/grading-rubric.md.');
    if (!GRADES.includes(finding.grade)) add('review-findings', `grade ${JSON.stringify(finding.grade)} is not BLOCKER, FIX or NOTE`, 'Grade every finding.');
    if (!LENSES.includes(finding.lens)) add('review-findings', `lens ${JSON.stringify(finding.lens)} is not one of ${LENSES.join(', ')}`, 'Name the lens that found it.');
    if (typeof finding.what !== 'string' || finding.what.trim().length < 10) add('review-findings', 'says nothing ("what" needs a sentence)', 'Write what is wrong, where, and what was expected.');
    if (!STATUSES.includes(finding.status)) add('review-findings', `status ${JSON.stringify(finding.status)} is not one of ${STATUSES.join(', ')}`, 'Set the status.');
    if (!OPENED_IN.includes(finding.openedIn)) add('review-findings', `openedIn ${JSON.stringify(finding.openedIn)} is not one of ${OPENED_IN.join(', ')}`, 'Say which part of the review found it.');
    const where = [finding.cells, finding.videos, finding.step, finding.screen].filter((v) => v !== undefined);
    if (where.length === 0) add('review-findings', 'points at nothing', 'Name the cells, videos, the device step ("<hardware>/<step>") or the screen it was seen on.');
    for (const cell of Array.isArray(finding.cells) ? finding.cells : []) if (!(cell in cells)) add('review-findings', `cell "${cell}" is not in the inventory`, 'Use the exact cell name (check-review-plan.mjs --list).');
    for (const video of Array.isArray(finding.videos) ? finding.videos : []) if (!(video in videos)) add('review-findings', `video "${video}" is not in the inventory`, 'Use the exact video name.');
    if (finding.step !== undefined) {
      const [hw, step] = String(finding.step).split('/');
      if (!hardware.has(hw) || !steps.has(step)) add('review-findings', `step "${finding.step}" is not "<hardware>/<step>" of the plan`, 'Name the hardware id and the step id.');
    }
    if (finding.status === 'deferred' && finding.grade !== 'NOTE') add('review-findings', `a ${finding.grade} is never deferred`, 'Fix it in the fix round, or escalate it (status "escalated") and do not sign off.');
    if (finding.status === 'deferred' && (typeof finding.backlog !== 'string' || finding.backlog.trim().length < 2)) add('review-findings', 'is deferred without a backlog reference', 'Write the backlog item ("backlog": "#123" or the tracker link) the NOTE moved to.');
    if (finding.lens === 'floor' || finding.floor !== undefined) {
      if (!FLOOR_KINDS.includes(finding.floor)) add('review-floor', `floor kind ${JSON.stringify(finding.floor)} is not one of ${FLOOR_KINDS.join(', ')}`, 'Name the floor it breaks.');
      if (finding.grade !== 'BLOCKER') add('review-floor', `breaks the accessibility floor (${finding.floor}) but is graded ${finding.grade}`, 'Grade it BLOCKER: a floor miss is never bought back by how good the screen looks.');
    }
  }
}

/** The on-device pass: every plan hardware answered every step, in plan order (review-device-pass). */
export function checkDevicePass(review, plan, report) {
  const { record, rel, text } = review;
  const pass = record.devicePass;
  const steps = plan.devicePass.steps.map((s) => s.id);
  const blockerSteps = new Set(CORE_STEPS.filter((s) => s.blocker).map((s) => s.id));
  const today = localToday();
  for (const hardware of plan.devicePass.hardware) {
    const entry = pass[hardware.id];
    const line = jsonLine(text, '"devicePass"', `"${hardware.id}"`);
    const add = (message, fix) => report.problem({ file: rel, line, rule: 'review-device-pass', message: `${hardware.id}: ${message}`, fix });
    if (!isObject(entry)) {
      add('no on-device pass recorded', `Run the pass on the real ${hardware.platform} phone (references/device-pass.md) and record it.`);
      continue;
    }
    if (typeof entry.model !== 'string' || entry.model.trim() === '' || typeof entry.os !== 'string' || entry.os.trim() === '') add('"model" and "os" (the version) are required', 'Write the exact model and OS version: when a step fails, that header is the whole reproduction context.');
    if (!isIsoDay(entry.date) || entry.date > today || (isIsoDay(record.startedOn) && entry.date < record.startedOn)) add(`"date" ${JSON.stringify(entry.date)} is not a day between the review start and today`, 'Write the local day the pass ran.');
    const results = isObject(entry.results) ? entry.results : {};
    const recorded = Object.keys(results);
    for (const step of recorded) if (!steps.includes(step)) add(`result for "${step}", which the plan does not list`, 'Delete it, or add the step to the plan.');
    const order = recorded.filter((s) => steps.includes(s));
    const expected = steps.filter((s) => order.includes(s));
    if (order.join() !== expected.join()) add('the steps are recorded out of the plan order', 'Run and record them in plan order: the destructive steps come last.');
    for (const step of steps) {
      const result = results[step];
      if (!isObject(result) || result.result === undefined) {
        add(`step "${step}" has no result yet`, 'Answer it: pass, fail (with the finding id) or n/a (with why).');
        continue;
      }
      if (!RESULTS.includes(result.result)) add(`step "${step}": result ${JSON.stringify(result.result)} is not pass, fail or n/a`, 'Use one of the three.');
      if (result.result === 'n/a' && (typeof result.why !== 'string' || result.why.trim().length < MIN_WHY)) add(`step "${step}" is n/a without a reason (at least ${MIN_WHY} characters)`, 'Say why it does not apply to this app (for example: the app has no export).');
      if (result.result === 'fail' || result.finding !== undefined) {
        const finding = record.findings[result.finding];
        if (!finding) add(`step "${step}" failed but names no recorded finding (found ${JSON.stringify(result.finding)})`, 'Record the failure as a finding and put its id in "finding".');
        else if (blockerSteps.has(step) && finding.grade !== 'BLOCKER') {
          report.problem({ file: rel, line: findingLine(review, result.finding), rule: 'review-floor', message: `finding ${result.finding}: step "${step}" failed, and a failure there is always a BLOCKER (graded ${finding.grade})`, fix: 'Grade it BLOCKER.' });
        }
      }
    }
  }
}

/**
 * Exactly one fix round; fixed findings were re-shot (cells) and recorded again (videos); verification
 * opens only NOTEs (review-fix-round). The proof compares two hashes of the record (each finding's
 * `seen`, keyed by cell or video name, and the inventory), so the release gate runs it without the
 * captures too.
 */
export function checkFixRound(review, report) {
  const { record, rel, text } = review;
  const round = record.fixRound ?? null;
  const findings = Object.entries(record.findings).filter(([, f]) => isObject(f));
  const needsRound = findings.some(([, f]) => f.status === 'fixed' && f.grade !== 'NOTE');
  const roundLine = jsonLine(text, '"fixRound"');
  if (round) {
    if (!COMMIT.test(round.commit ?? '')) report.problem({ file: rel, line: roundLine, rule: 'review-fix-round', message: '"fixRound.commit" must be the commit of the fixed build', fix: 'Write `git rev-parse HEAD` after the fixes.' });
    if (round.verify !== 'pass') report.problem({ file: rel, line: roundLine, rule: 'review-fix-round', message: '"fixRound.verify" is not "pass": gates and tests run again after the fixes', fix: 'Run npm run verify on the fixed commit and record "pass".' });
    if (!isIsoDay(round.date) || (isIsoDay(record.startedOn) && round.date < record.startedOn)) report.problem({ file: rel, line: roundLine, rule: 'review-fix-round', message: `"fixRound.date" ${JSON.stringify(round.date)} is not a day after the review start`, fix: 'Write the local day of the fix round.' });
  } else if (needsRound) {
    report.problem({ file: rel, line: roundLine, rule: 'review-fix-round', message: 'findings are marked fixed but no fix round is recorded', fix: 'Record the one fix round: { "commit", "verify": "pass", "date" }.' });
  }
  for (const [id, finding] of findings) {
    const line = findingLine(review, id);
    if (finding.openedIn === 'verify' && finding.grade !== 'NOTE') {
      report.problem({ file: rel, line, rule: 'review-fix-round', message: `finding ${id} was opened while verifying the fixes and graded ${finding.grade}`, fix: 'Verification opens no new critique: record it as a NOTE for the backlog; a new BLOCKER means no sign-off and an escalation, not a second round.' });
    }
    if (finding.status !== 'fixed' || finding.grade === 'NOTE') continue;
    const captures = [
      ...(Array.isArray(finding.cells) ? finding.cells : []).map((name) => ({ name, kind: 'cell', now: record.cells[name] })),
      ...(Array.isArray(finding.videos) ? finding.videos : []).map((name) => ({ name, kind: 'video', now: record.videos[name] })),
    ];
    if (captures.length === 0) continue;
    if (!isObject(finding.seen)) {
      report.problem({ file: rel, line, rule: 'review-fix-round', message: `finding ${id} has no "seen" hashes of the shots it was found on`, fix: 'Run new-review.mjs --refresh before re-shooting: it stores the hash of each cell and video the finding names.' });
      continue;
    }
    for (const { name, kind, now } of captures) {
      const seen = finding.seen[name];
      if (seen === undefined) {
        report.problem({ file: rel, line, rule: 'review-fix-round', message: `finding ${id} has no "seen" hash of ${kind} ${name}`, fix: `Run new-review.mjs --refresh before re-shooting: it stores the hash of the ${kind} as it was when the finding was written; without it the fix cannot be shown to be on a new ${kind === 'cell' ? 'shot' : 'recording'}.` });
      } else if (seen === now) {
        report.problem({ file: rel, line, rule: 'review-fix-round', message: kind === 'cell' ? `finding ${id} is marked fixed but cell ${name} was not re-shot` : `finding ${id} is marked fixed but video ${name} was not recorded again`, fix: kind === 'cell' ? 'Re-shoot the cell on the fixed build (overwrite it), run new-review.mjs --refresh, and look at the new shot before marking it fixed.' : 'Record the video again on the fixed build (overwrite it), run new-review.mjs --refresh, and watch it before marking the finding fixed.' });
      }
    }
  }
}

/** The dated sign-off (review-signoff). `requireSignoff` false lets a review in progress pass this rule. */
export function checkSignoff(review, report, { requireSignoff = true } = {}) {
  const { record, rel, text } = review;
  const signoff = record.signoff ?? null;
  const line = jsonLine(text, '"signoff"');
  const add = (message, fix) => report.problem({ file: rel, line, rule: 'review-signoff', message, fix });
  if (!signoff) {
    if (requireSignoff) add('the review is not signed off yet', 'Finish the fix round, then write the sign-off: { "date", "reviewer", "commit", "verdict" }.');
    return null;
  }
  const today = localToday();
  if (!isIsoDay(signoff.date) || signoff.date > today) add(`sign-off date ${JSON.stringify(signoff.date)} is not a day up to today`, 'Write the local day of the sign-off (never a future or a UTC day).');
  else {
    if (isIsoDay(record.startedOn) && signoff.date < record.startedOn) add('the sign-off is dated before the review started', 'Fix the date.');
    if (isIsoDay(record.fixRound?.date) && signoff.date < record.fixRound.date) add('the sign-off is dated before the fix round', 'Sign off after verifying the fixes.');
  }
  if (typeof signoff.reviewer !== 'string' || signoff.reviewer.trim().length < 2 || /__[A-Z_]+__/.test(signoff.reviewer)) add('"reviewer" names nobody', 'Write who reviewed (a name or handle); an agent writes the person it reviewed for, never itself alone.');
  if (!VERDICTS.includes(signoff.verdict)) {
    add(`verdict ${JSON.stringify(signoff.verdict)} is not "SIGNED OFF" or "NOT SIGNED OFF"`, 'Write one of the two.');
    return signoff;
  }
  const expectedCommit = record.fixRound?.commit ?? record.build?.commit;
  if (signoff.commit !== expectedCommit) add(`the sign-off names commit ${JSON.stringify(signoff.commit)}, but the reviewed build is ${JSON.stringify(expectedCommit)}`, 'Sign the build that was looked at: the fix round commit when there was one, else the swept build.');
  const findings = Object.entries(record.findings).filter(([, f]) => isObject(f));
  const unresolved = findings.filter(([, f]) => f.grade !== 'NOTE' && f.status !== 'fixed');
  if (signoff.verdict === 'SIGNED OFF') {
    for (const [id, f] of unresolved) add(`signed off with ${f.grade} ${id} ${f.status}`, 'Fix it and verify it on its new shot, or write "NOT SIGNED OFF" with the escalation.');
    for (const [id, f] of findings) if (f.grade === 'NOTE' && f.status === 'open') add(`signed off with NOTE ${id} still open`, 'Move each NOTE to the backlog ("deferred" with "backlog"), or mark it fixed.');
    const notCaptured = Object.entries(record.cells).filter(([, sha]) => sha === null).length + Object.entries(record.videos).filter(([, sha]) => sha === null).length;
    if (notCaptured > 0) add(`signed off with ${notCaptured} cells or videos never captured`, 'Capture the whole matrix; a narrowed sweep is never a sign-off.');
    for (const [hw, entry] of Object.entries(isObject(record.devicePass) ? record.devicePass : {})) {
      for (const [step, result] of Object.entries(isObject(entry?.results) ? entry.results : {})) {
        if (result?.result === 'fail') add(`signed off with step "${step}" on ${hw} failed`, 'Re-run the step on the fixed build and record "pass" (keep its "finding"), or do not sign off.');
      }
    }
  } else {
    const named = typeof signoff.escalation === 'string' ? [...signoff.escalation.matchAll(/\bF[1-9][0-9]*\b/g)].map((m) => m[0]) : [];
    if (!named.some((id) => unresolved.some(([uid]) => uid === id))) add('"NOT SIGNED OFF" needs an "escalation" naming the unresolved BLOCKER or FIX (F<n>) and who decides', 'Write the escalation: which finding survived the fix round, and who was told.');
  }
  return signoff;
}

// ---------------------------------------------------------------------------------------------
// JSON written the way Prettier writes it (printWidth 100): objects expanded, short primitive arrays
// on one line.

const PRINT_WIDTH = 100;

function formatValue(value, indent, prefixLength) {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) {
      const flat = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
      if (prefixLength + flat.length + 1 <= PRINT_WIDTH) return flat;
    }
    return `[\n${value.map((v) => `${inner}${formatValue(v, indent + 1, inner.length)}`).join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, v]) => {
        const head = `${inner}${JSON.stringify(k)}: `;
        return `${head}${formatValue(v, indent + 1, head.length)}`;
      })
      .join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

export function formatJson(value) {
  return `${formatValue(value, 0, 0)}\n`;
}
