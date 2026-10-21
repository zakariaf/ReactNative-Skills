#!/usr/bin/env node
// check-animations.mjs: checks the app's Lottie and Rive moments against contracts/animations.json:
// every animation file is bundled, recorded, inside its byte, frame-rate and play budget, has a
// reduced-motion alternative and a licence and source record; only the approved runtimes are used,
// each for its job, and only from the wrapper files, which read useReduceMotion().
// Run from the repo root: node <this skill>/scripts/check-animations.mjs [repo-root] [options]
// Scans use walkRepo: node_modules, generated native folders, build output and every installed
// skill (skills/, .agents/, .claude/, any folder holding a SKILL.md) are left out.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { judgeFileReferences, judgeImports, judgeMoments, judgeRemote, readSource, runtimeImports, wrappersReadReduceMotion } from './lib/animation-code.mjs';
import { judgeBudgets, judgeRecords, loadContract, lottieHeader } from './lib/animations-contract.mjs';

const TABLE = JSON.parse(readFileSync(new URL('../assets/runtimes.json', import.meta.url), 'utf8'));

const RULES = [
  ['remote-animation-source', 'an animation file loaded from a URL (a record, a string literal, fromURL, a { uri } source) instead of a bundled asset'],
  ['unbudgeted-file', 'an animation file with no record, over its byte budget, above the frame-rate budget, an unbounded loop or a run over maxSeconds, a Rive state machine not confirmed to settle, a heavy file not declared heavy, or code whose weight, plays or frameRate differs from the record'],
  ['no-reduce-motion-fallback', 'a runtime imported outside the wrapper files, wrappers that never read useReduceMotion(), a record with no reduced-motion alternative (or hidden informative art), or code whose still differs from the record'],
  ['missing-licence-record', 'a record without a licence or a source'],
  ['unapproved-runtime', 'an animation package other than lottie-react-native and @rive-app/react-native (or Rive without react-native-nitro-modules), a runtime given a job it is not approved for, or a file played by the other runtime'],
];

