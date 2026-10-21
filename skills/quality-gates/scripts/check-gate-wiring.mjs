#!/usr/bin/env node
// check-gate-wiring.mjs: checks, without running any tool, that the repo's quality gates are wired
// and not weakened: the canonical npm scripts and their targets, lefthook.yml, the Claude Code hooks
// and permissions, quality-gates.json (no value weaker than this skill's baseline), the verify extra
// steps, the .npmrc policy lines, the ESLint linter options, the Jest thresholds, the knip ignore
// reasons, and the gate scripts this skill ships.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-gate-wiring.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_SKILL_FOLDERS, backendWorkspaces, createReporter, fail, globToRegExp, lineOf, maskComments, notYetCreated, parseArgs, PROJECT_CONFIG_FILE, requireDir, resolveLayout, run, toPosix, walk } from './check-lib.mjs';
import { findWeaker } from './lib/not-weaker.mjs';
import { isExpoApp } from './lib/workspaces.mjs';
import { isLogicCounterpart, probeFor, reaches, singleAppForm, singleAppList, workspacePrefixes, workspacesWithSource } from './lib/workspace-scope.mjs';

const SPEC = {
  name: 'check-gate-wiring',
  summary: 'Checks that every quality gate is present, wired into the hooks, and no weaker than the baseline in this skill\'s templates.',
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  gate-file-missing       a file this skill creates is missing (package.json scripts aside: lefthook.yml,',
    '                          quality-gates.json, .claude/settings.json, the gate scripts under scripts/quality/',
    '                          and scripts/hooks/). A gate file another skill creates (eslint.config.mjs, knip.json,',
    '                          .prettierrc.json, tsconfig.base.json, jest.config.js, .npmrc, the device-only helper)',
    '                          prints a SKIP naming that skill while it does not exist, and its rules wait for it',
    '  script-target           a canonical npm script, a lefthook job or a verify extra step runs `node <file>` and',
    '                          the file does not exist. A target another skill creates (scripts/deps/, scripts/audit/,',
    '                          scripts/i18n/, scripts/git/) prints a SKIP naming that skill instead',
    '  npm-script              a canonical npm script is missing or differs from templates/package-scripts.json',
    '                          (start, android, ios and web are the app\'s own; "prepare" runs',
    '                          scripts/hooks/install-git-hooks.ts, which skips by itself outside the git top level,',
    '                          and may be absent only with rn-skills.config.json "lefthookPrepare": "parent-repo",',
    '                          never in a git root)',
    '  gate-weakened           quality-gates.json holds a value weaker than the baseline, or lost an entry',
    '  verify-step             quality-gates.json "verifyExtraSteps" is not a list of distinct npm script names, names',
    '                          a core step, or names a script package.json lacks',
    '  claude-settings         .claude/settings.json lost a deny or ask rule or a hook, disables hooks, or allows a',
    '                          hook bypass, or a gate hook command differs from assets/claude-settings.json; or the',
    '                          git-ignored .claude/settings.local.json disables hooks or allows a bypass',
    '  lefthook                a hook job, glob or secret glob is missing or changed, a job is switched off (skip:, only:,',
    '                          exclude_tags:), or a job excludes a file the baseline does not; or a local (usually',
    '                          git-ignored) lefthook-local.yml switches a job off or overrides a gate hook (pre-commit,',
    '                          commit-msg, pre-push)',
    '  npmrc                   .npmrc lacks a policy line of quality-gates.json "npmrcLines"',
    '  eslint-linter-options   eslint.config.mjs no longer makes inline disables inert and reported',
    '  jest-thresholds         jest.config.js coverage thresholds are below the baseline floors, or a path key of the',
    '                          baseline (./src/core/, ./src/data/, ...) or of quality-gates.json is no longer in it',
    '  jest-scope              jest.config.js changed what coverage or a project covers: a collectCoverageFrom,',
    '                          coveragePathIgnorePatterns, testPathIgnorePatterns, modulePathIgnorePatterns, testMatch,',
    '                          testRegex or roots value (or a constant it spreads) differs from the canonical config',
    '                          in assets/jest-config-baseline.js (multi-package: its workspace form, and every workspace',
    '                          with src/ stays reached, a Node backend such as functions/ by the canonical projects or',
    '                          by a listed project named after its folder); a project quality-gates.json jest.projects',
    '                          adds is left to the guardrail, and every canonical project keeps its displayName',
    '  gate-scope              a gate reaches into installed agent skills: gated-paths.ts lost the agent-folder',
    '                          exclusion, an Edit(**/...) ask rule prompts for skill files, or an agent folder holding',
    '                          code (.claude/skills/, .agents/skills/, ...) is not in knip.json "ignore"',
    '  gate-script-changed     a gate script differs from its template (verify plan and runner, guardrail, gated',
    '                          paths, edit hook, device-only coverage helper)',
    '  knip-ignores            a knip.json ignore entry has no written reason in contracts/knip-ignores.json',
    '',
    'The repo root is the optional positional argument (default "."). Expected SKIP lines while other skills',
    'have not run yet, for example: SKIP scripts/git/check-commit-message.ts [script-target] not yet created',
    '(git-commits-and-reporting creates it).',
    'When multi-package (package.json "workspaces"), the typecheck and export:audit scripts are the workspace',
    'forms in assets/package-scripts.multi-package.json; the baseline ESLint probes and the app program take each',
    'Expo app workspace\'s prefix (apps/<app>/src/core/gate-probe.ts; apps/<app>/tsconfig.json, matched by a',
    'typescript.projects key or glob), every workspace tsconfig.json is listed under typescript.projects, and the',
    'Jest scope and logic keys may take their workspace form',
    '(<rootDir>/apps/*/src/**/, ./packages/core/src/). rn-skills.config.json keys read: "contractsDir" (where',
    'knip-ignores.json lives) and "lefthookPrepare".',
  ].join('\n'),
};

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(SKILL, 'templates');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readText = (root, rel) => readFileSync(join(root, rel), 'utf8');
const squash = (text) => text.replace(/\s+/g, '');

