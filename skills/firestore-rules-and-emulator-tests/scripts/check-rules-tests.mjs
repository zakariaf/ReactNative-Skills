#!/usr/bin/env node
// check-rules-tests.mjs: checks the app's Firestore and Storage security rules and their emulator
// tests: no rule open to everyone, no write granted on a recursive wildcard, every match block named
// by a test that proves its allows and at least one denial, and only demo- project ids for the
// emulators. Paths come from contracts/firebase-rules.json (contractsDir from resolveLayout).
// Run from the repo root: node <this skill>/scripts/check-rules-tests.mjs [repo-root] [options]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { grantsNothing, isWrite, openReason, parseRules, readDescribes, titleNames } from './lib/rules-model.mjs';

const CONTRACT = 'firebase-rules.json';
const TEMPLATE_FIX = 'Copy templates/contracts/firebase-rules.json and firebase-rules.schema.json from the firestore-rules-and-emulator-tests skill into the contracts folder and set the paths of the app.';
const DEMO_ID = /^demo-[a-z0-9-]+$/;
const TEST_FILE = /\.rules\.test\.[cm]?[jt]sx?$/;

const RULES = [
  ['open-rule', 'an allow with no condition, `if true`, or the console test-mode rule `request.time < timestamp.date(...)`'],
  ['wildcard-write', 'a write, create, update or delete allowed on a recursive wildcard path (`{document=**}`, `{allPaths=**}`)'],
  ['untested-match', 'a match block with allows that no running describe names, or whose describe never calls assertSucceeds'],
  ['missing-deny-test', 'a match block whose describe never calls assertFails'],
  ['real-project-id', 'an emulator script without `--project demo-...`, or a test projectId that is not a demo- id'],
];

const SPEC = {
  name: 'check-rules-tests',
  summary: 'Checks Firestore and Storage security rules and their emulator tests (contracts/firebase-rules.json).',
  usage: '[repo-root] [options]',
  positionals: { min: 0, max: 1 },
  options: {
    contract: { type: 'string', value: 'file', help: `The contract, repo-relative (default: <contractsDir>/${CONTRACT}; contractsDir from rn-skills.config.json)` },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  details: [
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id}  ${text}`),
    '',
    'A test names a match block by a describe title that holds its path as the rules file writes it,',
    'below /databases/{database}/documents or /b/{bucket}/o: describe(\'users/{uid}/tasks/{taskId}\', ...).',
    'NOT APPLICABLE when the repo has no firebase.json, no contract and no firebase-tools dependency.',
  ].join('\n'),
};

function readJson(abs, rel) {
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON (${error.message})`, 'Fix the JSON syntax, then rerun.');
  }
}

const safeRel = (value) => typeof value === 'string' && value.trim() !== '' && !value.startsWith('/') && !value.split('/').includes('..');

function readContract(root, rel) {
  const contract = readJson(join(root, rel), rel);
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) fail(`${rel} must be one JSON object`, TEMPLATE_FIX);
  for (const key of ['firestoreRules', 'storageRules']) {
    const value = contract[key];
    if (value === null) continue;
    if (!safeRel(value)) fail(`${rel} ${key} must be a repo-relative path of a .rules file, or null when the app does not use the service`, TEMPLATE_FIX);
    if (!existsSync(join(root, value))) fail(`${rel} ${key} names ${value}, which does not exist`, `Point ${key} at the rules file firebase.json deploys, or set it to null when the app does not use the service.`);
  }
  if (contract.firestoreRules === null && contract.storageRules === null) fail(`${rel} names no rules file`, 'Set firestoreRules or storageRules to the rules file firebase.json deploys.');
  if (!safeRel(contract.testsDir)) fail(`${rel} testsDir must be a repo-relative folder (for example "test/rules")`, TEMPLATE_FIX);
  return contract;
}

function hasFirebaseTools(pkg) {
  return pkg !== null && ['dependencies', 'devDependencies'].some((field) => typeof pkg[field]?.['firebase-tools'] === 'string');
}

/** package.json files the emulator scripts can live in: the root and every workspace. */
function packageFiles(layout) {
  const rels = ['package.json', ...layout.workspaces.map((workspace) => `${toPosix(workspace.dir)}/package.json`)];
  return rels.filter((rel) => existsSync(join(layout.root, rel)));
}

