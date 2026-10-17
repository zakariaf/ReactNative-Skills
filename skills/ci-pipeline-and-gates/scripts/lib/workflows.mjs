// workflows.mjs: reads a repo's GitHub Actions workflows into a small model both checkers share:
// each workflow's triggers, top-level env, permissions and concurrency, and each job's runner,
// environment, env, steps (uses/with/run/if/env with their lines) and the shell commands of its run
// steps. Also the repo facts the lanes need: package.json scripts, the Node pin file, the optional
// contracts/ci.json and the known owners of scripts other skills create.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError, toPosix } from '../check-lib.mjs';
import { YamlError, entryOf, parseYaml, textOf, toJs, valueOf } from './workflow-yaml.mjs';

export const WORKFLOWS_DIR = '.github/workflows';
export const DEPENDABOT_FILE = '.github/dependabot.yml';
export const CI_CONTRACT = 'contracts/ci.json';
export const NODE_PIN_FILES = ['.nvmrc', '.node-version', '.tool-versions', 'mise.toml', '.mise.toml'];

/** The device lanes: the npm script that defines each, the runner family it needs, the owner skill. */
export const LANES = Object.freeze({
  'android-build': { script: 'build:android:emu', os: 'linux', owner: 'android-emulator-build' },
  'android-e2e': { script: 'e2e:android', os: 'linux', owner: 'e2e-maestro' },
  'ios-build': { script: 'build:ios:sim', os: 'macos', owner: 'ios-simulator-build' },
  'ios-e2e': { script: 'e2e:ios', os: 'macos', owner: 'e2e-maestro' },
});