/** Gate files and script targets another skill creates: missing, they print a SKIP naming it. */
const OWNERS = {
  'eslint.config.mjs': 'typescript-and-lint-rules',
  'knip.json': 'typescript-and-lint-rules',
  '.prettierrc.json': 'typescript-and-lint-rules',
  'tsconfig.base.json': 'typescript-and-lint-rules',
  'jest.config.js': 'unit-and-component-tests',
  'scripts/quality/device-only.ts': 'unit-and-component-tests',
  '.npmrc': 'dependency-management',
  'scripts/deps/check-deps.ts': 'dependency-management',
  'scripts/deps/check-npm-config.ts': 'dependency-management',
  'scripts/audit/audit-licenses.ts': 'dependency-management',
  'scripts/i18n/verify-catalogs.ts': 'i18n-strings-and-catalogs',
  'scripts/git/check-commit-message.ts': 'git-commits-and-reporting',
};
const OWN_CONFIGS = ['lefthook.yml', 'quality-gates.json', '.claude/settings.json'];
const OTHER_CONFIGS = ['eslint.config.mjs', 'knip.json', '.prettierrc.json', 'tsconfig.base.json', 'jest.config.js', '.npmrc'];
const DEV_SCRIPTS = new Set(['start', 'android', 'ios', 'web']);
const PREPARE_KEY = 'lefthookPrepare';
const NODE_TARGET = /(?:^|&&\s*|\s)node\s+(?:"\$\(git rev-parse --show-toplevel\)\/)?([\w./-]+\.(?:ts|mjs|js))/;
const SCRIPT_NAME = /^[a-z][a-z0-9]*(?:[:-][a-z0-9]+)*$/;
const LOCAL_LEFTHOOK = ['lefthook-local.yml', 'lefthook-local.yaml', '.lefthook-local.yml', '.lefthook-local.yaml'];
const LOCAL_SETTINGS = '.claude/settings.local.json';
const BYPASS_ALLOW = /no-verify|LEFTHOOK=0|hooksPath|lefthook uninstall|git commit -n/;
const CODE_FILES = ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.mts', '*.cts'];
const LINTER_OPTIONS = [/noInlineConfig:\s*true/, /reportUnusedDisableDirectives:\s*'error'/, /reportUnusedInlineConfigs:\s*'error'/];
/** jest.config.js keys that decide which files coverage and the test projects reach. */
const JEST_SCOPE_KEYS = ['collectCoverageFrom', 'coveragePathIgnorePatterns', 'testPathIgnorePatterns', 'modulePathIgnorePatterns', 'testMatch', 'testRegex', 'roots'];
const ARRAY_METHODS = new Set(['map', 'filter', 'flatMap', 'concat', 'slice']);
const AGENT_EXCLUSION = /AGENT_FOLDERS\.find\(\(prefix\) => file\.startsWith\(prefix\)\)[\s\S]*?!pattern\.startsWith\(folder\)/;

/** The gate scripts this skill owns (canonical, synced into templates/scripts/), by repo path; another owner's helper is left out. */
function ownToolFiles() {
  return walk(join(TEMPLATES, 'scripts'), { include: ['*.ts'] })
    .map((rel) => `scripts/${rel}`)
    .filter((rel) => !rel.endsWith('.test.ts') && OWNERS[rel] === undefined);
}

/** The verify plan's core step names, read from the template so the two never drift. */
function coreSteps() {
  const source = readFileSync(join(TEMPLATES, 'scripts', 'quality', 'verify-plan.ts'), 'utf8');
  const list = /CORE_STEPS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * A workspace-form command for one Expo app workspace: <app-dir> is its folder, <to-root> the way back up.
 * With several apps the one the repo's own script names is the baseline (else the first).
 */
function fillAppDir(command, appWorkspaces, actual) {
  if (!command.includes('<app-dir>') || appWorkspaces.length === 0) return command;
  const forms = appWorkspaces.map((dir) => command.replaceAll('<app-dir>', dir).replaceAll('<to-root>', dir.split('/').map(() => '..').join('/')));
  return forms.find((form) => form === actual) ?? forms[0];
}

/** The baseline scripts: the canonical map, with the workspace forms when multi-package. */
function baselineScripts(ctx) {
  const scripts = readJson(join(TEMPLATES, 'package-scripts.json'));
  if (ctx.layout.mode !== 'monorepo') return scripts;
  const multi = readJson(join(SKILL, 'assets', 'package-scripts.multi-package.json')).scripts;
  return { ...scripts, ...Object.fromEntries(Object.entries(multi).map(([name, command]) => [name, fillAppDir(command, ctx.appWorkspaces, ctx.pkg.scripts?.[name])])) };
}

/** The single app's program in the canonical typescript.projects; multi-package, each Expo app workspace's own. */
const APP_PROGRAM = 'src/tsconfig.json';

/**
 * The baseline quality-gates.json. Multi-package, its npmScripts take the workspace forms, and the paths
 * that name the single app's src/ take each Expo app workspace's prefix: the ESLint probes become
 * apps/<app>/src/... (the guardrail lints those paths), and the app program src/tsconfig.json leaves
 * typescript.projects (checkWorkspacePrograms matches apps/<app>/tsconfig.json against the app's keys).
 */
function baselineGates(scripts, ctx) {
  const gates = readJson(join(TEMPLATES, 'quality-gates.json'));
  for (const name of Object.keys(gates.npmScripts)) gates.npmScripts[name] = scripts[name];
  if (ctx.layout.mode !== 'monorepo' || ctx.appWorkspaces.length === 0) return gates;
  gates.eslint.probes = Object.fromEntries(
    Object.entries(gates.eslint.probes).flatMap(([file, ruleSet]) => (file.startsWith('src/') ? ctx.appWorkspaces.map((dir) => [`${dir}/${file}`, ruleSet]) : [[file, ruleSet]])),
  );
  gates.appProgram = gates.typescript.projects[APP_PROGRAM];
  delete gates.typescript.projects[APP_PROGRAM];
  return gates;
}

/**
 * Multi-package: every workspace program is listed under typescript.projects (a literal path or a glob
 * such as apps/*\/tsconfig.json), so the guardrail compares its compiler options; an Expo app workspace
 * always is, with no value weaker than the single app's program (types ["jest"], never node).
 */
function checkWorkspacePrograms(actual, baseline, ctx, report) {
  if (baseline.appProgram === undefined) return;
  const projects = actual.typescript?.projects ?? {};
  for (const dir of ctx.layout.workspaces.map((workspace) => workspace.dir)) {
    const isApp = ctx.appWorkspaces.includes(dir);
    const program = `${dir}/tsconfig.json`;
    if (!isApp && !existsSync(join(ctx.root, program))) continue;
    const key = Object.keys(projects).find((pattern) => pattern === program || globToRegExp(pattern).test(program));
    if (key === undefined) {
      report.problem({ file: 'quality-gates.json', line: 1, rule: 'gate-weakened', message: `typescript.projects has no entry for ${program}, so the guardrail never compares that program's compiler options${isApp ? ` (baseline ${JSON.stringify(baseline.appProgram)}, the app program)` : ''}`, fix: `Add "${dir.includes('/') ? `${dirname(dir)}/*` : dir}/tsconfig.json" (or the literal path) with the program's types, in the same gate change as the tsconfig.` });
      continue;
    }
    if (!isApp) continue;
    for (const { path, message } of findWeaker(baseline.appProgram, projects[key], ['typescript', 'projects', key])) report.problem({ file: 'quality-gates.json', line: 1, rule: 'gate-weakened', message: `${path} ${message}`, fix: GATE_FIX });
  }
}

function tryJson(root, rel, rule, report) {
  try {
    return readJson(join(root, rel));
  } catch (error) {
    report.problem({ file: rel, line: 1, rule, message: `is not valid JSON (${error.message.split('\n')[0]})`, fix: 'Restore the file from this skill\'s template and re-apply only agreed changes.' });
    return null;
  }
}

/**
 * rn-skills.config.json "lefthookPrepare": "parent-repo" says the app is a folder inside a larger git
 * repository whose root installs lefthook, so the app may drop `prepare`. The canonical `prepare`
 * (scripts/hooks/install-git-hooks.ts) already skips outside the git top level, so the key is only for an
 * app that keeps no `prepare` at all. Never valid where the app folder is itself the git root.
 */
function prepareExempt(root, layout, report) {
  const value = layout.config?.[PREPARE_KEY];
  if (value === undefined) return false;
  if (value !== 'parent-repo') fail(`${PROJECT_CONFIG_FILE} "${PREPARE_KEY}" is ${JSON.stringify(value)}`, `Use "parent-repo" (the app is a folder inside a larger git repository whose root installs lefthook) or remove the key.`);
  if (existsSync(join(root, '.git'))) {
    report.problem({ file: PROJECT_CONFIG_FILE, line: 1, rule: 'npm-script', message: `"${PREPARE_KEY}" is "parent-repo", but this folder is the git root (.git is here), so nothing else installs its hooks`, fix: 'Remove the key and add the canonical "prepare": "node scripts/hooks/install-git-hooks.ts".' });
    return false;
  }
  return true;
}

function checkScripts(root, layout, pkg, scripts, report) {
  const exempt = prepareExempt(root, layout, report);
  for (const [name, command] of Object.entries(scripts)) {
    if (DEV_SCRIPTS.has(name)) continue;
    const actual = pkg.scripts?.[name];
    if (name === 'prepare' && actual === undefined && exempt) {
      report.note(`npm script "prepare" not required: ${PROJECT_CONFIG_FILE} "${PREPARE_KEY}" is "parent-repo" (the enclosing repository installs the git hooks)`);
      continue;
    }
    if (actual === undefined) report.problem({ file: 'package.json', line: 1, rule: 'npm-script', message: `script "${name}" is missing`, fix: `Add "${name}": ${JSON.stringify(command)}.` });
    else if (actual !== command) report.problem({ file: 'package.json', line: 1, rule: 'npm-script', message: `script "${name}" is ${JSON.stringify(actual)}`, fix: `Restore it to ${JSON.stringify(command)} (the guardrail compares it byte for byte).` });
  }
}

/** Every `node <file>` target: canonical scripts, lefthook jobs and the Claude Code hooks. */
function canonicalTargets(scripts) {
  const targets = [];
  for (const [name, command] of Object.entries(scripts)) {
    const file = NODE_TARGET.exec(command)?.[1];
    if (file) targets.push({ file, by: `npm run ${name}`, where: 'package.json' });
  }
  for (const line of readFileSync(join(TEMPLATES, 'lefthook.yml'), 'utf8').split('\n')) {
    const file = /^\s*run:\s*(.*)$/.exec(line) && NODE_TARGET.exec(line)?.[1];
    if (file) targets.push({ file, by: 'a lefthook job', where: 'lefthook.yml' });
  }
  return targets;
}

function checkTargets(root, targets, own, report) {
  for (const { file, by, where } of targets) {
    if (existsSync(join(root, file)) || own.has(file)) continue;
    const owner = OWNERS[file];
    if (owner) report.skip({ file, rule: 'script-target', message: notYetCreated(root, { file, owner }) });
    else report.problem({ file: where, line: 1, rule: 'script-target', message: `${by} runs ${file}, which does not exist`, fix: 'Create the file the script runs (from the skill that ships it) or remove the script from the verify plan; a gate never points at a missing file.' });
  }
}

function checkExtraSteps(pkg, gates, report) {
  const value = gates.verifyExtraSteps;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    report.problem({ file: 'quality-gates.json', line: 1, rule: 'verify-step', message: 'verifyExtraSteps is not a list of npm script names', fix: 'Write "verifyExtraSteps": ["<script>", ...] (an empty list when no skill added a gate).' });
    return [];
  }
  const core = coreSteps();
  const targets = [];
  value.forEach((name, index) => {
    const problem = (message, fix) => report.problem({ file: 'quality-gates.json', line: 1, rule: 'verify-step', message: `verifyExtraSteps "${name}" ${message}`, fix });
    if (!SCRIPT_NAME.test(name)) problem('is not an npm script name', 'List the script name only; its command lives in package.json.');
    else if (core.includes(name)) problem('is already a core verify step', 'Remove it: the verify plan runs it.');
    else if (value.indexOf(name) !== index) problem('is listed twice', 'Remove the repeat.');
    else if (pkg.scripts?.[name] === undefined) problem('is not a script in package.json', `Add the "${name}" script the skill that owns the gate documents, or remove the step with the developer's agreement (a gate change).`);
    else {
      const file = NODE_TARGET.exec(pkg.scripts[name])?.[1];
      if (file) targets.push({ file, by: `npm run ${name} (a verify step)`, where: 'package.json' });
    }
  });
  return targets;
}

const GATE_FIX = 'Restore the baseline value; a gate changes only with the developer\'s agreement, in one commit with the gate and a Gate-Change: trailer.';
const JEST_LIST_KEYS = ['collectCoverageFrom', 'coveragePathIgnorePatterns', 'testPathIgnorePatterns', 'modulePathIgnorePatterns', 'testMatch', 'testRegex', 'roots'];

/**
 * The two sides findWeaker compares: the logic threshold keys leave the baseline (checkThresholdKeys
 * matches them, by workspace or package form when multi-package), and the app's Jest scope lists take
 * their single-app form, so a workspace repo compares with the canonical scope.
 */
function forComparison(actual, baseline, ctx) {
  const base = structuredClone(baseline);
  base.jest.coverageThreshold = { global: base.jest.coverageThreshold.global };
  if (ctx.prefixes.length === 0 || typeof actual.jest !== 'object' || actual.jest === null) return { base, app: actual };
  const app = structuredClone(actual);
  app.jest.collectCoverageFrom = singleAppList(app.jest.collectCoverageFrom, ctx.prefixes);
  for (const project of Object.values(app.jest.projects ?? {})) {
    for (const key of JEST_LIST_KEYS) if (project && key in project) project[key] = singleAppList(project[key], ctx.prefixes);
  }
  return { base, app };
}

/** Every baseline logic key (or, multi-package, its workspace or package form) keeps the logic floors; any other path key keeps at least the global floors. */
function checkThresholdKeys(actual, baseline, ctx, report) {
  const problem = (message) => report.problem({ file: 'quality-gates.json', line: 1, rule: 'gate-weakened', message, fix: GATE_FIX });
  const base = baseline.jest.coverageThreshold;
  const app = actual.jest?.coverageThreshold;
  if (typeof app !== 'object' || app === null) return;
  const logicKeys = Object.keys(base).filter((key) => key !== 'global');
  const appKeys = Object.keys(app).filter((key) => key !== 'global');
  const counterpart = (key, logic) => (ctx.layout.mode === 'monorepo' ? isLogicCounterpart(key, logic, ctx.layout, ctx.pkg) : key === logic);
  for (const logic of logicKeys) {
    if (appKeys.some((key) => counterpart(key, logic))) continue;
    problem(`jest.coverageThreshold.${logic} is missing${ctx.layout.mode === 'monorepo' ? ` (nor a workspace or package form of it, such as "./packages/${/^\.\/src\/([^/]+)/.exec(logic)?.[1] ?? 'core'}/src/")` : ''}, so its files fall back to the global floors`);
  }
  for (const key of appKeys) {
    const logic = logicKeys.find((name) => counterpart(key, name));
    const floor = logic === undefined ? base.global : base[logic];
    for (const [metric, minimum] of Object.entries(floor)) {
      const value = app[key]?.[metric];
      if (typeof value === 'number' && value >= minimum) continue;
      problem(`jest.coverageThreshold.${key}.${metric} ${typeof value === 'number' ? `was lowered to ${value}` : 'is missing'} (at least ${minimum}${logic === undefined ? ': a path key takes its files out of the global floors' : ''})`);
    }
  }
}

/** The glob a fix names for a workspace: apps/mobile -> apps/*; a folder at the root (functions) stays itself. */
const workspaceGlob = (dir) => (dir.includes('/') ? dir.replace(/[^/]+$/, '*') : dir);

/** Multi-package: coverage and every canonical project's tests still reach each workspace's src/. */
function checkWorkspaceReach(actual, baseline, ctx, report) {
  const problem = (message, fix) => report.problem({ file: 'quality-gates.json', line: 1, rule: 'gate-weakened', message, fix });
  for (const dir of ctx.sourceWorkspaces) {
    const probe = probeFor(dir, baseline.jest.collectCoverageFrom.find((glob) => !glob.startsWith('!')));
    if (probe && !reaches(actual.jest?.collectCoverageFrom, probe)) problem(`jest.collectCoverageFrom does not reach ${dir}/src (no glob matches ${probe})`, `Add the workspace form of the source glob ("${workspaceGlob(dir)}/src/**/*.{ts,tsx}") in jest.config.js and here together; every workspace's code is covered.`);
    // A Node backend whose own project runs its tests (displayName = its folder) is that project's, not the canonical projects'.
    if (ctx.backendProjects.has(dir) && reaches(actual.jest?.projects?.[ctx.backendProjects.get(dir)]?.testMatch, `${dir}/src/a/x.test.ts`)) continue;
    for (const [name, project] of Object.entries(baseline.jest.projects)) {
      const glob = (project.testMatch ?? []).find((item) => probeFor(dir, item) !== null);
      const testProbe = glob && probeFor(dir, glob);
      if (testProbe && !reaches(actual.jest?.projects?.[name]?.testMatch, testProbe)) problem(`jest.projects.${name}.testMatch does not reach ${dir}/src (no glob matches ${testProbe})`, `Add the workspace form of the test root ("<rootDir>/${workspaceGlob(dir)}/src/**/") to TEST_ROOTS in jest.config.js and here together${ctx.backendProjects.has(dir) ? `, or run the Node backend's tests in a project of its own (displayName '${ctx.backendProjects.get(dir)}', testMatch <rootDir>/${dir}/src/**/*.test.ts) listed under jest.projects` : ''}.`);
    }
  }
}

function checkQualityGates(actual, baseline, ctx, report) {
  const { base, app } = forComparison(actual, baseline, ctx);
  delete base.appProgram;
  for (const { path, message } of findWeaker(base, app)) {
    const form = ctx.prefixes.length > 0 && path.startsWith('jest.') ? ' (compared in its single-app form: workspace prefixes stripped)' : '';
    report.problem({ file: 'quality-gates.json', line: 1, rule: 'gate-weakened', message: `${path} ${message}${form}`, fix: GATE_FIX });
  }
  checkThresholdKeys(actual, baseline, ctx, report);
  if (ctx.layout.mode === 'monorepo') checkWorkspaceReach(actual, baseline, ctx, report);
  checkWorkspacePrograms(actual, baseline, ctx, report);
}

function hookCommands(settings, event) {
  return (settings.hooks?.[event] ?? []).flatMap((entry) => (entry.hooks ?? []).map((hook) => ({ matcher: entry.matcher ?? '', text: [hook.command ?? '', ...(hook.args ?? [])].join(' ') })));
}

function checkSettings(actual, report) {
  const baseline = readJson(join(SKILL, 'assets', 'claude-settings.json'));
  const problem = (message, fix) => report.problem({ file: '.claude/settings.json', line: 1, rule: 'claude-settings', message, fix });
  for (const kind of ['deny', 'ask']) {
    for (const rule of baseline.permissions[kind]) {
      if (!(actual.permissions?.[kind] ?? []).includes(rule)) problem(`permissions.${kind} lost "${rule}"`, `Put "${rule}" back into permissions.${kind} (and keep quality-gates.json claudeSettings equal).`);
    }
  }
  for (const rule of actual.permissions?.allow ?? []) {
    if (BYPASS_ALLOW.test(rule)) problem(`permissions.allow has "${rule}", which bypasses the git hooks`, 'Remove the rule; the hooks are the reviewer.');
  }
  if (actual.disableAllHooks === true) problem('disableAllHooks is true', 'Remove disableAllHooks; the PostToolUse and Stop hooks are gates.');
  const editHook = NODE_TARGET.exec(hookCommands(baseline, 'PostToolUse')[0]?.text ?? '')?.[1] ?? 'scripts/hooks/after-edit.ts';
  const post = hookCommands(actual, 'PostToolUse').find((hook) => /(^|\|)Edit(\||$)/.test(hook.matcher) && /(^|\|)Write(\||$)/.test(hook.matcher) && hook.text.includes(editHook));
  if (!post) problem(`no PostToolUse hook runs ${editHook} on Edit|Write`, 'Restore the PostToolUse entry from assets/claude-settings.json.');
  const stop = hookCommands(actual, 'Stop').find((hook) => hook.text.includes('check:fast') && /exit 2/.test(hook.text));
  if (!stop) problem('no Stop hook runs npm run -s check:fast and exits 2 on failure', 'Restore the Stop entry from assets/claude-settings.json.');
  if (post && stop) checkHookCommands(baseline, actual, problem);
}

/** Each baseline hook must be present byte for byte (trimmed), under the same matcher: `|| true` or a dropped `1>&2` defuses it. */
function checkHookCommands(baseline, actual, problem) {
  for (const event of ['PostToolUse', 'Stop']) {
    const present = hookCommands(actual, event);
    for (const { matcher, text } of hookCommands(baseline, event)) {
      if (present.some((hook) => hook.matcher === matcher && hook.text.trim() === text.trim())) continue;
      problem(`the ${event} hook${matcher ? ` (${matcher})` : ''} no longer runs exactly ${JSON.stringify(text)}`, `Restore the command from assets/claude-settings.json byte for byte; an appended "|| true" or a dropped "1>&2" lets a red gate pass silently (and keep quality-gates.json claudeSettings equal).`);
    }
  }
}

/** The git-ignored .claude/settings.local.json: Claude Code merges it, so it must not switch a gate off. */
function checkLocalSettings(root, report) {
  if (!existsSync(join(root, LOCAL_SETTINGS))) return;
  const local = tryJson(root, LOCAL_SETTINGS, 'claude-settings', report);
  if (local === null) return;
  const problem = (message, fix) => report.problem({ file: LOCAL_SETTINGS, line: 1, rule: 'claude-settings', message, fix });
  if (local.disableAllHooks === true) problem('disableAllHooks is true in the git-ignored local settings, so the edit and Stop hooks stop running on this machine', 'Remove disableAllHooks; a red hook is fixed, never switched off.');
  for (const rule of local.permissions?.allow ?? []) {
    if (BYPASS_ALLOW.test(rule)) problem(`permissions.allow has "${rule}", which bypasses the git hooks`, 'Remove the rule; the hooks are the reviewer.');
  }
}

/** A local lefthook-local.yml (usually git-ignored): lefthook merges it, so it must not switch off or redefine a gate hook. */
function checkLocalLefthook(root, report) {
  for (const rel of LOCAL_LEFTHOOK.filter((file) => existsSync(join(root, file)))) {
    readText(root, rel).split('\n').forEach((line, index) => {
      const problem = (message) => report.problem({ file: rel, line: index + 1, rule: 'lefthook', message, fix: `Delete the line (or the whole ${rel}); lefthook merges it into lefthook.yml on this machine only, where nobody reviews it.` });
      if (/^\s*(skip|only|exclude_tags|exclude)\s*:/.test(line)) problem(`"${line.trim()}" switches a gate job off on this machine`);
      else if (/^(pre-commit|commit-msg|pre-push)\s*:/.test(line)) problem(`"${line.trim()}" overrides a gate hook locally`);
      else if (/^assert_lefthook_installed\s*:\s*false/.test(line)) problem('assert_lefthook_installed: false hides uninstalled hooks');
    });
  }
}

/** The entries of every `exclude:` list in a lefthook.yml (inline or block form). */
function lefthookExcludes(text) {
  const entries = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const head = /^(\s*)exclude:\s*(.*)$/.exec(line);
    if (!head) return;
    if (head[2].trim() !== '') {
      entries.push(...head[2].replace(/^\[|\]$/g, '').split(',').map((item) => ({ value: item.trim().replace(/^['"]|['"]$/g, ''), line: index + 1 })));
      return;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const item = /^(\s*)-\s*(.*)$/.exec(lines[next]);
      if (!item || item[1].length <= head[1].length) break;
      entries.push({ value: item[2].trim().replace(/^['"]|['"]$/g, ''), line: next + 1 });
    }
  });
  return entries.filter((entry) => entry.value !== '');
}

function checkLefthook(root, report) {
  const text = readText(root, 'lefthook.yml');
  const lines = text.split('\n').map((line) => line.trim());
  const baselineText = readFileSync(join(TEMPLATES, 'lefthook.yml'), 'utf8');
  const wanted = baselineText.split('\n').map((line) => line.trim()).filter((line) => /^(- name:|run:|glob:|assert_lefthook_installed:|parallel:|pre-commit:|commit-msg:|pre-push:|- ')/.test(line));
  const allowedExcludes = new Set(lefthookExcludes(baselineText).map((entry) => entry.value));
  for (const line of wanted) {
    if (!lines.includes(line)) report.problem({ file: 'lefthook.yml', line: 1, rule: 'lefthook', message: `lost the line "${line}"`, fix: 'Restore lefthook.yml from this skill\'s template; the guardrail compares `lefthook dump` with quality-gates.json.' });
  }
  text.split('\n').forEach((line, index) => {
    if (/^\s*(skip|only|exclude_tags)\s*:/.test(line)) report.problem({ file: 'lefthook.yml', line: index + 1, rule: 'lefthook', message: `"${line.trim()}" switches a hook job off`, fix: 'Remove it; a hook that is skipped is a gate that no longer runs.' });
  });
  for (const entry of lefthookExcludes(text)) {
    if (!allowedExcludes.has(entry.value)) report.problem({ file: 'lefthook.yml', line: entry.line, rule: 'lefthook', message: `a job excludes "${entry.value}", which the baseline does not`, fix: 'Remove the exclude; fix what the job reports instead (only .env.example is excluded, from no-secrets).' });
  }
}

function checkNpmrc(root, baseline, report) {
  const lines = readText(root, '.npmrc').split('\n').map((line) => line.trim());
  for (const line of baseline.npmrcLines) {
    if (!lines.includes(line)) report.problem({ file: '.npmrc', line: 1, rule: 'npmrc', message: `lacks "${line}"`, fix: `Add the line "${line}" (the dependency policy the guardrail checks).` });
  }
}

function checkLinterOptions(root, report) {
  const eslint = readText(root, 'eslint.config.mjs');
  for (const pattern of LINTER_OPTIONS) {
    if (!pattern.test(eslint)) report.problem({ file: 'eslint.config.mjs', line: 1, rule: 'eslint-linter-options', message: `linterOptions lacks ${pattern.source.replace(/\\s\*/g, ' ').replace(/\\/g, '')}`, fix: 'Keep linterOptions { noInlineConfig: true, reportUnusedDisableDirectives: \'error\', reportUnusedInlineConfigs: \'error\' }.' });
  }
}

/** The path keys jest.config.js must name: the baseline's logic keys and every path key of the app's quality-gates.json (multi-package: the app's keys, which carry the workspace or package forms). */
function requiredThresholdKeys(baseline, gates, ctx) {
  const own = Object.keys(gates?.jest?.coverageThreshold ?? {}).filter((key) => key !== 'global');
  const base = Object.keys(baseline.jest.coverageThreshold).filter((key) => key !== 'global');
  if (ctx.layout.mode === 'monorepo' && own.length > 0) return own;
  return [...new Set([...base, ...own])];
}

function checkJestThresholds(root, baseline, gates, ctx, report) {
  const jest = readText(root, 'jest.config.js');
  const thresholds = baseline.jest.coverageThreshold;
  const logicKey = Object.keys(thresholds).find((key) => key !== 'global');
  const blocks = [
    { name: 'global', re: /global\s*:\s*\{([^}]*)\}/, floor: thresholds.global },
    { name: 'logic folders', re: /LOGIC\s*=\s*\{([^}]*)\}/, floor: thresholds[logicKey] },
  ];
  const code = maskComments(jest);
  for (const key of requiredThresholdKeys(baseline, gates, ctx)) {
    if (code.includes(`'${key}'`) || code.includes(`"${key}"`)) continue;
    report.problem({ file: 'jest.config.js', line: 1, rule: 'jest-thresholds', message: `the logic folder key "${key}" is gone, so its files fall back to the global floors`, fix: `Put "${key}" back into LOGIC_THRESHOLDS (unit-and-component-tests' config; a key joins once its folder has source files); quality-gates.json jest.coverageThreshold names it.` });
  }
  for (const block of blocks) {
    const match = block.re.exec(jest);
    for (const [key, floor] of Object.entries(block.floor)) {
      const value = match ? Number(new RegExp(`${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(match[1])?.[1]) : Number.NaN;
      if (!(value >= floor)) report.problem({ file: 'jest.config.js', line: match ? lineOf(jest, match.index) : 1, rule: 'jest-thresholds', message: `${block.name} ${key} threshold is ${Number.isNaN(value) ? 'missing' : value} (at least ${floor})`, fix: 'Restore the coverage thresholds; add tests for uncovered behaviour instead of lowering them.' });
    }
  }
}

/** From `start` (just after `key:`), the source of the value expression: up to a comma or closing bracket at depth 0. */
function valueExpression(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < code.length && code[i] !== ch; i += code[i] === '\\' ? 2 : 1);
    } else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return code.slice(start, i);
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

const normalise = (expression) => squash(expression).replace(/,(?=[)\]}])/g, '');

/** Every scope key's value (shorthand included) and every top-level constant those values use: { key, value, index, from } (from: the scope key's index). */
function jestScopeValues(source) {
  const code = maskComments(source);
  const constants = new Map();
  for (const match of code.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/gm)) constants.set(match[1], { value: normalise(valueExpression(code, match.index + match[0].length)), index: match.index });
  const values = [];
  const keys = JEST_SCOPE_KEYS.join('|');
  for (const match of code.matchAll(new RegExp(`(?<=[{,]\\s*)(${keys})\\s*(:|(?=\\s*[,}]))`, 'g'))) {
    const value = match[2] === ':' ? normalise(valueExpression(code, match.index + match[0].length)) : match[1];
    values.push({ key: match[1], value, index: match.index, from: match.index, family: match[1] });
    const strings = value.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, '');
    for (const ref of strings.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
      const constant = constants.get(ref[1]);
      if (constant && (ref[2] === undefined || ARRAY_METHODS.has(ref[2]))) values.push({ key: `const ${ref[1]}`, value: constant.value, index: constant.index, from: match.index, family: match[1] });
    }
  }
  return values;
}

/** The [start, end] source span of every object literal whose displayName is one of `names`. */
function projectSpans(source, names) {
  const code = maskComments(source);
  const opens = [];
  const pairs = [];
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "'" || ch === '"' || ch === '`') for (i += 1; i < code.length && code[i] !== ch; i += code[i] === '\\' ? 2 : 1);
    else if (ch === '{') opens.push(i);
    else if (ch === '}' && opens.length > 0) pairs.push([opens.pop(), i]);
  }
  const spans = [];
  for (const match of code.matchAll(/displayName\s*:\s*['"]([\w-]+)['"]/g)) {
    if (!names.includes(match[1])) continue;
    const inner = pairs.filter(([start, end]) => start < match.index && match.index < end).sort((a, b) => (b[0] - a[0]))[0];
    if (inner) spans.push(Object.assign([...inner], { name: match[1] }));
  }
  return spans;
}

const CANONICAL_PROJECTS = () => Object.keys(readJson(join(TEMPLATES, 'quality-gates.json')).jest.projects);

/** Test projects the app's quality-gates.json lists beyond the canonical ones (additions only: the canonical projects stay exact). */
function extraProjects(gates) {
  const canonical = CANONICAL_PROJECTS();
  return Object.keys(gates?.jest?.projects ?? {}).filter((name) => !canonical.includes(name));
}

/** Each canonical project keeps its displayName, so an added project cannot take a canonical one's place. */
function checkCanonicalProjects(source, report) {
  const code = maskComments(source);
  for (const name of CANONICAL_PROJECTS()) {
    if (new RegExp(`displayName\\s*:\\s*['"]${name}['"]`).test(code)) continue;
    report.problem({ file: 'jest.config.js', line: 1, rule: 'jest-scope', message: `no project has displayName '${name}', so the canonical ${name} tests no longer run as their own project`, fix: `Restore the ${name} project from unit-and-component-tests' canonical jest.config.js; a new project is added next to the canonical ones, never in place of one.` });
  }
}

const COVERAGE_FAMILY = new Set(['collectCoverageFrom']);
const TEST_FAMILY = new Set(['testMatch', 'testRegex', 'roots']);

/**
 * jest.config.js must reach exactly the files the canonical config reaches: an added "!" glob or ignore
 * pattern hides code or tests. Multi-package, each value is compared in its single-app form (workspace
 * prefixes stripped) and every workspace's src/ must stay reached. A project the app's quality-gates.json
 * adds (jest.projects) is the guardrail's to compare.
 */
function checkJestScope(root, gates, ctx, report) {
  const allowed = new Set(jestScopeValues(readFileSync(join(SKILL, 'assets', 'jest-config-baseline.js'), 'utf8')).map(({ key, value }) => `${key}\0${value}`));
  const source = readText(root, 'jest.config.js');
  checkCanonicalProjects(source, report);
  const spans = projectSpans(source, extraProjects(gates));
  const reached = { coverage: new Set(), tests: new Set() };
  const seen = new Set();
  const backendOf = new Map([...ctx.backendProjects].map(([dir, name]) => [name, dir]));
  for (const { key, value, index, from, family } of jestScopeValues(source)) {
    const span = spans.find(([start, end]) => start < from && from < end);
    if (span) {
      // A listed Node backend project reaches its own workspace's tests (the guardrail compares the rest).
      const dir = backendOf.get(span.name);
      if (dir !== undefined && TEST_FAMILY.has(family) && value.includes(`${dir}/src/`)) reached.tests.add(dir);
      continue;
    }
    const bucket = COVERAGE_FAMILY.has(family) ? reached.coverage : TEST_FAMILY.has(family) ? reached.tests : null;
    // Only a src/ root reaches a workspace's code: "<rootDir>/apps/*/plugins/**/" alone leaves apps/*/src untested.
    const form = singleAppForm(value, ctx.prefixes, (prefix, after) => {
      if (after.startsWith('src/')) prefix.covers.forEach((dir) => bucket?.add(dir));
    });
    if (allowed.has(`${key}\0${form}`) || seen.has(`${key}\0${value}`)) continue;
    seen.add(`${key}\0${value}`);
    report.problem({ file: 'jest.config.js', line: lineOf(source, index), rule: 'jest-scope', message: `${key} is ${value.length > 160 ? `${value.slice(0, 160)}...` : value}, which the canonical config does not have${ctx.prefixes.length > 0 ? ' (nor its workspace form)' : ''}: it changes which files coverage or the tests reach`, fix: 'Restore the value from unit-and-component-tests\' canonical jest.config.js (multi-package: the same value with a workspace prefix where src/ stood). A file leaves coverage only through its "// device-only: covered by <check>" marker; a failing or untested file is fixed or tested, never ignored; a new test project is added to quality-gates.json jest.projects in the same gate change.' });
  }
  for (const dir of ctx.sourceWorkspaces) {
    if (!reached.coverage.has(dir)) report.problem({ file: 'jest.config.js', line: 1, rule: 'jest-scope', message: `collectCoverageFrom does not reach the workspace ${dir} (it holds src/), so its code has no coverage floor`, fix: `Write the source glob in its workspace form ("<rootDir>/${workspaceGlob(dir)}/src/**/*.{ts,tsx}") so every workspace is covered.` });
    if (!reached.tests.has(dir)) report.problem({ file: 'jest.config.js', line: 1, rule: 'jest-scope', message: `no test root reaches the workspace ${dir} (it holds src/), so its tests never run`, fix: `Add "<rootDir>/${workspaceGlob(dir)}/src/**/" to TEST_ROOTS in place of "<rootDir>/src/**/"${ctx.backendProjects.has(dir) ? `, or give the Node backend a project of its own (displayName '${ctx.backendProjects.get(dir)}', testEnvironment 'node', testMatch ['<rootDir>/${dir}/src/**/*.test.ts']) listed in quality-gates.json jest.projects` : ''}.` });
  }
}

/** knip.json must ignore every agent folder that holds code: installed skills import packages the app never installs. */
function checkKnipScope(root, knip, report) {
  const ignored = new Set((Array.isArray(knip.ignore) ? knip.ignore : []).map(String));
  for (const folder of AGENT_SKILL_FOLDERS) {
    if (ignored.has(`${folder}/**`) || !existsSync(join(root, folder))) continue;
    const code = walk(join(root, folder), { include: CODE_FILES })[0];
    if (code === undefined) continue;
    report.problem({ file: 'knip.json', line: 1, rule: 'gate-scope', message: `"ignore" lacks "${folder}/**", so knip analyses the installed skills (${folder}/${code}) and check:unused fails on imports the app never installs`, fix: `Add "${folder}/**" to knip.json "ignore" with its reason in contracts/knip-ignores.json (the canonical list covers skills/** and every agent folder; typescript-and-lint-rules owns knip.json).` });
  }
}

function checkGateScope(root, settings, report) {
  const rel = 'scripts/quality/gated-paths.ts';
  if (existsSync(join(root, rel)) && !AGENT_EXCLUSION.test(readText(root, rel))) report.problem({ file: rel, line: 1, rule: 'gate-scope', message: 'isGatedFile no longer keeps wildcard patterns out of the agent folders, so editing an installed skill demands a Gate-Change trailer', fix: 'Restore scripts/quality/gated-paths.ts and its test from this skill\'s templates (AGENT_FOLDERS, isGatedFile).' });
  for (const rule of settings?.permissions?.ask ?? []) {
    if (/^Edit\(\*\*\//.test(rule)) report.problem({ file: '.claude/settings.json', line: 1, rule: 'gate-scope', message: `permissions.ask has ${rule}, which also prompts for matching files of installed skills`, fix: 'Anchor the rule at the repo root (Edit(/tsconfig*.json), Edit(/src/tsconfig.json)) in .claude/settings.json and quality-gates.json together.' });
  }
}

function checkGateScripts(root, files, report) {
  for (const rel of files) {
    if (!existsSync(join(root, rel))) continue;
    if (squash(readText(root, rel)) === squash(readFileSync(join(TEMPLATES, rel), 'utf8'))) continue;
    report.problem({ file: rel, line: 1, rule: 'gate-script-changed', message: 'differs from the template: the verify steps, the guardrail, the gated paths, the edit hook and the coverage policy are canonical', fix: `Restore it from this skill's templates/${rel}; a new verify step goes into quality-gates.json "verifyExtraSteps" instead, and any other change is a gate change.` });
  }
}

/** Every ignore list of knip.json (top level and per workspace): [{ path, keys, entries }]. */
function knipIgnoreLists(config) {
  const lists = [];
  const collect = (keys, block) => {
    for (const [key, value] of Object.entries(block ?? {})) {
      if (!/^ignore[A-Z]?/.test(key) || key === 'ignoreExportsUsedInFile') continue;
      if (Array.isArray(value)) lists.push({ keys: [...keys, key], entries: value.map(String) });
      else if (value !== null && typeof value === 'object') lists.push({ keys: [...keys, key], entries: Object.keys(value) });
    }
  };
  collect([], config);
  for (const [name, block] of Object.entries(config.workspaces ?? {})) collect(['workspaces', name], block);
  return lists;
}

function checkKnipIgnores(root, layout, knip, report) {
  const lists = knipIgnoreLists(knip).filter((list) => list.entries.length > 0);
  if (lists.length === 0) return;
  const rel = toPosix(join(layout.contractsDir, 'knip-ignores.json'));
  const reasons = existsSync(join(root, rel)) ? tryJson(root, rel, 'knip-ignores', report) : {};
  if (reasons === null) return;
  for (const { keys, entries } of lists) {
    const block = keys.reduce((value, key) => value?.[key], reasons) ?? {};
    for (const entry of entries) {
      const reason = block[entry];
      if (typeof reason === 'string' && reason.trim().length >= 10) continue;
      report.problem({ file: 'knip.json', line: 1, rule: 'knip-ignores', message: `${keys.join('.')} ignores "${entry}" with no written reason in ${rel}: knip no longer reports it`, fix: `Remove the entry and fix the finding (delete the dead code, add the missing dependency). A tool contract (a binary started by name, a package a root mock imports) stays only with the developer's agreement, its reason under ${keys.join('.')} in ${rel} and a Gate-Change: trailer.` });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: no package.json in ${root}, so this is not the repo root`, 'Pass the app\'s repo root (the folder with package.json) as the first argument.');
  const layout = resolveLayout(root);
  const report = createReporter({ name: 'check-gate-wiring', json: options.json });
  const ownTools = ownToolFiles();
  const present = new Set();
  let checked = 0;
  for (const rel of [...OWN_CONFIGS, ...ownTools]) {
    checked += 1;
    if (existsSync(join(root, rel))) present.add(rel);
    else report.problem({ file: rel, line: 0, rule: 'gate-file-missing', message: 'is missing', fix: `Copy it from this skill (${rel === '.claude/settings.json' ? 'merge assets/claude-settings.json' : `templates/${rel}`}).` });
  }
  for (const rel of [...OTHER_CONFIGS, 'scripts/quality/device-only.ts']) {
    checked += 1;
    const reason = notYetCreated(root, { file: rel, owner: OWNERS[rel] });
    if (reason) report.skip({ file: rel, rule: 'gate-file-missing', message: reason });
    else present.add(rel);
  }
  const pkg = tryJson(root, 'package.json', 'npm-script', report) ?? {};
  const prefixes = workspacePrefixes(layout, pkg);
  const appWorkspaces = layout.workspaces.map((workspace) => workspace.dir).filter((dir) => isExpoApp(root, dir));
  // Node backends (functions/) by folder, with the project name a Node-environment project of their own takes.
  const backendProjects = new Map(layout.mode === 'monorepo' ? backendWorkspaces(root).map((backend) => [backend.dir, basename(backend.dir)]) : []);
  const ctx = { root, layout, pkg, prefixes, appWorkspaces, backendProjects, sourceWorkspaces: workspacesWithSource(root, layout) };
  const scripts = baselineScripts(ctx);
  const baseline = baselineGates(scripts, ctx);
  checkScripts(root, layout, pkg, scripts, report);
  const gates = present.has('quality-gates.json') ? tryJson(root, 'quality-gates.json', 'gate-weakened', report) : null;
  const extraTargets = gates ? checkExtraSteps(pkg, gates, report) : [];
  checkTargets(root, [...canonicalTargets(scripts), ...extraTargets], new Set(ownTools), report);
  if (gates) checkQualityGates(gates, baseline, ctx, report);
  const settings = present.has('.claude/settings.json') ? tryJson(root, '.claude/settings.json', 'claude-settings', report) : null;
  if (settings) checkSettings(settings, report);
  checkLocalSettings(root, report);
  if (present.has('lefthook.yml')) checkLefthook(root, report);
  checkLocalLefthook(root, report);
  if (present.has('.npmrc')) checkNpmrc(root, baseline, report);
  if (present.has('eslint.config.mjs')) checkLinterOptions(root, report);
  if (present.has('jest.config.js')) checkJestThresholds(root, baseline, gates, ctx, report);
  if (present.has('jest.config.js')) checkJestScope(root, gates, ctx, report);
  checkGateScope(root, settings, report);
  checkGateScripts(root, [...ownTools, 'scripts/quality/device-only.ts'], report);
  const knip = present.has('knip.json') ? tryJson(root, 'knip.json', 'knip-ignores', report) : null;
  if (knip) checkKnipIgnores(root, layout, knip, report);
  if (knip) checkKnipScope(root, knip, report);
  return report.finish({ checked, unit: 'gate files' });
});
