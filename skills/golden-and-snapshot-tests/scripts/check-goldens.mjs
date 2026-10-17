#!/usr/bin/env node
// check-goldens.mjs: checks the goldens of a React Native app without running Jest. Every data golden
// has its snapshot and every snapshot its golden test; snapshots are readable text, never component
// trees; golden tests read no clock, locale or randomness and render no UI; [contract] goldens pin
// enough keys; pixel goldens use the one matcher at the size matrix and have baselines; nothing
// automates `jest -u`; golden paths are gated and diff output is ignored.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-goldens.mjs [repo-root] [options]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, createReporter, lineOf, maskComments, notYetCreated, parseArgs, parseJsonc, requireDir, run, walkRepo } from './check-lib.mjs';
import { isContractKey, lineOfText, loadGoldenSetup, requiredGatedPaths } from './lib/golden-config.mjs';

const SPEC = {
  name: 'check-goldens',
  summary: 'Checks data goldens, [contract] goldens, pixel goldens and the golden policy wiring of a React Native app (no Jest run needed).',
  usage: '[repo-root] [options]',
  options: {
    'goldens-dir': { type: 'string', value: 'dir', help: 'Pixel goldens folder (default: rn-skills.config.json "goldensDir", else <testDir>/goldens)' },
    matcher: { type: 'string', value: 'file', help: 'The shared pixel matcher (default: "pixelMatcher", else <goldens-dir>/skia-golden.ts)' },
    contract: { type: 'string', value: 'file', help: 'The goldens contract (default: "goldensContract", else contracts/goldens.json)' },
    'max-entry-lines': { type: 'string', default: '120', value: 'n', help: 'Longest allowed snapshot entry, in lines' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  golden-never-runs       a *.golden.test.tsx / *.golden.spec.* / *.golden.test.js file: the golden project runs only *.golden.test.ts',
    '  snapshot-missing        a golden test calls toMatchSnapshot but has no <file>.snap.ios next to it (jest --ci fails)',
    '  snapshot-orphan         a .snap / .snap.ios / .snap.android whose test file is gone',
    '  snapshot-not-golden     a snapshot file of a test that is not *.golden.test.ts (a component snapshot)',
    '  snapshot-unreadable     a snapshot entry holds a component tree or is longer than --max-entry-lines',
    '  snapshot-not-text       a snapshot entry is an object, array or number instead of one readable string',
    '  inline-snapshot         toMatchInlineSnapshot in a golden test (-u would rewrite the test file)',
    '  golden-ambient          a golden test reads the clock, unseeded randomness or the machine locale',
    '  golden-renders-ui       a golden test imports react-native, RNTL, a test renderer or a render helper, or calls .toJSON()',
    '  contract-golden-missing a contract in contracts/goldens.json has no golden test, or its test has no [contract] describe',
    '  contract-unregistered   a golden test has a [contract] describe that contracts/goldens.json does not list (or the file is missing)',
    '  contract-golden-keys    a [contract] golden pins fewer than 3 entries, or date keys without a Dec 31 / Jan 1 pair',
    '  pixel-golden-place      a pixel golden outside the goldens folder (it needs node:fs and Buffer)',
    '  pixel-matcher           a pixel golden does not extend expect with toMatchPixelGolden from the shared matcher',
    '  golden-tolerance        a per-call failureThreshold or matcher config, or a matcher above maxPixelTolerance (0.1% of pixels)',
    '  matcher-missing         pixel goldens exist but the shared matcher does not',
    '  pixel-deps              pixel goldens exist but devDependencies lack exact pins of jest-image-snapshot and its types',
    '  pixel-golden-cases      fewer than 3 canvas sizes (unless "// fixed-size: <why>" or a draw function defined in the test), or an animated golden without moments [0, 0.5, 1]',
    '  baseline-missing        a pixel golden has no PNG in the __image_snapshots__ folder next to it',
    '  baseline-orphan         a PNG in an __image_snapshots__ folder that no pixel golden beside it claims (by its',
    '                          customSnapshotIdentifier prefix or default file-name prefix): jest-image-snapshot never',
    '                          reports an unused baseline, so it would stay forever',
    '  update-in-automation    jest -u, --updateSnapshot, --ci=false, CI=false (or a YAML env CI: false) or a baseline --update in scripts, hooks or CI',
    '  jest-without-ci         a script, hook or CI line runs jest without --ci (it would write the snapshot of a new golden)',
    '  gated-path-missing      quality-gates.json gatedPaths lacks a golden path',
    '  diff-output-ignored     .gitignore does not ignore reports/ and **/__image_snapshots__/__diff_output__/',
    '',
    'SKIP lines (incremental adoption): quality-gates.json and .gitignore not yet created. contracts/goldens.json is',
    'this skill\'s own file: optional while no golden test has a [contract] describe, required as soon as one does.',
    'rn-skills.config.json keys read: goldensDir, pixelMatcher, goldensContract (and the layout keys testDir,',
    'contractsDir, e2eDir). Folders under skills/, .agents/, .claude/ and any folder holding a SKILL.md are never scanned.',
  ].join('\n'),
};

const EXTRA_IGNORES = ['reports/**', '.stryker-tmp/**'];
const SNAPSHOT_FILE = /\.snap(?:\.(?:ios|android))?$/;
const COMPONENT_TREE = /^\s*<[A-Z][A-Za-z0-9.]*(\s|>|\/>|$)|"props":\s*\{|^\s*style=\{/m;
const MISNAMED_GOLDEN = /\.golden\.(?:test\.(?:tsx|js|jsx|mjs|cjs)|spec\.[cm]?[jt]sx?)$/;
const AMBIENT = [
  [/\bDate\.now\s*\(/g, 'Date.now()'],
  [/\bnew\s+Date\s*\(\s*\)/g, 'new Date()'],
  [/\bMath\.random\s*\(/g, 'Math.random()'],
  [/\bperformance\.now\s*\(/g, 'performance.now()'],
  [/\.toLocale(?:Date|Time)?String\s*\(\s*\)/g, 'toLocaleString() without a locale'],
  [/\.toLocale(?:Date|Time)?String\s*\(\s*(?:undefined|\[\s*\])\s*[,)]/g, 'toLocaleString() with an undefined locale (the machine locale)'],
  [/\bIntl\.\w+\s*\(\s*\)/g, 'an Intl formatter without a locale'],
  [/\bIntl\.\w+\s*\(\s*(?:undefined|\[\s*\])\s*[,)]/g, 'an Intl formatter with an undefined locale (the machine locale)'],
];
const UI_IMPORT = /^[ \t]*import\b[^;]*?\bfrom\s*['"](react-native|@testing-library\/react-native|react-test-renderer|test-renderer|@test\/render(?:-router)?-with-providers)['"]/gm;
const UPDATE = [
  /\b(?:jest|test[\w:-]*|golden[\w:-]*)\b[^\n"'`]*?(?:\s-u\b|\s--update-?[sS]napshot\b|\s--ci[= ]false\b)/,
  /(?:^|[\s"'`])CI=(?:false|0)\b[^\n"'`]*\b(?:jest|test)/,
  /\b[\w:./@-]*(?:screenshot|baseline|golden|snapshot)s?[\w:./@-]*\b[^\n"'`]*?\s--update(?:-baselines?)?\b/i,
];
/** `CI: false` in a workflow's env turns Jest's CI mode off for every step below it (ci-info reads CI). */
const YAML_CI_OFF = /^\s*(?:-\s*)?CI\s*:\s*(?:false|0|'(?:false|0)'|"(?:false|0)")\s*(?:#.*)?$/;
/** A jest command (bare, npx, npm exec, pnpm, yarn, bunx); `"jest": ...` keys and `jest.config.js` never match. */
const JEST_RUN = /(?:^|[\s"'`;&|(=])(?:npx\s+(?:--?[\w-]+\s+)*|npm\s+exec\s+(?:--\s+)?|pnpm\s+(?:exec\s+|dlx\s+)?|yarn\s+(?:exec\s+|dlx\s+)?|bunx\s+)?jest(?=$|[\s"'`;&|)])/g;
/** Runs that never write a snapshot, so they need no --ci. */
const JEST_READ_ONLY = /\s--(?:listTests|watch|watchAll|showConfig|clearCache|version|help)\b/;
const PIXEL_DEPS = { 'jest-image-snapshot': '6.5.2', '@types/jest-image-snapshot': '6.4.2' };

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const isFile = (root, rel) => existsSync(join(root, rel)) && statSync(join(root, rel)).isFile();

function parseMaxLines(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 10) throw new UsageError(`--max-entry-lines must be a whole number of at least 10, got "${value}"`, 'Pass a line count, for example --max-entry-lines 120.');
  return number;
}

/** The test file a snapshot belongs to (jest-expo resolvers: next to the test, or __tests__/__snapshots__/). */
function testOfSnapshot(rel) {
  const inFolder = /(^|\/)__snapshots__\/([^/]+)\.snap(?:\.(?:ios|android))?$/.exec(rel);
  if (inFolder) return posix.join(posix.dirname(posix.dirname(rel)), inFolder[2]);
  const beside = /^(.*\.(?:ts|tsx|js|jsx))\.snap(?:\.(?:ios|android))?$/.exec(rel);
  return beside ? beside[1] : null;
}

function snapshotEntries(text) {
  const entries = [];
  for (const match of text.matchAll(/^exports\[`([\s\S]*?)`\] = `\n?([\s\S]*?)\n?`;$/gm)) entries.push({ key: match[1], body: match[2], index: match.index });
  return entries;
}

function checkSnapshots(root, snapshots, files, maxLines, report) {
  for (const rel of snapshots) {
    const test = testOfSnapshot(rel);
    if (test === null) continue;
    if (!files.has(test) && !isFile(root, test)) {
      report.problem({ file: rel, line: 1, rule: 'snapshot-orphan', message: `belongs to ${test}, which does not exist`, fix: 'Delete the snapshot in the commit that removed or renamed its test (Gate-Change trailer).' });
      continue;
    }
    if (!test.endsWith('.golden.test.ts')) {
      report.problem({ file: rel, line: 1, rule: 'snapshot-not-golden', message: `is a snapshot of ${posix.basename(test)}, which is not a *.golden.test.ts`, fix: 'Delete it and assert roles, names and visible text instead; only data goldens use snapshots.' });
      continue;
    }
    const text = read(root, rel);
    for (const entry of snapshotEntries(text)) {
      const at = { file: rel, line: lineOf(text, entry.index) };
      const name = entry.key.slice(0, 70);
      const lines = entry.body.split('\n').length;
      if (COMPONENT_TREE.test(entry.body)) report.problem({ ...at, rule: 'snapshot-unreadable', message: `entry "${name}" holds a component tree`, fix: 'Snapshot readable text built from pure output (a header line, short lines, an ASCII grid), never rendered UI.' });
      else if (lines > maxLines) report.problem({ ...at, rule: 'snapshot-unreadable', message: `entry "${name}" is ${lines} lines (limit ${maxLines})`, fix: 'Pin only what a reviewer must read (one header line, the fields that matter) or split it into smaller cases.' });
      else if (!entry.body.trimStart().startsWith('"')) report.problem({ ...at, rule: 'snapshot-not-text', message: `entry "${name}" is not a string`, fix: 'Snapshot one string per case (describe the output as text), so the diff reads as lines, not an object tree.' });
    }
  }
}

function checkGoldenCode(rel, code, snapshots, report) {
  const problem = (rule, index, message, fix) => report.problem({ file: rel, line: lineOf(code, index), rule, message, fix });
  const snapshotAt = code.search(/\btoMatchSnapshot\s*\(/);
  if (snapshotAt >= 0) {
    const dir = posix.dirname(rel);
    const name = posix.basename(rel);
    const candidates = [`${rel}.snap.ios`, `${rel}.snap`, `${rel}.snap.android`, posix.join(dir, '__snapshots__', `${name}.snap`), posix.join(dir, '__snapshots__', `${name}.snap.ios`)];
    if (!candidates.some((candidate) => snapshots.has(candidate))) problem('snapshot-missing', snapshotAt, 'has no snapshot file next to it', `Create it on purpose: npx jest ${rel} --selectProjects golden -u, read the .snap.ios, commit with a Gate-Change trailer.`);
  }
  for (const match of code.matchAll(/\btoMatchInlineSnapshot\s*\(/g)) problem('inline-snapshot', match.index, 'uses an inline snapshot', 'Use toMatchSnapshot(): the .snap.ios file is a gated path, and -u never rewrites the test itself (Jest 29 with Prettier 3 cannot write inline snapshots at all).');
  for (const [pattern, what] of AMBIENT) for (const match of code.matchAll(pattern)) problem('golden-ambient', match.index, `reads ${what}`, 'Pass fixed inputs instead: a date key or instant literal, a seed, an explicit locale. A golden that depends on the machine differs between runs and machines.');
  for (const match of code.matchAll(UI_IMPORT)) problem('golden-renders-ui', match.index, `imports ${match[1]}`, 'Pin pure output as text; assert UI with roles and text in a <unit>.test.tsx (unit-and-component-tests) and pixels with a Skia pixel golden or a screenshot baseline.');
  for (const match of code.matchAll(/\.toJSON\s*\(\s*\)/g)) problem('golden-renders-ui', match.index, 'snapshots a rendered tree (.toJSON())', 'Pin pure output as text; component trees churn on every style change and train -u reflexes.');
}

function describeTitles(code) {
  return [...code.matchAll(/\bdescribe(?:\.each\([\s\S]*?\))?\s*\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((match) => ({ title: match[2], index: match.index }));
}

function checkContracts(root, setup, goldenCodes, snapshots, report) {
  const { contract } = setup;
  const markers = contract.contractMarkers;
  // The register is this skill's own file, so it is never skipped: without a marked describe there is
  // nothing to register; with one, the register must exist and list that test.
  const registered = new Set(contract.contracts.map((entry) => entry.test));
  for (const [rel, code] of goldenCodes) {
    const marked = describeTitles(code).find(({ title }) => isContractKey(title, markers));
    if (marked === undefined || registered.has(rel)) continue;
    const where = contract.exists ? `${contract.file} does not list it` : `${contract.file} does not exist`;
    const entry = `{ "id": "<kebab-id>", "test": "${rel}", "why": "<who depends on this output>" }`;
    const action = contract.exists ? `Add ${entry} to "contracts"` : `Copy this skill's templates/contracts/goldens.json (and goldens.schema.json) to ${contract.file}, replace its sample entry with ${entry}, and add "${contract.file}" to quality-gates.json gatedPaths`;
    report.problem({ file: rel, line: lineOf(code, marked.index), rule: 'contract-unregistered', message: `has a contract describe "${marked.title.slice(0, 60)}" but ${where}`, fix: `${action}, in a Gate-Change commit: the register says why the output is frozen.` });
  }
  for (const entry of contract.contracts) {
    const line = lineOfText(contract.text, `"${entry.test}"`);
    const code = goldenCodes.get(entry.test);
    if (code === undefined) {
      report.problem({ file: contract.file, line, rule: 'contract-golden-missing', message: `contract "${entry.id}" names ${entry.test}, which does not exist`, fix: `Write ${entry.test} with a describe title that carries "${markers[0]}", pin at least three keys, and create its snapshot on purpose.` });
      continue;
    }
    if (!describeTitles(code).some(({ title }) => isContractKey(title, markers))) report.problem({ file: entry.test, line: 1, rule: 'contract-golden-missing', message: `pins contract "${entry.id}" but no describe title carries ${markers.map((marker) => `"${marker}"`).join(' or ')}`, fix: `Put the contract cases in describe('${markers[0]} <unit> goldens', ...): the history check finds contract entries by that marker.` });
  }
  for (const rel of snapshots) {
    const test = testOfSnapshot(rel);
    if (test === null || !test.endsWith('.golden.test.ts')) continue;
    const text = read(root, rel);
    const entries = snapshotEntries(text).filter((entry) => isContractKey(entry.key, markers));
    if (entries.length === 0) continue;
    const dates = new Set(entries.flatMap((entry) => [...entry.key.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((match) => match[0])));
    const boundary = [...dates].some((date) => date.endsWith('-12-31') && dates.has(`${Number(date.slice(0, 4)) + 1}-01-01`));
    const short = entries.length < 3;
    if (short || (dates.size > 0 && !boundary)) {
      const parts = [short ? `pins ${entries.length} contract entr${entries.length === 1 ? 'y' : 'ies'} (at least 3)` : '', dates.size > 0 && !boundary ? 'has date keys but no Dec 31 / Jan 1 year-boundary pair' : ''].filter(Boolean);
      report.problem({ file: rel, line: lineOf(text, entries[0].index), rule: 'contract-golden-keys', message: parts.join(' and '), fix: "Add cases (never change or remove one): at least three keys, for date keys a pair like '2026-12-31' and '2027-01-01'." });
    }
  }
}

function sizesOf(code) {
  const constants = new Map([...code.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*(?::\s*number\s*)?=\s*(\d+)\s*;/g)].map((match) => [match[1], match[2]]));
  const widths = new Set();
  for (const match of code.matchAll(/\bwidth\s*:\s*(\d+|[A-Za-z_]\w*)\b/g)) {
    const value = /^\d+$/.test(match[1]) ? match[1] : constants.get(match[1]);
    if (value !== undefined) widths.add(value);
  }
  return widths.size;
}

/** True when `draw:` names a function or arrow declared in this test file (not imported). */
function drawsLocalFunction(code) {
  let name = /\bdraw\s*:\s*([A-Za-z_$][\w$]*)\s*[,}\n]/.exec(code)?.[1];
  if (name === undefined) return false;
  name = name.replace(/\$/g, '\\$');
  const imported = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`).test(code);
  const declared = new RegExp(`\\bfunction\\s+${name}\\s*[<(]|\\b(?:const|let)\\s+${name}\\s*(?::[^=]+)?=`).test(code);
  return declared && !imported;
}

function baselinePrefixes(rel, code) {
  const ids = [...code.matchAll(/\bcustomSnapshotIdentifier\s*:\s*(['"`])((?:(?!\1).)*)\1/g)].map((match) => match[2].split('${')[0]);
  if (ids.length > 0) return ids;
  // jest-image-snapshot's default identifier starts with the kebab-cased test file name.
  return [posix.basename(rel).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()];
}

function checkPixelGolden(root, setup, rel, raw, code, report) {
  const at = code.search(/\btoMatchImageSnapshot\s*\(/);
  const problem = (rule, index, message, fix) => report.problem({ file: rel, line: lineOf(code, index < 0 ? at : index), rule, message, fix });
  if (!setup.goldensDirs.some((dir) => rel.startsWith(`${dir}/`))) problem('pixel-golden-place', at, `a pixel golden outside ${setup.goldensDir}/`, `Move it under ${setup.goldensDir}/ (it reads fonts with node:fs and uses Buffer; the app's src/ program has no Node types).`);
  const name = setup.matcherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importsMatcher = new RegExp(`import\\s*\\{[^}]*\\btoMatchPixelGolden\\b[^}]*\\}\\s*from\\s*['"][^'"]*\\b${name}(?:\\.ts)?['"]`).test(code);
  const extendsMatcher = /expect\.extend\(\s*\{\s*toMatchImageSnapshot\s*:\s*toMatchPixelGolden\s*\}\s*\)/.test(code);
  if (!importsMatcher || !extendsMatcher) problem('pixel-matcher', at, `does not use toMatchPixelGolden from ${setup.matcher}`, 'Import it and call expect.extend({ toMatchImageSnapshot: toMatchPixelGolden }); never configureToMatchImageSnapshot in a test.');
  for (const match of code.matchAll(/\b(failureThreshold|failureThresholdType|customDiffConfig|configureToMatchImageSnapshot)\b/g)) problem('golden-tolerance', match.index, `sets ${match[1]} in the test`, `Remove it: the tolerance lives only in ${setup.matcher} (0.1% of pixels).`);
  const sizes = sizesOf(code);
  // A drawing with one true size says so; a golden that draws a function defined in the test itself
  // proves the golden pipeline, not a production surface, so the size matrix does not apply to it.
  const fixedSize = /\/\/\s*fixed-size:\s*\S.{8,}/.test(raw) || drawsLocalFunction(code);
  const animated = /\btimelineEndMs\s*\(|\bMOMENTS\b|\belapsedMs\s*:(?!\s*0\s*[,}\n])/.test(code);
  const hasMoments = /\[\s*0\s*,\s*0\.5\s*,\s*1\s*\]/.test(code);
  if ((sizes < 3 && !fixedSize) || (animated && !hasMoments)) {
    const parts = [sizes < 3 && !fixedSize ? `renders ${sizes} canvas size(s)` : '', animated && !hasMoments ? 'animates but does not render the moments [0, 0.5, 1]' : ''].filter(Boolean);
    problem('pixel-golden-cases', at, parts.join(' and '), 'Render narrow 320x400, phone 390x560 and tablet 1024x700 (a fixed-size drawing says "// fixed-size: <why>"), at moments [0, 0.5, 1] of the busiest change when it animates.');
  }
  const folder = posix.join(posix.dirname(rel), '__image_snapshots__');
  const pngs = existsSync(join(root, folder)) ? readdirSync(join(root, folder)).filter((file) => file.endsWith('.png')) : [];
  const prefixes = baselinePrefixes(rel, code);
  if (!pngs.some((file) => prefixes.some((prefix) => file.startsWith(prefix)))) problem('baseline-missing', at, `no baseline PNG starting with ${prefixes.map((prefix) => `"${prefix}"`).join(' or ')} in ${folder}/`, `Create them on purpose: npx jest ${rel} --selectProjects golden -u, open every PNG, commit with a Gate-Change trailer.`);
}

/** baseline-orphan: a committed baseline PNG that no pixel golden in its folder claims. */
function checkBaselineOrphans(files, goldenCodes, pixel, report) {
  for (const png of files.filter((rel) => /(^|\/)__image_snapshots__\/[^/]+\.png$/.test(rel))) {
    const folder = posix.dirname(posix.dirname(png));
    const claimers = pixel.filter((rel) => posix.dirname(rel) === folder);
    const prefixes = claimers.flatMap((rel) => baselinePrefixes(rel, goldenCodes.get(rel) ?? ''));
    const name = posix.basename(png);
    if (prefixes.some((prefix) => name.startsWith(prefix))) continue;
    report.problem({ file: png, line: 1, rule: 'baseline-orphan', message: claimers.length === 0 ? `no pixel golden in ${folder === '.' ? 'the repo root' : `${folder}/`} compares against it` : `no pixel golden in ${folder}/ claims it (prefixes ${prefixes.map((prefix) => `"${prefix}"`).join(', ')})`, fix: 'Delete it in the commit that removed or renamed its test (Gate-Change trailer): jest-image-snapshot never reports an unused baseline. A file-level claim is a prefix, so give each golden a distinct identifier prefix.' });
  }
}

function workspaceOf(setup, rel) {
  return setup.layout.workspaces.find((workspace) => rel.startsWith(`${workspace.dir}/`)) ?? null;
}

function matcherFor(root, setup, rel) {
  const workspace = workspaceOf(setup, rel);
  const own = workspace ? posix.join(workspace.layout.testDir, 'goldens', posix.basename(setup.matcher)) : null;
  return own !== null && isFile(root, own) ? own : setup.matcher;
}

function checkMatchers(root, setup, pixel, report) {
  const used = new Set(pixel.map((rel) => matcherFor(root, setup, rel)));
  if (isFile(root, setup.matcher)) used.add(setup.matcher);
  for (const rel of [...used].sort()) {
    if (!isFile(root, rel)) {
      report.problem({ file: rel, line: 1, rule: 'matcher-missing', message: 'pixel goldens exist but the shared matcher does not', fix: "Copy this skill's templates/test/goldens/skia-golden.ts there." });
      continue;
    }
    const code = maskComments(read(root, rel));
    const threshold = /failureThreshold\s*:\s*([0-9.eE+-]+)/.exec(code);
    const type = /failureThresholdType\s*:\s*['"](\w+)['"]/.exec(code);
    const limit = setup.contract.maxPixelTolerance;
    if (!threshold || Number(threshold[1]) > limit || !type || type[1] !== 'percent') report.problem({ file: rel, line: threshold ? lineOf(code, threshold.index) : 1, rule: 'golden-tolerance', message: `tolerance is ${threshold ? threshold[1] : 'missing'} ${type ? type[1] : ''}, not at most ${limit} percent`, fix: `Restore failureThreshold: ${limit} with failureThresholdType: 'percent'. A higher tolerance needs the reviewer's approval first: then raise ${setup.contract.file} "maxPixelTolerance" in the same commit, with "approved by <reviewer>" in the Gate-Change trailer.` });
  }
}

function readManifest(root, rel) {
  if (!isFile(root, rel)) return null;
  try {
    return parseJsonc(read(root, rel));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON (${String(error.message).split('\n')[0]})`, 'Fix the JSON.');
  }
}

function checkPixelDeps(root, setup, pixel, report) {
  const manifests = new Set(pixel.map((rel) => workspaceOf(setup, rel)?.dir ?? '').map((dir) => (dir === '' ? 'package.json' : `${dir}/package.json`)));
  for (const rel of [...manifests].sort()) {
    const own = readManifest(root, rel);
    const top = rel === 'package.json' ? own : readManifest(root, 'package.json');
    if (own === null && top === null) continue;
    const deps = { ...top?.dependencies, ...top?.devDependencies, ...own?.dependencies, ...own?.devDependencies };
    for (const [name, verified] of Object.entries(PIXEL_DEPS)) {
      const version = deps[name];
      if (version === undefined) report.problem({ file: rel, line: 1, rule: 'pixel-deps', message: `pixel goldens exist but devDependencies lack ${name}`, fix: `npm install --save-dev --save-exact ${name}@${verified} (the verified pin).` });
      else if (!/^\d+\.\d+\.\d+$/.test(version)) report.problem({ file: rel, line: 1, rule: 'pixel-deps', message: `${name} is "${version}", not an exact version`, fix: `Pin it exactly (${verified} is verified): a moving matcher changes what "0.1% of pixels" means.` });
    }
  }
}

function automationFiles(root, setup) {
  const places = ['package.json', ...setup.layout.workspaces.map((workspace) => `${workspace.dir}/package.json`), 'lefthook.yml', '.lefthook.yml', 'lefthook-local.yml', '.claude/settings.json', '.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yml', '.lintstagedrc.yaml', '.lintstagedrc.js', '.lintstagedrc.mjs', '.lintstagedrc.cjs', 'lint-staged.config.js', 'lint-staged.config.mjs', 'lint-staged.config.cjs'];
  for (const dir of ['.husky', '.github/workflows', '.eas/workflows']) {
    const abs = join(root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const name of readdirSync(abs).sort()) if (dir === '.husky' ? !name.startsWith('_') : /\.ya?ml$/.test(name)) places.push(`${dir}/${name}`);
  }
  return places.filter((rel) => isFile(root, rel));
}

/** The lines of a file with shell continuations (a trailing backslash) joined, each with its first line number. */
function logicalLines(text) {
  const lines = [];
  let pending = null;
  text.split('\n').forEach((raw, index) => {
    const line = pending === null ? { text: raw, line: index + 1 } : { text: `${pending.text} ${raw.trim()}`, line: pending.line };
    if (/\\\s*$/.test(raw)) pending = { text: line.text.replace(/\\\s*$/, ''), line: line.line };
    else {
      pending = null;
      lines.push(line);
    }
  });
  if (pending !== null) lines.push(pending);
  return lines;
}

/** YAML keys whose value is a label, never a command (a step's `name: Run jest` runs nothing). */
const YAML_LABEL_KEY = /^\s*(?:-\s+)?["']?(?:name|description|title|id|uses|if|label|summary)["']?\s*:/;

/**
 * The part of a YAML or shell line that can run: null for a comment line or a YAML label key, and the
 * line without a trailing ` # comment` otherwise (a `#` inside quotes is kept).
 */
function commandPart(line, yaml) {
  if (/^\s*#/.test(line)) return null;
  if (yaml && YAML_LABEL_KEY.test(line)) return null;
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#' && /\s/.test(line[index - 1] ?? '')) return line.slice(0, index);
  }
  return line;
}

/** The first jest run on the line that may write snapshots: no --ci, not read-only, no CI=1/true before it. */
function jestRunWithoutCi(line) {
  // A permission rule such as "Bash(npx jest *)" in agent settings allows a command; it runs nothing.
  if (/\bBash\(/.test(line)) return null;
  for (const match of line.matchAll(JEST_RUN)) {
    const end = match.index + match[0].length;
    if (/^\s*["']?\s*:/.test(line.slice(end))) continue;
    const start = Math.max(line.lastIndexOf('&&', match.index), line.lastIndexOf(';', match.index), line.lastIndexOf('|', match.index), 0);
    const rest = line.slice(end).split(/&&|\|\||;|\|/)[0];
    if (/\s--ci(?:=true)?\b(?!=)/.test(rest) || JEST_READ_ONLY.test(rest) || /\bCI=(?:1|true)\b/.test(line.slice(start, match.index))) continue;
    return `${match[0].replace(/^[\s"'`;&|(=]+/, '')}${rest.replace(/["'`,]+\s*$/, '')}`.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** Every string under `value` (an object's values, an array's items), depth first. */
function stringsOf(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/**
 * The commands a JSON automation file runs, so a dependency, a keyword or a Jest config key is never read
 * as a run: package.json "scripts" and "lint-staged", a .lintstagedrc.json, agent hooks' "command".
 */
function jsonCommands(rel, text) {
  let data;
  try {
    data = parseJsonc(text);
  } catch {
    return [];
  }
  if (data === null || typeof data !== 'object') return [];
  if (rel.endsWith('package.json')) return [...stringsOf(data.scripts ?? {}), ...stringsOf(data['lint-staged'] ?? {})];
  if (rel.endsWith('settings.json')) return stringsOf(data.hooks ?? {});
  return stringsOf(data);
}

function checkAutomation(root, setup, report) {
  const files = automationFiles(root, setup);
  const ciFix = 'Add --ci: without it Jest writes the snapshot of a new golden test unreviewed (and it is then staged); --ci fails on a missing snapshot instead.';
  for (const rel of files) {
    const text = read(root, rel);
    const yaml = /\.ya?ml$/.test(rel);
    const json = /\.json$|^\.lintstagedrc$/.test(rel);
    const updates = new Set();
    for (const { text: raw, line: number } of logicalLines(text)) {
      const line = yaml || rel.startsWith('.husky/') ? commandPart(raw, yaml) : raw;
      if (line === null) continue;
      const match = UPDATE.map((pattern) => pattern.exec(line)).find(Boolean) ?? (yaml ? YAML_CI_OFF.exec(line) : null);
      if (match) {
        updates.add(number);
        report.problem({ file: rel, line: number, rule: 'update-in-automation', message: `"${match[0].trim().slice(0, 70)}" updates goldens automatically`, fix: 'Remove it: goldens and baselines change only by hand, one file at a time, after looking at them, with a Gate-Change trailer.' });
        continue;
      }
      const run = json ? null : jestRunWithoutCi(line);
      if (run !== null) report.problem({ file: rel, line: number, rule: 'jest-without-ci', message: `"${run.slice(0, 70)}" runs jest without --ci`, fix: ciFix });
    }
    if (!json) continue;
    for (const command of jsonCommands(rel, text)) {
      const run = jestRunWithoutCi(command);
      const number = lineOfText(text, JSON.stringify(command).slice(1, -1));
      if (run !== null && !updates.has(number)) report.problem({ file: rel, line: number, rule: 'jest-without-ci', message: `"${run.slice(0, 70)}" runs jest without --ci`, fix: ciFix });
    }
  }
  return files.length;
}

function checkWiring(root, setup, report) {
  let checked = 0;
  const gates = 'quality-gates.json';
  const gatesSkip = notYetCreated(root, { file: gates, owner: 'quality-gates' });
  if (gatesSkip) report.skip({ file: gates, rule: 'gated-path-missing', message: gatesSkip });
  else {
    checked += 1;
    const data = readManifest(root, gates);
    const paths = Array.isArray(data?.gatedPaths) ? data.gatedPaths : [];
    for (const glob of requiredGatedPaths(setup)) if (!paths.includes(glob)) report.problem({ file: gates, line: 1, rule: 'gated-path-missing', message: `gatedPaths lacks ${glob}`, fix: `Add "${glob}" to gatedPaths (in a Gate-Change commit); the commit-msg hook then asks for the trailer.` });
  }
  const ignoreSkip = notYetCreated(root, { file: '.gitignore', owner: 'typescript-and-lint-rules' });
  if (ignoreSkip) report.skip({ file: '.gitignore', rule: 'diff-output-ignored', message: ignoreSkip });
  else {
    checked += 1;
    // A leading / only anchors the pattern to the root; it ignores the same folder.
    const lines = read(root, '.gitignore').split('\n').map((line) => line.trim().replace(/^\/(?!\*)/, ''));
    for (const needed of ['reports/', '**/__image_snapshots__/__diff_output__/']) if (!lines.includes(needed) && !lines.includes(needed.replace(/\/$/, ''))) report.problem({ file: '.gitignore', line: 1, rule: 'diff-output-ignored', message: `does not list ${needed}`, fix: `Add the line ${needed}; diff images are never committed.` });
  }
  return checked;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!isFile(root, 'package.json')) throw new UsageError(`nothing to check: ${positionals[0] ?? '.'} has no package.json`, 'Pass the root of the React Native app (the folder with package.json).');
  const maxLines = parseMaxLines(options['max-entry-lines']);
  const setup = loadGoldenSetup(root, { goldensDir: options['goldens-dir'], matcher: options.matcher, contract: options.contract });
  const report = createReporter({ name: SPEC.name, json: options.json });
  const files = walkRepo(root, { ignore: EXTRA_IGNORES });
  const fileSet = new Set(files);
  const snapshots = files.filter((rel) => SNAPSHOT_FILE.test(rel));
  const snapshotSet = new Set(snapshots);
  for (const rel of files.filter((path) => MISNAMED_GOLDEN.test(path))) report.problem({ file: rel, line: 1, rule: 'golden-never-runs', message: 'no Jest project runs this file', fix: 'Name it <unit>.golden.test.ts (the golden project matches only *.golden.test.ts).' });
  const goldenCodes = new Map();
  const pixel = [];
  for (const rel of files.filter((path) => path.endsWith('.golden.test.ts'))) {
    const raw = read(root, rel);
    const code = maskComments(raw);
    goldenCodes.set(rel, code);
    checkGoldenCode(rel, code, snapshotSet, report);
    if (/\btoMatchImageSnapshot\s*\(/.test(code)) {
      pixel.push(rel);
      checkPixelGolden(root, setup, rel, raw, code, report);
    }
  }
  checkSnapshots(root, snapshots, fileSet, maxLines, report);
  checkBaselineOrphans(files, goldenCodes, pixel, report);
  checkContracts(root, setup, goldenCodes, snapshots, report);
  checkMatchers(root, setup, pixel, report);
  checkPixelDeps(root, setup, pixel, report);
  const policy = checkAutomation(root, setup, report) + checkWiring(root, setup, report);
  return report.finish({ checked: goldenCodes.size + snapshots.length + policy, unit: 'golden tests, snapshots and policy files' });
});
