#!/usr/bin/env node
// check-bypasses.mjs: scans the repo for the ways a gate gets silenced instead of satisfied:
// inline lint or type suppressions, coverage and mutation ignore comments, hook bypasses, snapshot
// auto-updates, relaxed ESLint flags, stray --passWithNoTests, and expired or undated release-age
// exceptions in .npmrc.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-bypasses.mjs [repo-root] [--today YYYY-MM-DD]

import { join } from 'node:path';

import { UsageError, createReporter, lineOf, maskComments, parseArgs, readText, requireDir, run, walkRepo } from './check-lib.mjs';

const SPEC = {
  name: 'check-bypasses',
  summary: 'Finds gate bypasses anywhere in the repo: suppressions, ignore comments, hook bypasses, auto-updated snapshots, relaxed lint flags and stale release-age exceptions.',
  usage: '[repo-root] [options]',
  options: {
    today: { type: 'string', value: 'YYYY-MM-DD', help: 'The date release-age exceptions are compared with (default: today, UTC)' },
    ignore: { type: 'string', multiple: true, value: 'glob', help: 'Skip matching paths' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (comments in .ts/.tsx/.js/.mjs/.cjs; commands in package.json, *.yml, *.sh; .npmrc):',
    '  inline-lint-override    eslint-disable / eslint-enable / "/* eslint ..." / eslint-env / "/* global" comments',
    '  ts-suppression          @ts-ignore or @ts-nocheck',
    '  ts-expect-error-reason  @ts-expect-error without a description of at least 10 characters',
    '  coverage-ignore         istanbul / c8 / v8 ignore comments',
    '  mutation-ignore         "Stryker disable" comments',
    '  hook-bypass             --no-verify, git commit -n (also clustered: -nm, -anm; in code also as an argv list such as',
    '                          [\'commit\', \'-n\', ...]), lefthook uninstall, LEFTHOOK=0 or LEFTHOOK_EXCLUDE (outside',
    '                          .github/workflows), core.hooksPath, HUSKY=0',
    '  pass-with-no-tests      --passWithNoTests outside check:fast and the lefthook test-related job',
    '  snapshot-auto-update    jest -u / --updateSnapshot / --ci=false, or --update, inside a script, hook or workflow',
    '  eslint-flag             --max-warnings other than 0, --quiet, --rule, --no-inline-config, --no-config-lookup, --no-eslintrc',
    '  release-age-exclude     a min-release-age-exclude (any spelling) outside a dated block, or in a block whose expiry',
    '                          date has passed',
    '  release-age-lowered     min-release-age set below 7',
    '',
    'quality-gates.json is skipped (it quotes the rules it enforces; check-gate-wiring.mjs checks it). The repo walk skips',
    'installed agent skills (skills/, .agents/, .claude/, .cursor/, ... and any folder holding a SKILL.md: their fixtures',
    'plant these bypasses on purpose), node_modules, Pods, the generated ios/ and android/ folders, build output (each',
    'workspace\'s too when multi-package), reports, dist-audit/ and .stryker-tmp/. Same-named source folders such as',
    'scripts/build/ are scanned.',
  ].join('\n'),
};

const INCLUDE = ['*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs', '*.json', '*.yml', '*.yaml', '*.sh', '.npmrc'];
// walkRepo already skips installed skills, node_modules, Pods, generated native folders and build
// output (scripts/build/ is still scanned); these are the reports and sandboxes the gates write.
const IGNORE = ['dist-audit/**', 'reports/**', '.stryker-tmp/**', 'package-lock.json', 'quality-gates.json'];
const CODE = /\.(ts|tsx|js|mjs|cjs)$/;
const COMMANDS = /(^|\/)(package\.json|[^/]+\.ya?ml|[^/]+\.sh)$/;

// Directives only count at the start of a comment (that is how ESLint, TypeScript, istanbul and
// Stryker read them), so a comment that merely mentions "eslint-disable" is fine.
const DIRECTIVES = [
  { rule: 'inline-lint-override', re: /^(eslint-disable(?:-next-line|-line)?|eslint-enable|eslint-env|eslint\s+[\w@/-]+\s*:|globals?\s|exported\s)/, fix: 'Fix the code instead; inline ESLint config is inert here (noInlineConfig) and reported. A real exception is a file-exact block in eslint.config.mjs agreed with the developer (typescript-and-lint-rules, Gate-Change:).' },
  { rule: 'ts-suppression', re: /^@ts-(ignore|nocheck)\b/, fix: 'Fix the type error; never silence tsc. Use @ts-expect-error with a reason only for a wrong third-party type.' },
  { rule: 'coverage-ignore', re: /^(istanbul|c8|v8)\s+ignore\b/, fix: 'Test the uncovered behaviour instead of hiding it from the coverage gate.' },
  { rule: 'mutation-ignore', re: /^stryker\s+(disable|restore)\b/i, fix: 'Kill the surviving mutant with a boundary example instead of disabling mutation.' },
];

/** Every comment in a JS/TS source: { index, text } with the comment markers removed. */
function comments(source) {
  const masked = maskComments(source);
  const out = [];
  let i = 0;
  while (i < source.length) {
    const isStart = masked[i] !== source[i] && (source.startsWith('//', i) || source.startsWith('/*', i));
    if (!isStart) {
      i += 1;
      continue;
    }
    const block = source.startsWith('/*', i);
    const end = block ? source.indexOf('*/', i + 2) : source.indexOf('\n', i);
    const stop = end === -1 ? source.length : end;
    out.push({ index: i, text: source.slice(i + 2, stop).replace(/^[\s*]+/, '') });
    i = block && end !== -1 ? stop + 2 : stop;
  }
  return out;
}

// git commit's short-flag cluster that holds n (-n, -nm, -anm), as in checkCommands.
const COMMIT_N = String.raw`-[apsSeiouvqz]*n[apsSeiouvqzn]*[mFCct]?`;
const CODE_BYPASS = new RegExp([
  String.raw`--no-verify\b|\bLEFTHOOK(?:_EXCLUDE)?\b|core\.hooksPath`,
  // a command string: execSync('git commit -n -m wip')
  String.raw`\bgit\s+commit\b[^\n'"\x60]*?\s${COMMIT_N}(?![\w-])`,
  // an argv list: execFileSync('git', ['commit', '-n', '-m', message])
  String.raw`['"\x60]commit['"\x60]\s*,[^\]\n]*?['"\x60]${COMMIT_N}['"\x60]`,
].join('|'), 'g');

function checkCode(report, rel, source) {
  const code = maskComments(source);
  for (const match of code.matchAll(CODE_BYPASS)) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'hook-bypass', message: `code passes "${match[0]}" to git`, fix: 'Run git through the hooks; a script that bypasses them hides every gate.' });
  }
  for (const comment of comments(source)) {
    const line = lineOf(source, comment.index);
    for (const { rule, re, fix } of DIRECTIVES) {
      const match = re.exec(comment.text);
      if (match) report.problem({ file: rel, line, rule, message: `"${match[0].trim()}" silences a gate`, fix });
    }
    const expect = /^@ts-expect-error\b[:\s-]*([^\n]*)/.exec(comment.text);
    if (expect && expect[1].replace(/\*\/$/, '').trim().length < 10) report.problem({ file: rel, line, rule: 'ts-expect-error-reason', message: '@ts-expect-error has no real description', fix: 'Add why the third-party type is wrong (at least 10 characters), or fix the types.' });
  }
}