function checkScripts(layout, report) {
  for (const rel of packageFiles(layout)) {
    const text = readFileSync(join(layout.root, rel), 'utf8');
    const pkg = readJson(join(layout.root, rel), rel);
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command !== 'string') continue;
      for (const segment of command.split(/&&|\|\||;/)) {
        if (!/\bfirebase(?:-tools)?\b[^"]*?\bemulators:(?:exec|start)\b/.test(segment)) continue;
        const keyAt = text.indexOf(`"${name}"`);
        const line = keyAt === -1 ? 1 : lineOf(text, keyAt);
        const flag = /(?:--project[=\s]+|-P\s+)(['"]?)([^\s'"]+)\1/.exec(segment.split(/\s"|\s'/)[0]);
        if (flag === null) {
          report.problem({ file: rel, line, rule: 'real-project-id', message: `script "${name}" starts the emulators with no --project, so they run as the .firebaserc project (a real one)`, fix: 'Add --project demo-<app> (for example --project demo-tasks): a demo- project has nothing in production to reach.' });
        } else if (!DEMO_ID.test(flag[2])) {
          report.problem({ file: rel, line, rule: 'real-project-id', message: `script "${name}" runs the emulators as project "${flag[2]}", not a demo- project`, fix: 'Use --project demo-<app>; deploy commands keep the real project, emulator commands never do.' });
        }
      }
    }
  }
}

/** projectId values in the rules tests: literals, or a local or sibling const that holds one. */
function checkTestProjectIds(files, report) {
  const consts = new Map();
  for (const { rel, masked } of files) {
    for (const def of masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"`])([^'"`]*)\2/g)) {
      consts.set(def[1], { rel, value: def[3], line: lineOf(masked, def.index) });
    }
  }
  const reported = new Set();
  for (const { rel, masked } of files) {
    for (const use of masked.matchAll(/\bprojectId\s*:\s*(?:(['"`])([^'"`]*)\1|([A-Za-z_$][\w$]*)(\s*\.)?)/g)) {
      const line = lineOf(masked, use.index);
      if (use[2] !== undefined) {
        if (!DEMO_ID.test(use[2])) report.problem({ file: rel, line, rule: 'real-project-id', message: `projectId "${use[2]}" is not a demo- project id`, fix: 'Use a demo- id (for example demo-tasks), the same one the test:rules script passes to --project.' });
        continue;
      }
      const source = use[4] === undefined ? consts.get(use[3]) : undefined;
      if (source === undefined) {
        report.problem({ file: rel, line, rule: 'real-project-id', message: `projectId comes from ${use[3]}${use[4] ? '...' : ''}, which is not a demo- literal in the rules tests`, fix: 'Write the demo- id as a literal const in the tests folder (export const RULES_TEST_PROJECT_ID = \'demo-tasks\'), never from the environment.' });
      } else if (!DEMO_ID.test(source.value) && !reported.has(source)) {
        reported.add(source);
        report.problem({ file: source.rel, line: source.line, rule: 'real-project-id', message: `${use[3]} = "${source.value}" is the tests' projectId and not a demo- project id`, fix: 'Use a demo- id (for example demo-tasks), the same one the test:rules script passes to --project.' });
      }
    }
  }
}

function checkBlocks(rulesRel, blocks, describes, report) {
  for (const block of blocks) {
    for (const allow of block.allows) {
      const open = openReason(allow);
      if (open !== null) {
        report.problem({ file: rulesRel, line: allow.line, rule: 'open-rule', message: `allow ${allow.methods.join(', ')} on ${block.path || '/'} ${open}`, fix: 'Grant the access to the owner only (isOwner(uid)) with field checks; there is no safe open rule, not even for a while.' });
      }
      if (block.recursive && isWrite(allow) && !grantsNothing(allow)) {
        report.problem({ file: rulesRel, line: allow.line, rule: 'wildcard-write', message: `allow ${allow.methods.join(', ')} on the recursive wildcard ${block.path} reaches every collection or file below it, including ones added later`, fix: 'Write one match block per collection or folder with its own allow-list and type checks; keep recursive wildcards for reads, if at all.' });
      }
    }
    if (block.allows.length === 0) continue;
    const naming = describes.filter((describe) => titleNames(describe.title, block.path));
    const where = { file: rulesRel, line: block.line };
    if (naming.length === 0) {
      report.problem({ ...where, rule: 'untested-match', message: `match ${block.path} has no running describe titled with its path`, fix: `Add describe('${block.path}', ...) to a *.rules.test.ts in the tests folder, with an assertSucceeds per allow and an assertFails per denial.` });
      continue;
    }
    const succeeds = naming.reduce((sum, describe) => sum + describe.succeeds, 0);
    const fails = naming.reduce((sum, describe) => sum + describe.fails, 0);
    if (succeeds === 0 && block.allows.some((allow) => !grantsNothing(allow))) {
      report.problem({ ...where, rule: 'untested-match', message: `match ${block.path} grants access, but its describe has no assertSucceeds, so no allow is proven`, fix: 'Add an assertSucceeds for each allow: the request the app really makes.' });
    }
    if (fails === 0) {
      report.problem({ ...where, rule: 'missing-deny-test', message: `match ${block.path} has no assertFails in its describe, so no denial is proven`, fix: 'Add an assertFails for another user, a signed-out client and each field or type check.' });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-rules-tests', json: options.json });

  const contractRel = toPosix(options.contract ?? join(layout.contractsDir, CONTRACT));
  if (!existsSync(join(root, contractRel))) {
    const pkg = existsSync(join(root, 'package.json')) ? readJson(join(root, 'package.json'), 'package.json') : null;
    if (!existsSync(join(root, 'firebase.json')) && !hasFirebaseTools(pkg)) {
      return report.notApplicable(`no firebase.json, no ${contractRel} and firebase-tools is not in package.json`);
    }
    fail(`${contractRel} is missing`, TEMPLATE_FIX);
  }
  const contract = readContract(root, contractRel);

  const testsDir = toPosix(contract.testsDir).replace(/\/+$/, '');
  const testsAbs = join(root, testsDir);
  const testFiles = existsSync(testsAbs) && statSync(testsAbs).isDirectory()
    ? walkRepo(root, { include: [`${testsDir}/**`] }).filter((rel) => /\.[cm]?[jt]sx?$/.test(rel))
    : [];
  const sources = testFiles.map((rel) => ({ rel, masked: maskComments(readFileSync(join(root, rel), 'utf8')) }));
  const describes = sources.filter(({ rel }) => TEST_FILE.test(rel)).flatMap(({ masked }) => readDescribes(masked));

  let checked = 0;
  for (const [key, service] of [['firestoreRules', 'firestore'], ['storageRules', 'storage']]) {
    if (contract[key] === null) continue;
    const rulesRel = toPosix(contract[key]);
    const blocks = parseRules(readFileSync(join(root, rulesRel), 'utf8'), service);
    checked += blocks.filter((block) => block.allows.length > 0).length;
    checkBlocks(rulesRel, blocks, describes, report);
  }
  checkScripts(layout, report);
  checkTestProjectIds(sources, report);
  return report.finish({ checked, unit: 'match blocks' });
});
