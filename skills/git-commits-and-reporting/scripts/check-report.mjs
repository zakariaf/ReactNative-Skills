#!/usr/bin/env node
// check-report.mjs: checks a message to the reviewer before it is sent. Evidence reports (slice or
// release): the outcome first in plain words, at most one request with its default, an Evidence
// line, the Checks with numbers copied from named files, what changed for users, at most five things
// to look at, an honest "not verified" list, the human checks listed as not blocking, deliberate
// baseline and text changes in their own blocks, and nothing that is not evidence (a rehearsal, a dry
// run, a placeholder FAIL) cited as evidence. Requests (a stop-and-ask message): one plain sentence
// first, exactly one request with the default that applies until it is answered. No placeholders.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-report.mjs . --report reports/evidence-2026-10-10-drafts.md

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, createReporter, fail, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';

const SPEC = {
  name: 'check-report',
  summary: 'Checks a message to the reviewer (an evidence report for a slice or release, or a stop-and-ask request) against the reporting rules.',
  usage: '[repo-root] --report <file> [options]',
  options: {
    report: { type: 'string', value: 'file', help: 'The report or request file (for example reports/evidence-2026-10-10-drafts.md)' },
    kind: { type: 'string', value: 'slice|release|request', help: 'Which form to require (default: read from the Evidence line)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'The repo root (default ".") gives <contracts>/reporting.json (templates/contracts/reporting.json) and the',
    'app\'s locales (the contract\'s "locales", else the file names of <i18n>/catalogs/*.json).',
    '',
    'Rules:',
    '  outcome-first          the first line is not one plain sentence about what changed for users: one problem',
    '                         line per failed limit: at most 240 characters, at most 2 sentences, ends in . or !,',
    '                         and it is a sentence (not a heading, list item, code fence or the Evidence line)',
    '  technical-detail-early a code fence, command, file path or stack trace before the Evidence line',
    '  too-many-requests      more than one request (a "Please ..." line or a question)',
    '  request-missing        a request message (--kind request) asks for nothing ("Please ..." line)',
    '  request-default        a request without the default that applies until it is answered',
    '  evidence-line          no "Evidence: <app or area> <slice|release ...> on YYYY-MM-DD, commit <sha>" line',
    '  checks-missing         the Checks list lacks a line this form needs (slice: Types, lint, format and Tests,',
    '                         plus the contract\'s sliceChecks; release: also releaseChecks, default Coverage,',
    '                         Mutation, End-to-end)',
    '  tests-count            the Tests line has no <passed>/<total>, or not every test passed',
    '  report-source          a measured Checks line (Coverage, Mutation, End-to-end, Screenshots, Design match,',
    '                         Performance, Network, and every contract check) does not name the file it came from',
    '  section-missing        "What changed for users" or "Not tested or not verified" (and, for a release,',
    '                         "Goldens and baselines changed on purpose") is missing or empty',
    '  look-at-limit          "Please look at" lists more than 5 things',
    '  placeholder-left       a template placeholder such as <sha>, <n> or __NAME__ is left',
    '  baseline-change-trailer a "Goldens and baselines changed on purpose" line (other than "none") does not name',
    '                         the file or folder and "(Gate-Change trailer in <sha>)"',
    '  translations-listed    a "Texts changed in every locale" line does not name every locale of the app, or',
    '                         (more than one locale) does not say which drafts go to a native-language review',
    '  human-checks-listed    a slice or release report has no "Human checks (not blocking)" block, the block',
    '                         misses a check the contract (or the default list) names, says "none pending" for the',
    '                         review while texts changed, or calls a human check blocking',
    '  non-evidence-cited     a line outside "Not tested or not verified", "Details" and "Human checks" cites a',
    '                         non-evidence marker, any case (default: rehearsal, --rehearsal, dry run, dry-run, --dry-run,',
    '                         ship-placeholder): a rehearsal or a placeholder FAIL proves nothing about a release',
    '',
    'The two change blocks are optional; each rule applies to every line of its block when it is present.',
    'Request form: outcome-first, too-many-requests, request-missing, request-default and placeholder-left.',
  ].join('\n'),
};

const BASE_CHECKS = ['Types, lint, format', 'Tests'];
const DEFAULT_SOURCED = ['Coverage', 'Mutation', 'End-to-end', 'Screenshots', 'Design match', 'Performance', 'Network'];
const DEFAULTS = {
  releaseChecks: ['Coverage', 'Mutation', 'End-to-end'],
  sliceChecks: [],
  humanChecks: [
    { name: 'the on-device check', match: 'device|phone|tablet|hands-on|TestFlight|internal test', example: 'On-device check: <what to try> on the preview build, still open' },
    { name: 'the native-language review of changed texts', match: 'review', minLocales: 2, example: 'Native-language review of changed texts: none pending' },
  ],
  nonEvidenceMarkers: ['rehearsal', '--rehearsal', 'dry run', 'dry-run', '--dry-run', 'ship-placeholder'],
};
const SECTIONS = {
  checks: 'Checks',
  users: 'What changed for users',
  look: 'Please look at',
  baselines: 'Goldens and baselines changed on purpose',
  texts: 'Texts changed in every locale',
  human: 'Human checks (not blocking)',
  notVerified: 'Not tested or not verified',
  details: 'Details',
};
const HEADINGS = Object.values(SECTIONS);
const NONE_PENDING = /\b(none|nothing|no \w+(?: \w+)?) pending\b/i;
// Words that say something waits for the check. A bare "gate" is not one: "the build that passed every
// gate" only names the gates; "gated on" or "gates the release" says the release waits.
const BLOCKING_WORDS = /\b(blocks|blocked|blocking|waits? (?:for|on)|waiting (?:for|on)|before (?:a|the|any|each) release|gated? (?:on|by)|gates (?:a|the|any|each) (?:release|merge|upload|submission))\b/i;
const NOT_BLOCKING = /\bnot blocking\b|\bnever (?:waited for|waits|blocks|a gate)\b|\bno gate\b/gi;
// A file or folder name: one or more "<segment>/" and then a file name with an extension
// (reports/e2e/junit.xml) or nothing (a folder, reports/e2e/ or .maestro/baselines/). A ratio such as
// 14/14, 90/95 or light/dark is no path; the name must also hold a letter (2026/10/ is no folder).
const PATH_TOKEN = /(?:^|[\s(`'"])((?:\.?[\w@-]+\/)+(?:[\w.-]*\.[A-Za-z][A-Za-z0-9]{0,5}\b|(?=[\s)`'",;:]|$)))/g;
/** True when the text names a file or folder (see PATH_TOKEN), not just a number ratio. */
const namesFile = (text) => [...text.matchAll(PATH_TOKEN)].some((match) => /[A-Za-z]/.test(match[1]));
const TRAILER_SHA = /Gate-Change trailer in [0-9a-f]{7,40}\b/;
const OUTCOME_LIMITS = { chars: 240, sentences: 2 };

/** The reporting contract merged over the defaults; a malformed file is bad input (exit 2). */
function readContract(root, layout) {
  const file = join(root, layout.contractsDir, 'reporting.json');
  if (!existsSync(file)) return { ...DEFAULTS, locales: null };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON (${error.message})`, 'Restore it from templates/contracts/reporting.json.');
  }
  const lists = ['releaseChecks', 'sliceChecks', 'nonEvidenceMarkers', 'locales'].filter((key) => data[key] !== undefined && data[key] !== null && !(Array.isArray(data[key]) && data[key].every((item) => typeof item === 'string')));
  const badHuman = data.humanChecks !== undefined && !(Array.isArray(data.humanChecks) && data.humanChecks.every((item) => typeof item?.name === 'string' && typeof item?.match === 'string'));
  if (lists.length || badHuman) fail(`${file} does not match contracts/reporting.schema.json (${[...lists, ...(badHuman ? ['humanChecks'] : [])].join(', ')})`, 'Lists of strings for releaseChecks, sliceChecks, nonEvidenceMarkers and locales; humanChecks is a list of { "name", "match" }.');
  return { ...DEFAULTS, locales: null, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null)) };
}

/** The app's locales: the contract's list, else the catalog file names (en.json, ar.json, ...). */
function localesOf(root, layout, contract) {
  if (Array.isArray(contract.locales)) return contract.locales;
  const dir = join(root, layout.i18nDir, 'catalogs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
}

function outcomeProblems(first) {
  const problems = [];
  if (/^(Evidence:|#|-|\*|```|Checks|Details|Please)/.test(first)) problems.push('the first line is a heading, list item, code fence, Evidence line or request, not a sentence about the outcome');
  if (first.length > OUTCOME_LIMITS.chars) problems.push(`first line is ${first.length} characters, the limit is ${OUTCOME_LIMITS.chars}`);
  const sentences = first.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  if (sentences.length > OUTCOME_LIMITS.sentences) problems.push(`${sentences.length} sentences, at most ${OUTCOME_LIMITS.sentences}`);
  if (!/[.!]$/.test(first)) problems.push('does not end in . or !');
  return problems;
}

function headingOf(line) {
  const text = line.replace(/^#+\s*/, '').replace(/[:*]/g, '').trim().toLowerCase();
  return HEADINGS.find((heading) => text.startsWith(heading.toLowerCase())) ?? null;
}

function sections(lines) {
  const out = new Map();
  let current = null;
  lines.forEach((text, index) => {
    const heading = headingOf(text);
    if (heading && !/^\s*-/.test(text)) {
      current = { heading, line: index + 1, items: [] };
      out.set(heading, current);
    } else if (current && /^\s*[-*]\s+\S/.test(text)) current.items.push({ text: text.replace(/^\s*[-*]\s+/, ''), line: index + 1 });
  });
  return out;
}

/** [from, to] line ranges of the named sections (to = the line before the next heading). */
function sectionRanges(lines, parts, names) {
  return names.map((name) => parts.get(name)).filter(Boolean).map((part) => {
    const next = [...parts.values()].filter((other) => other.line > part.line).map((other) => other.line).sort((a, b) => a - b)[0] ?? lines.length + 1;
    return [part.line, next - 1];
  });
}

function checkPlaceholders(lines, add) {
  lines.forEach((text, index) => {
    const placeholder = /<(?:app|area|n|x|sha|date|seed|score|passed|total|file|reason|summary[^>]*|one line[^>]*|honest list[^>]*|screenshot[^>]*|slice or release)>|__[A-Z][A-Z0-9_]*__/.exec(text);
    if (placeholder) add(index + 1, 'placeholder-left', `placeholder ${placeholder[0]} is left`, 'Fill in the real value from the evidence files.');
  });
}

function checkRequests(lines, add) {
  const requests = lines.map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(({ text }) => (/^Please\b/.test(text) && !/^Please look at/i.test(text)) || (/\?\s*$/.test(text) && !/^[-*]/.test(text)));
  if (requests.length > 1) add(requests[1].line, 'too-many-requests', `${requests.length} requests in one message`, 'Ask for one thing per message; the rest waits for the next message once this one is answered.');
  for (const request of requests) {
    if (!/until then|meanwhile|default|in the meantime/i.test(request.text)) add(request.line, 'request-default', `"${request.text.slice(0, 60)}" gives no default`, 'Say what applies until the answer comes: "Until then I keep working on the reminders list."');
  }
  return requests;
}

function checkChecks(parts, kind, contract, add) {
  const checks = parts.get(SECTIONS.checks);
  const needed = [...BASE_CHECKS, ...contract.sliceChecks, ...(kind === 'release' ? contract.releaseChecks : [])];
  if (!checks) return add(0, 'checks-missing', 'no "Checks" list', 'Add the Checks list from the template.');
  for (const name of new Set(needed)) {
    if (!checks.items.some((item) => item.text.toLowerCase().startsWith(name.toLowerCase()))) add(checks.line, 'checks-missing', `the Checks list has no "${name}" line`, `Add "- ${name}: ..." with the number from its evidence file, or say under "${SECTIONS.notVerified}" why it did not run (a release cannot leave it out).`);
  }
  const sourced = [...DEFAULT_SOURCED, ...contract.sliceChecks, ...contract.releaseChecks];
  for (const item of checks.items) {
    if (/^tests\b/i.test(item.text)) {
      const counts = [...item.text.matchAll(/(\d+)\s*\/\s*(\d+)/g)];
      if (counts.length === 0) add(item.line, 'tests-count', 'the Tests line has no <passed>/<total>', 'Write "Tests: 212/212 pass (unit 190, golden 22), random seed 1234" from the Jest output.');
      for (const count of counts.filter((pair) => pair[1] !== pair[2])) add(item.line, 'tests-count', `only ${count[1]} of ${count[2]} tests pass`, 'A slice is done only when every test passes; fix the failures first.');
    }
    if (sourced.some((name) => item.text.toLowerCase().startsWith(name.toLowerCase())) && !namesFile(item.text)) add(item.line, 'report-source', `"${item.text.slice(0, 50)}" does not name the file it came from`, 'Copy the number from its evidence file (reports/coverage/coverage-summary.json, reports/e2e/junit.xml, ...) and name that file on the line.');
  }
  return undefined;
}

function checkChangeBlocks(parts, locales, add) {
  for (const item of parts.get(SECTIONS.baselines)?.items ?? []) {
    if (/^none\b/i.test(item.text)) continue;
    if (!namesFile(item.text) || !TRAILER_SHA.test(item.text)) add(item.line, 'baseline-change-trailer', `"${item.text.slice(0, 60)}" does not name the file and its Gate-Change commit`, 'Name the golden, baseline or fixture file or folder, say in plain words what changed and why, and end with "(Gate-Change trailer in <sha>)".');
  }
  for (const item of parts.get(SECTIONS.texts)?.items ?? []) {
    const missing = locales.filter((code) => !new RegExp(`(?<![\\w-])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(item.text));
    const needsReview = locales.length > 1 && !/\breview/i.test(item.text);
    if (missing.length || needsReview) add(item.line, 'translations-listed', `"${item.text.slice(0, 60)}" ${missing.length ? `does not name ${missing.join(', ')}` : 'does not say which drafts go to a native-language review'}`, `Give the key or the place, the new text in the source locale, name every locale (${locales.join(', ') || 'the app\'s locales'}) and say which drafts go to a native-language review, listed under "${SECTIONS.human}".`);
  }
}

function checkHumanChecks(parts, contract, locales, add) {
  const block = parts.get(SECTIONS.human);
  if (!block || block.items.length === 0) return add(block?.line ?? 0, 'human-checks-listed', `"${SECTIONS.human}" is ${block ? 'empty' : 'missing'}`, `Add "${SECTIONS.human}" with one line per check a person does by hand, each saying what is pending or "none pending".`);
  const applicable = contract.humanChecks.filter((check) => (check.minLocales ?? 0) <= locales.length);
  for (const check of applicable) {
    const pattern = new RegExp(check.match, 'i');
    if (!block.items.some((item) => pattern.test(item.text))) add(block.line, 'human-checks-listed', `the "${SECTIONS.human}" block does not name ${check.name}`, `Add a line such as "- ${check.example ?? `${check.name}: still open`}"; a person does it by hand and the work never waits for it.`);
  }
  const textsChanged = (parts.get(SECTIONS.texts)?.items.length ?? 0) > 0;
  for (const item of block.items) {
    if (textsChanged && locales.length > 1 && /\breview/i.test(item.text) && NONE_PENDING.test(item.text)) add(item.line, 'human-checks-listed', `"${item.text.slice(0, 60)}" says no review is pending, but texts changed`, 'Name the changed texts whose drafts wait for the native-language review.');
    if (BLOCKING_WORDS.test(item.text.replace(NOT_BLOCKING, ''))) add(item.line, 'human-checks-listed', `"${item.text.slice(0, 60)}" calls a human check blocking`, 'Human checks are listed, never waited for: say what the person can do and when it helps, not what waits for it.');
  }
  return undefined;
}

function checkNonEvidence(lines, parts, contract, add) {
  const allowed = sectionRanges(lines, parts, [SECTIONS.notVerified, SECTIONS.details, SECTIONS.human]);
  const markers = contract.nonEvidenceMarkers.map((marker) => ({ marker, pattern: new RegExp(`(?<![\\w-])${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i') }));
  lines.forEach((text, index) => {
    const line = index + 1;
    const hit = markers.find(({ pattern }) => pattern.test(text));
    if (!hit || allowed.some(([from, to]) => line >= from && line <= to)) return;
    add(line, 'non-evidence-cited', `"${text.trim().slice(0, 60)}" cites "${hit.marker}" as evidence`, `A rehearsal, a dry run or a placeholder FAIL proves nothing about a release: cite the real run, and mention this one under "${SECTIONS.notVerified}" at most.`);
  });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  if (options.kind && !['slice', 'release', 'request'].includes(options.kind)) throw new UsageError(`--kind must be slice, release or request, got "${options.kind}"`, 'Pass --kind slice, release or request.');
  if (!options.report) throw new UsageError('pass --report <file>', 'For example: check-report.mjs . --report reports/evidence-2026-10-10-drafts.md');
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  const contract = readContract(root, layout);
  const shown = options.report;
  const lines = readFileSync(requireFile(shown, 'report'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const report = createReporter({ name: 'check-report', json: options.json });
  const add = (line, rule, message, fix) => report.problem({ file: shown, line, rule, message, fix });
  const isRequest = options.kind === 'request';

  const firstIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstIndex === -1) throw new UsageError(`nothing to check: ${shown} is empty`, 'Write the report first (templates/reports/evidence-slice.md).');
  const first = lines[firstIndex].trim();
  for (const failed of outcomeProblems(first)) {
    add(firstIndex + 1, 'outcome-first', `${failed}: "${first.slice(0, 60)}${first.length > 60 ? '...' : ''}"`, isRequest ? `Start with one plain sentence (at most ${OUTCOME_LIMITS.chars} characters, at most ${OUTCOME_LIMITS.sentences} sentences, ending in . or !) saying what is blocked ("The Android upload of Tasks 1.4.0 stopped and I have not retried it.").` : `Start with one plain sentence in users' words (at most ${OUTCOME_LIMITS.chars} characters, at most ${OUTCOME_LIMITS.sentences} sentences, ending in . or !) saying what now works ("A task you were typing now survives a restart."); the rest goes into the next lines.`);
  }
  const evidenceIndex = lines.findIndex((line) => /^Evidence:/.test(line.trim()));
  if (!isRequest) {
    lines.slice(0, evidenceIndex === -1 ? Math.min(lines.length, 6) : evidenceIndex).forEach((text, index) => {
      if (/```|^\s+at\s|\bError:|npm (ERR|error)|^\s*\$\s|`[^`]*[/.][^`]*`|\b[\w-]+\/[\w./-]+\.(ts|tsx|js|json|png|yaml|xml)\b/.test(text)) add(index + 1, 'technical-detail-early', `"${text.trim().slice(0, 60)}" is technical detail before the evidence`, 'Keep the first lines in plain words; commands, paths and stack traces go under "Details" at the end.');
    });
  }
  const requests = checkRequests(lines, add);
  if (isRequest) {
    if (requests.length === 0) add(firstIndex + 1, 'request-missing', 'the message asks for nothing', 'Add one "Please <the one action> (about <n> minutes). Until then <the default>." line.');
    checkPlaceholders(lines, add);
    return report.finish({ checked: lines.length, unit: 'message lines' });
  }

  const evidence = evidenceIndex === -1 ? null : /^Evidence: (\S+) (.+?) on (\d{4}-\d{2}-\d{2}), commit ([0-9a-f]{7,40})\s*$/.exec(lines[evidenceIndex].trim());
  if (!evidence) add(evidenceIndex + 1, 'evidence-line', evidenceIndex === -1 ? 'no Evidence line' : `"${lines[evidenceIndex].trim().slice(0, 70)}" is not "Evidence: <app or area> <slice or release> on YYYY-MM-DD, commit <sha>"`, 'Add the Evidence line from the template with the real date and commit.');
  const kind = options.kind ?? (evidence && /\brelease\b/i.test(evidence[2]) ? 'release' : 'slice');
  const parts = sections(lines);
  const locales = localesOf(root, layout, contract);
  checkChecks(parts, kind, contract, add);
  for (const name of [SECTIONS.users, SECTIONS.notVerified, ...(kind === 'release' ? [SECTIONS.baselines] : [])]) {
    const part = parts.get(name);
    if (!part || part.items.length === 0) add(part?.line ?? 0, 'section-missing', `"${name}" is ${part ? 'empty' : 'missing'}`, `Add "${name}" with at least one line (say "none" plainly when there is nothing).`);
  }
  checkChangeBlocks(parts, locales, add);
  checkHumanChecks(parts, contract, locales, add);
  checkNonEvidence(lines, parts, contract, add);
  const look = parts.get(SECTIONS.look);
  if (look && look.items.length > 5) add(look.line, 'look-at-limit', `"Please look at" lists ${look.items.length} things`, 'Point at no more than five things, the most important first.');
  checkPlaceholders(lines, add);
  return report.finish({ checked: lines.length, unit: 'report lines' });
});