/** Scripts and files other skills create; a workflow may call them before they exist (SKIP). */
export const SCRIPT_OWNERS = Object.freeze({
  verify: 'quality-gates',
  'check:fast': 'quality-gates',
  'build:ios:sim': 'ios-simulator-build',
  'build:android:emu': 'android-emulator-build',
  'e2e:ios': 'e2e-maestro',
  'e2e:android': 'e2e-maestro',
  'screenshots:ios': 'e2e-maestro',
  'screenshots:android': 'e2e-maestro',
});
export const FILE_OWNERS = Object.freeze([
  ['scripts/eas/', 'eas-build-and-submit'],
  ['scripts/e2e/', 'e2e-maestro'],
  ['scripts/build/build-ios-sim', 'ios-simulator-build'],
  ['scripts/build/build-android-emu', 'android-emulator-build'],
  ['scripts/quality/', 'quality-gates'],
]);

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${error.message}`, `Fix the JSON syntax of ${what}.`);
  }
};

/** A folder as the workflows name it (`./apps/mobile/` -> `apps/mobile`, `` / `.` -> `.`). */
const normDir = (dir) => toPosix(dir ?? '.').replace(/^\.\//, '').replace(/\/+$/, '') || '.';

/**
 * Repo facts: the app's package.json scripts (root, or --app-dir: which lanes the app has), the
 * scripts of any package a command names (scriptsIn), the Node pin file, contracts/ci.json.
 */
export function readRepoFacts(root, { appDir = '.' } = {}) {
  const manifestPath = join(root, appDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new UsageError(`nothing to check: ${toPosix(join(appDir, 'package.json'))} not found`, 'Pass the repo root (the folder holding package.json and .github/) as the first argument, or --app-dir for the app inside a monorepo.');
  }
  const scriptsOf = (manifest) => (manifest?.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {});
  const cache = new Map();
  /** The scripts of <dir>/package.json (null: the repo root), or null when that package.json does not exist. */
  const scriptsIn = (dir) => {
    const key = normDir(dir);
    if (!cache.has(key)) {
      const path = join(root, key, 'package.json');
      cache.set(key, existsSync(path) ? scriptsOf(readJson(path, toPosix(join(key, 'package.json')))) : null);
    }
    return cache.get(key);
  };
  const contractPath = join(root, CI_CONTRACT);
  return {
    appDir: normDir(appDir),
    scripts: scriptsIn(appDir),
    scriptsIn,
    nodePin: NODE_PIN_FILES.find((file) => existsSync(join(root, file))) ?? null,
    contract: existsSync(contractPath) ? readJson(contractPath, CI_CONTRACT) : null,
    hasFile: (rel) => existsSync(join(root, rel)),
    readText: (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null),
  };
}

/** True when the repo has GitHub Actions CI (the workflows folder or dependabot.yml). */
export function hasCi(root) {
  return existsSync(join(root, WORKFLOWS_DIR)) || existsSync(join(root, DEPENDABOT_FILE));
}

// ---------------------------------------------------------------------------------------------
// Shell commands inside run steps
// ---------------------------------------------------------------------------------------------

/**
 * The commands of a run script: continuation lines joined, shell comments dropped, split on
 * ; && || | and newlines. Each: { text, line } (line = the 1-based file line it starts on).
 */
export function shellCommands(run, firstLine) {
  const out = [];
  const lines = run.split('\n');
  let pending = null;
  lines.forEach((raw, index) => {
    const code = raw.replace(/(^|\s)#.*$/, '$1');
    const start = pending ?? { text: '', line: firstLine + index };
    start.text += `${code.replace(/\\\s*$/, '')} `;
    if (/\\\s*$/.test(code)) {
      pending = start;
      return;
    }
    pending = null;
    for (const part of splitCommand(start.text)) if (part.trim() !== '') out.push({ text: part.trim(), line: start.line });
  });
  if (pending) out.push({ text: pending.text.trim(), line: pending.line });
  return out;
}

function splitCommand(text) {
  const parts = [];
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(current, two);
      current = '';
      i += 1;
    } else if (ch === ';' || ch === '|') {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.filter((part) => part !== '&&' && part !== '||');
}

/** The words of one command with leading VAR=value assignments and `env` removed. */
export function commandWords(text) {
  const words = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || words[i] === 'env' || words[i] === 'sudo' || words[i] === 'time')) i += 1;
  return words.slice(i).map((word) => word.replace(/^["']|["']$/g, ''));
}

const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
/** npm flags whose value is the next word: never the script name. */
const NPM_DIR_FLAGS = new Set(['-w', '--workspace', '--prefix', '-C']);

/**
 * `npm [flags] run [flags] X [flags] [-- args]`: { script, dir }, where dir is the package folder a
 * --workspace / -w / --prefix / -C flag names (either side of the script name), or null for the
 * folder npm runs in. Null when the command is not npm run.
 */
export function npmRunTarget(words) {
  if (words[0] !== 'npm') return null;
  let dir = null;
  let script = null;
  let sawRun = false;
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (word === '--') break;
    const inline = /^(--workspace|--prefix|-w|-C)=(.+)$/.exec(word);
    if (inline) dir = inline[2];
    else if (NPM_DIR_FLAGS.has(word)) {
      dir = words[i + 1] ?? null;
      i += 1;
    } else if (word.startsWith('-')) continue;
    else if (!sawRun) {
      if (!NPM_RUN.has(word)) return null;
      sawRun = true;
    } else if (script === null) script = word;
  }
  return sawRun && script ? { script, dir: dir === null ? null : normDir(dir) } : null;
}

/** `npm run X` / `npm run-script X` / `npm run -s X` / `npm run -w apps/x X`: the script name, or null. */
export function npmRunScript(words) {
  return npmRunTarget(words)?.script ?? null;
}

// ---------------------------------------------------------------------------------------------
// The workflow model
// ---------------------------------------------------------------------------------------------

function triggersOf(on) {
  if (!on) return [];
  if (on.type === 'scalar') return on.empty ? [] : [{ event: on.value, line: on.line, node: null }];
  if (on.type === 'seq') return on.items.map((item) => ({ event: textOf(item) ?? '', line: item.line, node: null }));
  return on.entries.map((entry) => ({ event: entry.key, line: entry.line, node: entry.value }));
}

function stepModel(node, index) {
  const run = valueOf(node, 'run');
  return {
    node,
    index,
    line: node.line,
    name: textOf(valueOf(node, 'name')),
    uses: textOf(valueOf(node, 'uses')),
    usesNode: valueOf(node, 'uses'),
    with: valueOf(node, 'with'),
    env: valueOf(node, 'env'),
    if: textOf(valueOf(node, 'if')),
    run: textOf(run),
    runLine: run ? (run.block ? run.bodyLine : run.line) : null,
    commands: run && textOf(run) ? shellCommands(textOf(run), run.block ? run.bodyLine : run.line) : [],
    continueOnError: valueOf(node, 'continue-on-error'),
  };
}

function runnersOf(runsOn, strategy) {
  const labels = [];
  const add = (node) => {
    if (!node) return;
    if (node.type === 'scalar') labels.push({ label: node.value, line: node.line });
    else if (node.type === 'seq') node.items.forEach(add);
    else if (node.type === 'map') add(valueOf(node, 'labels'));
  };
  add(runsOn);
  const resolved = [];
  for (const { label, line } of labels) {
    const m = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(label);
    if (!m) {
      resolved.push({ label, line });
      continue;
    }
    const values = valueOf(valueOf(strategy, 'matrix'), m[1]);
    if (values?.type === 'seq') for (const item of values.items) resolved.push({ label: textOf(item) ?? '', line: item.line });
    else resolved.push({ label, line });
  }
  return resolved;
}

function jobModel(entry) {
  const node = entry.value;
  const steps = valueOf(node, 'steps');
  return {
    id: entry.key,
    node,
    line: entry.line,
    runsOn: valueOf(node, 'runs-on'),
    runners: runnersOf(valueOf(node, 'runs-on'), valueOf(node, 'strategy')),
    environment: entryOf(node, 'environment'),
    env: valueOf(node, 'env'),
    permissions: entryOf(node, 'permissions'),
    concurrency: valueOf(node, 'concurrency'),
    timeout: entryOf(node, 'timeout-minutes'),
    if: textOf(valueOf(node, 'if')),
    usesWorkflow: textOf(valueOf(node, 'uses')),
    continueOnError: valueOf(node, 'continue-on-error'),
    steps: steps?.type === 'seq' ? steps.items.map(stepModel) : [],
  };
}

/** One parsed workflow file, or { error } when it does not parse. */
export function readWorkflow(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  try {
    const doc = parseYaml(text);
    if (doc.type !== 'map') throw new YamlError('a workflow is a mapping (name:, on:, jobs:)', doc.line);
    const jobs = valueOf(doc, 'jobs');
    return {
      rel,
      text,
      doc,
      name: textOf(valueOf(doc, 'name')),
      triggers: triggersOf(valueOf(doc, 'on') ?? valueOf(doc, 'true')),
      onLine: entryOf(doc, 'on')?.line ?? 1,
      env: valueOf(doc, 'env'),
      permissions: entryOf(doc, 'permissions'),
      concurrency: entryOf(doc, 'concurrency'),
      jobs: jobs?.type === 'map' ? jobs.entries.map(jobModel) : [],
    };
  } catch (error) {
    if (error instanceof YamlError) return { rel, text, error };
    throw error;
  }
}

/** Every *.yml / *.yaml file directly in .github/workflows (sorted), parsed. */
export function readWorkflows(root) {
  const dir = join(root, WORKFLOWS_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => readWorkflow(root, `${WORKFLOWS_DIR}/${name}`));
}

/** The events of a workflow, as a Set of names. */
export const eventsOf = (workflow) => new Set(workflow.triggers.map((trigger) => trigger.event));

/** Events that run code or context from someone who is not a maintainer. */
export const UNTRUSTED_EVENTS = new Set(['pull_request', 'pull_request_target', 'workflow_run', 'issue_comment', 'pull_request_review', 'pull_request_review_comment', 'discussion', 'discussion_comment', 'issues']);

/** The value of an env key in a step, else its job, else the workflow: { value, line } or null. */
export function envValue(workflow, job, step, key) {
  for (const node of [step?.env, job?.env, workflow?.env]) {
    const entry = entryOf(node, key);
    if (entry) return { value: textOf(entry.value) ?? '', line: entry.line };
  }
  return null;
}

/** Every env entry of a workflow at any level: [{ key, value, line }]. */
export function allEnvEntries(workflow) {
  const out = [];
  const add = (node) => {
    if (node?.type === 'map') for (const entry of node.entries) out.push({ key: entry.key, value: textOf(entry.value) ?? '', line: entry.line });
  };
  add(workflow.env);
  for (const job of workflow.jobs) {
    add(job.env);
    for (const step of job.steps) add(step.env);
  }
  return out;
}

/** The action name of a `uses:` (owner/repo[/path]) without the ref, lower case. */
export const actionName = (uses) => (uses ?? '').split('@')[0].toLowerCase();

/** A step's `with:` value of `key` as text, or null. */
export const withText = (step, key) => textOf(valueOf(step.with, key));

/** Every command of a job, with its step: [{ step, text, words, line }]. */
export function jobCommands(job) {
  const out = [];
  for (const step of job.steps) for (const command of step.commands) out.push({ step, text: command.text, words: commandWords(command.text), line: command.line });
  return out;
}

/** The npm scripts a job runs, in order: [{ script, line, step }]. */
export function jobScripts(job) {
  return jobCommands(job)
    .map((command) => ({ script: npmRunScript(command.words), line: command.line, step: command.step }))
    .filter((item) => item.script !== null);
}

/** Lines of `${{ ... }}` expressions inside a run script: [{ expr, line }]. */
export function runExpressions(step) {
  if (!step.run) return [];
  const out = [];
  step.run.split('\n').forEach((text, index) => {
    for (const m of text.matchAll(/\$\{\{\s*([\s\S]*?)\s*\}\}/g)) out.push({ expr: m[1], line: step.runLine + index });
  });
  return out;
}

export { entryOf, textOf, toJs, valueOf };