const SPEC = {
  name: 'check-animations',
  summary: 'Checks the app\'s Lottie and Rive files and the code that plays them against contracts/animations.json.',
  usage: '[repo-root] [options]',
  positionals: { min: 0, max: 1 },
  options: {
    contract: { type: 'string', value: 'file', help: 'The animations contract (default: <contractsDir>/animations.json from resolveLayout)' },
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: srcDir from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  details: [
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id}  ${text}`),
    '',
    'NOT APPLICABLE when package.json names no Lottie or Rive package, no .riv, .lottie or Lottie .json',
    'file is in the repo and no source file imports a runtime. Tests (*.test.*, __mocks__/, test/) may',
    'import a runtime. Exit 2: no package.json, or no (or broken) contract while animations exist.',
  ].join('\n'),
};

const SOURCE_GLOBS = (srcDir) => ['ts', 'tsx', 'js', 'jsx'].map((ext) => `${srcDir}/**/*.${ext}`);
const isTest = (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(__mocks__|__tests__)\//.test(rel) || rel.startsWith('test/');

/** Every .riv and .lottie file in the repo, and every Lottie .json under the assets or source folder. */
function findAnimationFiles(root, assetsDir, srcDir) {
  const lottieJson = walkRepo(root, { include: [`${assetsDir}/**/*.json`, `${srcDir}/**/*.json`] }).filter((rel) => lottieHeader(join(root, rel)) !== null);
  const binaries = walkRepo(root, { include: ['**/*.riv', '**/*.lottie'] });
  return { all: [...new Set([...lottieJson, ...binaries])].sort(), lottieJson: new Set(lottieJson) };
}

function judgePackage({ manifest, manifestText, report }) {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const lineOfDep = (name) => {
    const at = manifestText.indexOf(`"${name}"`);
    return at === -1 ? 1 : lineOf(manifestText, at);
  };
  for (const [name, why] of Object.entries(TABLE.unapproved)) {
    if (name in deps) report.problem({ file: 'package.json', line: lineOfDep(name), rule: 'unapproved-runtime', message: `depends on ${name}: ${why}`, fix: 'Remove it; Lottie plays through lottie-react-native, Rive through @rive-app/react-native, UI motion through Reanimated (motion-and-animation).' });
  }
  for (const [name, entry] of Object.entries(TABLE.approved)) {
    if (!(name in deps)) continue;
    for (const needed of entry.requires.filter((dep) => !(dep in deps))) {
      report.problem({ file: 'package.json', line: lineOfDep(name), rule: 'unapproved-runtime', message: `${name} is installed without ${needed}, which it needs at build time`, fix: `Install it: ${entry.install}.` });
    }
  }
  return deps;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  const report = createReporter({ name: 'check-animations', json: options.json });
  if (!existsSync(join(root, 'package.json'))) fail('package.json not found: nothing to check', 'Run from the app\'s repo root (or pass it as the first argument).');
  const manifestText = readFileSync(join(root, 'package.json'), 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail(`package.json is not valid JSON (${String(error.message).split('\n')[0]})`, 'Fix package.json.');
  }

  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const packages = [...Object.keys(TABLE.approved), ...Object.keys(TABLE.unapproved)];
  const sources = walkRepo(root, { include: SOURCE_GLOBS(layout.srcDir) }).filter((rel) => !isTest(rel)).map((rel) => readSource(root, rel));
  const usesRuntime = sources.some((source) => runtimeImports(source, TABLE).length > 0);
  const defaultFiles = findAnimationFiles(root, 'assets', layout.srcDir);
  if (!packages.some((name) => name in deps) && defaultFiles.all.length === 0 && !usesRuntime) {
    return report.notApplicable('no Lottie or Rive runtime in package.json, no animation file in the repo and no import of a runtime');
  }

  judgePackage({ manifest, manifestText, report });
  const contract = loadContract(root, options.contract ?? posix.join(layout.contractsDir, 'animations.json'));
  const assetsDir = typeof contract.data.assetsDir === 'string' ? contract.data.assetsDir.replace(/\/$/, '') : 'assets';
  const wrapperFiles = Array.isArray(contract.data.wrapperFiles) ? contract.data.wrapperFiles : [`${layout.uiDir}/animation/**`];
  const budgets = judgeBudgets(contract, TABLE, report);
  const records = judgeRecords({ root, contract, table: TABLE, budgets, report });
  const recordsByFile = new Map(records.map((record) => [record.file, record]));

  const files = findAnimationFiles(root, assetsDir, layout.srcDir);
  for (const rel of files.all.filter((file) => !recordsByFile.has(file))) {
    report.problem({ file: rel, line: 1, rule: 'unbudgeted-file', message: `${rel} has no record in ${contract.rel}`, fix: 'Add its record: runtime, job, maxBytes, fps, plays or settles, heavy, decorative, reducedMotion, licence, source.' });
  }

  for (const source of sources) {
    judgeImports({ source, table: TABLE, wrapperFiles, report });
    judgeRemote({ source, table: TABLE, report });
    const skipLines = judgeMoments({ root, source, recordsByFile, aliases: layout.aliases, report });
    judgeFileReferences({ root, source, recordsByFile, lottieFiles: files.lottieJson, aliases: layout.aliases, skipLines, report });
  }
  if (usesRuntime && !wrappersReadReduceMotion(sources, wrapperFiles)) {
    for (const source of sources.filter((item) => runtimeImports(item, TABLE).length > 0)) {
      report.problem({ file: source.rel, line: runtimeImports(source, TABLE)[0].line, rule: 'no-reduce-motion-fallback', message: `plays ${runtimeImports(source, TABLE)[0].spec}, but no wrapper file calls useReduceMotion()`, fix: 'Keep animation-moment.tsx from this skill: it reads useReduceMotion() (accessibility-as-code) and holds every moment still under Reduce Motion.' });
    }
  }
  return report.finish({ checked: sources.length + files.all.length + records.length, unit: 'files and records' });
});