/** Blank YAML and shell comments so prose about a flag is not read as the flag. */
function withoutHashComments(text) {
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*#/.test(line)) return '';
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '#' && /\s/.test(line[i - 1] ?? ' ')) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function checkCommands(report, rel, text) {
  const inWorkflow = rel.startsWith('.github/workflows/');
  const flag = (index, rule, message, fix) => report.problem({ file: rel, line: lineOf(text, index), rule, message, fix });
  // -n alone or in a cluster of git commit's short flags (-n, -nm "wip", -anm "wip"), in any position.
  const common = String.raw`--no-verify\b|\bgit\s+commit\b[^\n]*?\s-[apsSeiouvqz]*n[apsSeiouvqzn]*[mFCct]?(?![\w-])|\blefthook\s+uninstall\b|core\.hooksPath|\bHUSKY=0\b`;
  const hookBypass = new RegExp(inWorkflow ? common : String.raw`${common}|\bLEFTHOOK(?:_EXCLUDE)?\s*[=:]\s*['"]?\w`, 'g');
  for (const match of text.matchAll(hookBypass)) flag(match.index, 'hook-bypass', `"${match[0]}" bypasses the git hooks`, 'Remove it; commit and push through the hooks, and fix whatever they report.');
  for (const match of text.matchAll(/--passWithNoTests\b/g)) {
    const line = text.slice(text.lastIndexOf('\n', match.index) + 1, text.indexOf('\n', match.index) === -1 ? text.length : text.indexOf('\n', match.index));
    const allowed = (rel === 'package.json' && /"check:fast"\s*:/.test(line)) || (rel === 'lefthook.yml' && /npx jest --ci --bail --findRelatedTests --passWithNoTests \{staged_files\}/.test(line));
    if (!allowed) flag(match.index, 'pass-with-no-tests', '--passWithNoTests used outside check:fast and the pre-commit test-related job', 'Remove it: a test command that finds no tests must fail.');
  }
  for (const match of text.matchAll(/\bjest\b[^\n"]*?\s(-u|--updateSnapshot|--update-snapshot|--ci=false)\b/g)) flag(match.index, 'snapshot-auto-update', `"${match[1]}" lets a script rewrite goldens`, 'Update goldens only by hand (npx jest --selectProjects golden -u <file>) and commit with a Gate-Change: trailer.');
  if (rel === 'package.json') {
    for (const match of text.matchAll(/"[\w:-]+"\s*:\s*"[^"\n]*\s--update\b[^"\n]*"/g)) flag(match.index, 'snapshot-auto-update', 'a package.json script passes --update (rewrites baselines on every run)', 'Run the update by hand when a change is intended, then commit with a Gate-Change: trailer.');
  }
  for (const match of text.matchAll(/--max-warnings(?:\s+|=)(\d+)/g)) {
    if (match[1] !== '0') flag(match.index, 'eslint-flag', `--max-warnings ${match[1]} lets warnings pass`, 'Use --max-warnings 0.');
  }
  for (const match of text.matchAll(/\beslint\b[^\n"]*?\s(--quiet|--rule\b|--no-inline-config|--no-config-lookup|--no-eslintrc)/g)) flag(match.index, 'eslint-flag', `eslint ${match[1]} overrides the config from the command line`, 'Run ESLint only through the npm scripts and hooks, with the config as it is.');
}

function checkNpmrc(report, rel, text, today) {
  let expires = null;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    const header = /^# exclude-block expires=(\d{4}-\d{2}-\d{2}) reason=\S/.exec(line);
    const exclude = /^min-release-age-exclude(?:\[\])?\s*=\s*(\S+)$/.exec(line);
    const age = /^min-release-age=(\d+)$/.exec(line);
    if (header) expires = header[1];
    else if (line === '') expires = null;
    else if (age && Number(age[1]) < 7) report.problem({ file: rel, line: index + 1, rule: 'release-age-lowered', message: `min-release-age=${age[1]} (the policy is 7 days)`, fix: 'Restore min-release-age=7; a needed young fix goes into a dated exception block instead.' });
    else if (exclude && expires === null) report.problem({ file: rel, line: index + 1, rule: 'release-age-exclude', message: `exclude "${exclude[1]}" sits outside a dated block`, fix: 'Put it under "# exclude-block expires=YYYY-MM-DD reason=..." (publish date + 7 days), or delete it.' });
    else if (exclude && expires < today) report.problem({ file: rel, line: index + 1, rule: 'release-age-exclude', message: `exclude "${exclude[1]}" expired on ${expires}`, fix: 'Delete the whole expired block (never extend it); the lockfile keeps the installed versions.' });
  });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new UsageError(`--today "${today}" is not YYYY-MM-DD`, 'Pass a date such as 2026-10-03.');
  const report = createReporter({ name: 'check-bypasses', json: options.json });
  const files = walkRepo(root, { include: INCLUDE, ignore: [...IGNORE, ...(options.ignore ?? [])] });
  let checked = 0;
  for (const rel of files) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    checked += 1;
    if (CODE.test(rel)) checkCode(report, rel, text);
    if (COMMANDS.test(rel)) checkCommands(report, rel, rel.endsWith('.json') ? text : withoutHashComments(text));
    if (rel === '.npmrc' || rel.endsWith('/.npmrc')) checkNpmrc(report, rel, text, today);
  }
  return report.finish({ checked, unit: 'files' });
});
