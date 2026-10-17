#!/usr/bin/env node
// check-workflows.mjs: checks that every GitHub Actions workflow of an Expo app is pinned and
// hardened: actions pinned to full commit SHAs with a version comment, versioned runner images,
// read-only default permissions, no pull_request_target or workflow_run, checkout without persisted
// credentials, no untrusted ${{ }} expression inside a run script, secrets only in jobs behind an
// environment, concurrency and timeouts, no soft-failing step, no npm config override, the git hooks
// switched off only with LEFTHOOK=0, caches keyed on a lockfile and never restored next to a secret,
// and Dependabot keeping the action pins current with a 7-day cooldown.
// Usage: node check-workflows.mjs [repo-root] [--json]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, run, UsageError } from './check-lib.mjs';
import { parseYaml, YamlError } from './lib/workflow-yaml.mjs';
import {
  actionName,
  allEnvEntries,
  DEPENDABOT_FILE,
  entryOf,
  envValue,
  hasCi,
  jobCommands,
  readWorkflows,
  runExpressions,
  textOf,
  valueOf,
  withText,
  WORKFLOWS_DIR,
} from './lib/workflows.mjs';

const SPEC = {
  name: 'check-workflows',
  summary: 'Checks that the GitHub Actions workflows are pinned and hardened (SHA-pinned actions, versioned runners, least privilege, no injection, scoped secrets, concurrency, timeouts, no soft fails, keyed caches, Dependabot).',
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  yaml-syntax          a workflow or dependabot.yml that does not parse (anchors, tabs, bad indentation)',
    '  action-sha-pin       uses: is not owner/repo@<40-hex commit SHA> followed by a "# vX.Y.Z" comment (docker:// needs @sha256:)',
    '  runner-pinned        runs-on (or a matrix value it reads) is a moving *-latest label (macos-latest-xlarge included)',
    '  permissions-default  no top-level permissions:, or it grants write (contents: read or {} only)',
    '  no-pr-target         the workflow triggers on pull_request_target or workflow_run',
    '  persist-credentials  actions/checkout without persist-credentials: false',
    '  run-injection        a ${{ }} expression other than runner.*, vars.*, fixed github.* values or a literal matrix inside a run script (env.* too: pass the value through env: and read "$VALUE")',
    '  secret-environment   a job reads secrets.* (or secrets: inherit) without an environment:; a secret in the workflow-level env; secrets passed to a reusable workflow',
    '  concurrency          no concurrency group, or a release workflow (a job with an environment) cancels in progress',
    '  job-timeout          a job without timeout-minutes, or one above 180',
    '  soft-fail            continue-on-error, || true, || exit 0, set +e, any || fallback after npm ci / npm run / node / npx / eas that does not exit non-zero, or such a command piped (| tee) without pipefail',
    '  npm-config-env       an NPM_CONFIG_* / npm_config_* variable or npm config set (it beats the project .npmrc)',
    '  lefthook-off         a workflow that runs npm ci does not set LEFTHOOK: \'0\'',
    '  cache-key            actions/cache of node_modules, or a key without hashFiles(...)',
    '  release-no-cache     a job with an environment restores a cache (setup-node without package-manager-cache: false, actions/cache)',
    '  dependabot-actions   no .github/dependabot.yml entry for github-actions with cooldown default-days of 7 or more',
    'NOT APPLICABLE when the repo has neither .github/workflows/ nor .github/dependabot.yml.',
  ].join('\n'),
};

const SHA = /^[0-9a-f]{40}$/;
const VERSION_COMMENT = /^v?\d+(\.\d+){0,3}\b/;
/**
 * Contexts a run script may expand inline: fixed by the runner or the maintainers, never by a
 * contributor. Not env.* (it re-inlines whatever was put into the variable, an event field included)
 * and matrix.* only when the job's matrix is a literal in the file (see literalMatrix).
 */
const SAFE_EXPRESSION = /^(runner\.|vars\.|github\.(workspace|sha|run_id|run_number|run_attempt|repository|repository_owner|event_name|workflow|job|action_path|server_url|api_url)\b|hashFiles\(|always\(\)|success\(\)|failure\(\)|cancelled\(\))/;
const MAX_TIMEOUT = 180;
const SECRET_REF = /\bsecrets\.(?!GITHUB_TOKEN\b)[A-Za-z_]/;
/** A gate command whose failure an `||` fallback would swallow (npm ci, npm run/test, node, npx, eas, a repo script). */
const GATE_COMMAND = /^(npm\s+(ci|test|t|run|run-script|exec)\b|node\s|npx\s|eas\s|(bash|sh)\s+\.?\/?scripts\/|\.\/scripts\/)/;
/** A shell setting that makes a pipeline fail when any command in it fails (`shell: bash` is bash --noprofile --norc -eo pipefail {0}). */
const PIPEFAIL_SHELL = /^\s*bash\s*$|pipefail/;
const SET_PIPEFAIL = /(^|[;&\s])set\s+(-[a-z]*o\s+|-o\s+)pipefail\b/;
/** An `||` fallback that still fails the step. */
const FAILING_FALLBACK = /^\s*(\{\s*)?([^;&|]*;\s*)*(exit(\s+([1-9]\d*|"?\$\?"?))?|false|return\s+[1-9]\d*)\s*(;\s*\}|\})?\s*$/;

/** True when the job's strategy.matrix is written out in the file (no ${{ }} anywhere inside it). */
function literalMatrix(job) {
  const matrix = valueOf(valueOf(job.node, 'strategy'), 'matrix');
  return matrix?.type === 'map' && scalarsOf(matrix).every(({ value }) => !value.includes('${{'));
}

/** Every scalar value under a node: [{ value, line }]. */
function scalarsOf(node, out = []) {
  if (!node) return out;
  if (node.type === 'scalar') out.push({ value: node.value, line: node.line });
  else if (node.type === 'seq') node.items.forEach((item) => scalarsOf(item, out));
  else for (const entry of node.entries) scalarsOf(entry.value, out);
  return out;
}

const isTrue = (node) => node?.type === 'scalar' && !node.empty && node.value.trim() !== 'false';

function checkUses(report, rel, uses, node) {
  if (!uses || uses.startsWith('./')) return;
  if (uses.startsWith('docker://')) {
    if (!/@sha256:[0-9a-f]{64}$/.test(uses)) report.problem({ file: rel, line: node.line, rule: 'action-sha-pin', message: `${uses} is not pinned to an image digest`, fix: 'Write docker://<image>@sha256:<digest> (a tag can be repointed).' });
    return;
  }
  const [name, ref = ''] = uses.split('@');
  if (!SHA.test(ref)) {
    report.problem({ file: rel, line: node.line, rule: 'action-sha-pin', message: `${uses} is pinned to "${ref || 'nothing'}", not a full commit SHA`, fix: `Pin ${name} to the 40-character commit SHA of a release at least 7 days old, then add the release as a comment: uses: ${name}@<sha> # vX.Y.Z (a tag or branch can be moved to other code).` });
    return;
  }
  if (!node.comment || !VERSION_COMMENT.test(node.comment)) {
    report.problem({ file: rel, line: node.line, rule: 'action-sha-pin', message: `${name}@${ref.slice(0, 7)}… has no "# vX.Y.Z" comment naming its release`, fix: 'Add the release the SHA belongs to as a trailing comment (# v7.0.1) so a reviewer and Dependabot can read it.' });
  }
}

function checkPermissions(report, workflow) {
  const entry = workflow.permissions;
  if (!entry) {
    report.problem({ file: workflow.rel, line: workflow.onLine, rule: 'permissions-default', message: 'no top-level permissions: the GITHUB_TOKEN gets the repository default, which may be read-write', fix: 'Add permissions: { contents: read } at the top level, and widen one job at a time when it needs more.' });
    return;
  }
  const value = entry.value;
  if (value.type === 'scalar') {
    if (!value.empty && value.value !== 'read-all') report.problem({ file: workflow.rel, line: entry.line, rule: 'permissions-default', message: `permissions: ${value.value} grants write access to every job`, fix: 'Use permissions: { contents: read } (or {}).' });
    return;
  }
  if (value.type !== 'map') return;
  for (const scope of value.entries) {
    const level = textOf(scope.value);
    if (level !== 'read' && level !== 'none') report.problem({ file: workflow.rel, line: scope.line, rule: 'permissions-default', message: `top-level permissions grant ${scope.key}: ${level ?? '?'} to every job`, fix: `Keep the top level read-only (contents: read) and give ${scope.key}: write only to the job that needs it.` });
  }
}

function checkTriggers(report, workflow) {
  for (const trigger of workflow.triggers) {
    if (trigger.event === 'pull_request_target' || trigger.event === 'workflow_run') {
      report.problem({ file: workflow.rel, line: trigger.line, rule: 'no-pr-target', message: `${trigger.event} runs with the base repository's secrets and write token next to code or artifacts a fork controls`, fix: 'Use pull_request (no secrets, read-only token for forks); post results from a separate, manually started workflow.' });
    }
  }
}

function checkConcurrency(report, workflow) {
  const isRelease = workflow.jobs.some((job) => job.environment);
  const levels = [workflow.concurrency?.value, ...workflow.jobs.map((job) => job.concurrency)].filter(Boolean);
  if (!workflow.concurrency && !workflow.jobs.every((job) => job.concurrency)) {
    report.problem({ file: workflow.rel, line: workflow.onLine, rule: 'concurrency', message: 'no concurrency group: a new push leaves the older runs of the same branch running (or racing a release)', fix: 'Add concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true } (a release workflow: one group and cancel-in-progress: false).' });
    return;
  }
  if (!isRelease) return;
  for (const node of levels) {
    const cancel = valueOf(node, 'cancel-in-progress');
    if (cancel && textOf(cancel) !== 'false') report.problem({ file: workflow.rel, line: cancel.line, rule: 'concurrency', message: 'a release workflow cancels in progress: a second start would kill a build or upload halfway', fix: 'Set cancel-in-progress: false for a workflow whose jobs hold an environment (the second run waits instead).' });
  }
}

/** A secret in the workflow-level env reaches every job and step, same-repository pull request runs included. */
function checkWorkflowSecrets(report, workflow) {
  for (const { value, line } of scalarsOf(workflow.env)) {
    if (SECRET_REF.test(value)) report.problem({ file: workflow.rel, line, rule: 'secret-environment', message: 'the workflow-level env reads a secret: every job and every step of every run gets it, pull request runs from this repository included', fix: 'Move it to the step env of the one step that needs it, in the job that names environment: <name>.' });
  }
}

function checkJob(report, workflow, job) {
  const rel = workflow.rel;
  if (job.usesWorkflow) checkUses(report, rel, job.usesWorkflow, valueOf(job.node, 'uses'));
  for (const { label, line } of job.runners) {
    if (/(^|-)latest(-|$)/.test(label)) report.problem({ file: rel, line, rule: 'runner-pinned', message: `runs-on ${label} moves to a new image without a diff to review`, fix: `Name the image version (ubuntu-24.04, macos-26) and move it in its own change.` });
  }
  if (!job.usesWorkflow) {
    const minutes = job.timeout ? Number(textOf(job.timeout.value)) : Number.NaN;
    if (!job.timeout) report.problem({ file: rel, line: job.line, rule: 'job-timeout', message: `job ${job.id} has no timeout-minutes (the default is 360 minutes of a hung simulator)`, fix: 'Add timeout-minutes: about twice the job\'s normal duration (verify 30, a device lane 75 to 90).' });
    else if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_TIMEOUT) report.problem({ file: rel, line: job.timeout.line, rule: 'job-timeout', message: `job ${job.id} timeout-minutes is ${textOf(job.timeout.value) ?? '?'}`, fix: `Use a number from 1 to ${MAX_TIMEOUT}.` });
  }
  if (isTrue(job.continueOnError)) report.problem({ file: rel, line: job.continueOnError.line, rule: 'soft-fail', message: `job ${job.id} has continue-on-error: a red job shows green`, fix: 'Remove continue-on-error; fix the failure or remove the job.' });
  const secretRefs = scalarsOf(job.node).filter(({ value }) => SECRET_REF.test(value));
  const inherits = textOf(valueOf(job.node, 'secrets')) === 'inherit';
  if ((secretRefs.length > 0 || inherits) && job.usesWorkflow) {
    // A job that calls a reusable workflow cannot name environment:, so passing it a secret is never protected.
    const line = inherits ? entryOf(job.node, 'secrets').line : secretRefs[0].line;
    report.problem({ file: rel, line, rule: 'secret-environment', message: `job ${job.id} passes ${inherits ? 'every secret (secrets: inherit)' : 'a secret'} to the reusable workflow ${job.usesWorkflow}; a calling job cannot name environment:, so no reviewer or branch rule guards it`, fix: 'Pass no secrets: give the called workflow\'s job environment: <name> and keep the secret in that environment, where the job reads it directly.' });
  } else if ((secretRefs.length > 0 || inherits) && !job.environment) {
    const line = inherits ? entryOf(job.node, 'secrets').line : secretRefs[0].line;
    report.problem({ file: rel, line, rule: 'secret-environment', message: `job ${job.id} reads a secret without an environment:, so any branch and any workflow edit can reach it`, fix: 'Move the secret into a protected environment (Settings > Environments: required reviewers, deployment branches) and add environment: <name> to the job.' });
  }
  for (const step of job.steps) checkStep(report, workflow, job, step);
  if (job.environment) {
    for (const step of job.steps) {
      const name = actionName(step.uses);
      if (/^actions\/cache(\/restore)?$/.test(name)) report.problem({ file: rel, line: step.line, rule: 'release-no-cache', message: `job ${job.id} holds an environment's secrets and restores a cache any branch can write`, fix: 'Remove the cache step; a release job installs from the lockfile with npm ci, cold.' });
      if (name === 'actions/setup-node' && (withText(step, 'package-manager-cache') !== 'false' || withText(step, 'cache') !== null)) report.problem({ file: rel, line: step.line, rule: 'release-no-cache', message: `setup-node in job ${job.id} restores the npm cache next to a secret (cache poisoning)`, fix: 'Remove cache: and set package-manager-cache: false in a job with an environment.' });
    }
  }
}

function checkStep(report, workflow, job, step) {
  const rel = workflow.rel;
  checkUses(report, rel, step.uses, step.usesNode);
  const name = actionName(step.uses);
  if (name === 'actions/checkout' && withText(step, 'persist-credentials') !== 'false') {
    report.problem({ file: rel, line: step.line, rule: 'persist-credentials', message: 'actions/checkout leaves the GITHUB_TOKEN in .git/config for every later step', fix: 'Add with: { persist-credentials: false } (no step of this pipeline pushes).' });
  }
  if (/^actions\/cache(\/restore|\/save)?$/.test(name)) {
    const path = withText(step, 'path') ?? '';
    const key = withText(step, 'key') ?? '';
    if (/(^|\/|\s)node_modules\b/.test(path)) report.problem({ file: rel, line: step.line, rule: 'cache-key', message: 'node_modules is cached: npm ci deletes it first, and a restored copy built on another runner can carry stale native builds', fix: 'Cache npm\'s download cache instead (setup-node cache: npm) and run npm ci.' });
    if (!/hashFiles\(/.test(key)) report.problem({ file: rel, line: step.line, rule: 'cache-key', message: `cache key "${key || 'missing'}" is not derived from a pinned file`, fix: 'Key the cache on the file that pins its content: key: <name>-${{ runner.os }}-${{ hashFiles(\'package-lock.json\') }}.' });
  }
  if (isTrue(step.continueOnError)) report.problem({ file: rel, line: step.continueOnError.line, rule: 'soft-fail', message: `step ${step.name ?? step.index + 1} of job ${job.id} has continue-on-error`, fix: 'Remove continue-on-error; a gate that cannot fail is not a gate.' });
  if (step.run) {
    const shellPipefail = PIPEFAIL_SHELL.test(shellOf(workflow, job, step) ?? '');
    const lines = step.run.split('\n');
    lines.forEach((text, offset) => {
      const code = text.replace(/(^|\s)#.*$/, '$1');
      const pipefail = shellPipefail || lines.slice(0, offset).some((line) => SET_PIPEFAIL.test(line.replace(/(^|\s)#.*$/, '$1')));
      if (/\|\|\s*(true|:|exit\s+0)\b|\|\|\s*:\s*$|(^|[;&\s])set\s+\+e\b/.test(code)) report.problem({ file: rel, line: step.runLine + offset, rule: 'soft-fail', message: 'the command swallows its own failure', fix: 'Remove "|| true" / "|| exit 0" / "set +e"; let the step fail.' });
      else if (swallowedGate(code)) report.problem({ file: rel, line: step.runLine + offset, rule: 'soft-fail', message: `"${swallowedGate(code)}" is followed by an || fallback: the step can pass although the command failed`, fix: 'Remove the || fallback (or end it with exit 1); a gate command\'s own exit code decides the step.' });
      else if (!pipefail && pipedGate(code)) report.problem({ file: rel, line: step.runLine + offset, rule: 'soft-fail', message: `"${pipedGate(code)}" is piped into another command: GitHub's default shell (bash -e {0}) has no pipefail, so the step takes the exit code of the last command (tee) and a red gate shows green`, fix: 'Drop the pipe (the tools write their own reports under reports/), or name shell: bash on the step or in defaults.run (GitHub then runs bash -eo pipefail), or start the script with set -o pipefail.' });
      if (/\bnpm\s+config\s+set\b|\bnpm_config_\w+=/i.test(code)) report.problem({ file: rel, line: step.runLine + offset, rule: 'npm-config-env', message: 'the step changes npm config for the run', fix: 'Leave npm config to the committed .npmrc; a variable or npm config set beats it and check:deps fails it.' });
    });
    const matrixIsLiteral = literalMatrix(job);
    for (const { expr, line } of runExpressions(step)) {
      if (!SAFE_EXPRESSION.test(expr) && !(matrixIsLiteral && /^matrix\.[\w-]+$/.test(expr))) {
        const envName = /^env\.([A-Za-z_]\w*)$/.exec(expr)?.[1];
        const fix = envName ? `Write "$${envName}" in the script: the variable is already in the step's environment, and \${{ env.${envName} }} pastes its value into the script text instead.` : `Pass it through the step's env (env: { VALUE: \${{ ${expr} }} }) and use "$VALUE" in the script.`;
        report.problem({ file: rel, line, rule: 'run-injection', message: `\${{ ${expr} }} is pasted into the shell script before it runs (a crafted value runs as code; a secret lands in the script)`, fix });
      }
    }
  }
}

/**
 * The gate command on this line whose failure an `||` fallback swallows, or null: `npm run verify ||
 * echo failed` passes the step. A fallback that ends in exit 1 / exit / false still fails, so it is
 * accepted. Heuristic (one line at a time): checks.md lists what it cannot see.
 */
function swallowedGate(code) {
  const parts = code.split('||');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const left = parts[i].split(/&&|;|\|/).pop().trim().replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const fallback = parts.slice(i + 1).join('||');
    // A block that opens here ({ ... on the next lines) cannot be judged from one line: not flagged.
    if (GATE_COMMAND.test(`${left} `) && !/^\s*\{\s*$/.test(fallback) && !FAILING_FALLBACK.test(fallback)) return left;
  }
  return null;
}

/** The shell a step runs in: its own shell:, else the job's, else the workflow's defaults.run.shell (null: GitHub's default). */
function shellOf(workflow, job, step) {
  return textOf(valueOf(step.node, 'shell')) ?? textOf(valueOf(valueOf(valueOf(job.node, 'defaults'), 'run'), 'shell')) ?? textOf(valueOf(valueOf(valueOf(workflow.doc, 'defaults'), 'run'), 'shell'));
}

/**
 * The gate command on this line that is piped into another command (`npm run verify | tee log`), or
 * null: without pipefail the pipeline's status is the last command's. Quoted text is ignored.
 */
function pipedGate(code) {
  const unquoted = code.replace(/"[^"]*"|'[^']*'/g, '""');
  for (const segment of unquoted.split(/&&|\|\||;/)) {
    const parts = segment.split('|');
    if (parts.length < 2) continue;
    const left = parts[0].trim().replace(/^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    if (GATE_COMMAND.test(`${left} `)) return left;
  }
  return null;
}

function checkLefthook(report, workflow) {
  for (const job of workflow.jobs) {
    const install = jobCommands(job).find((command) => command.words[0] === 'npm' && (command.words[1] === 'ci' || command.words[1] === 'install' || command.words[1] === 'i') && !command.words.includes('-g') && !command.words.includes('--global'));
    if (!install) continue;
    const value = envValue(workflow, job, install.step, 'LEFTHOOK');
    if (!value || value.value !== '0') report.problem({ file: workflow.rel, line: value?.line ?? install.line, rule: 'lefthook-off', message: `job ${job.id} installs dependencies without LEFTHOOK: '0' (npm's prepare installs the git hooks on the runner)`, fix: 'Add env: { LEFTHOOK: \'0\' } at the top of the workflow (the one place quality-gates accepts it).' });
  }
}

function checkDependabot(report, root) {
  const rel = existsSync(join(root, DEPENDABOT_FILE)) ? DEPENDABOT_FILE : existsSync(join(root, '.github/dependabot.yaml')) ? '.github/dependabot.yaml' : null;
  if (!rel) {
    report.problem({ file: DEPENDABOT_FILE, line: 1, rule: 'dependabot-actions', message: 'no Dependabot config: the SHA-pinned actions never move to their security fixes', fix: 'Copy templates/dependabot.yml from this skill to .github/dependabot.yml (github-actions, weekly, cooldown default-days: 7).' });
    return 0;
  }
  let doc;
  try {
    doc = parseYaml(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    if (!(error instanceof YamlError)) throw error;
    report.problem({ file: rel, line: error.line, rule: 'yaml-syntax', message: error.message, fix: 'Write plain block YAML: spaces only, no anchors or tags.' });
    return 1;
  }
  const updates = valueOf(doc, 'updates');
  const entry = updates?.type === 'seq' ? updates.items.find((item) => textOf(valueOf(item, 'package-ecosystem')) === 'github-actions') : null;
  if (!entry) {
    report.problem({ file: rel, line: updates?.line ?? 1, rule: 'dependabot-actions', message: 'no updates entry for package-ecosystem: github-actions', fix: 'Add an updates entry: package-ecosystem: github-actions, directory: /, a weekly schedule and cooldown: { default-days: 7 }.' });
    return 1;
  }
  const days = Number(textOf(valueOf(valueOf(entry, 'cooldown'), 'default-days')));
  if (!Number.isFinite(days) || days < 7) report.problem({ file: rel, line: entry.line, rule: 'dependabot-actions', message: `github-actions updates have a cooldown of ${Number.isFinite(days) ? days : 'no'} days`, fix: 'Set cooldown: { default-days: 7 } (a release is proposed once it is a week old, like the npm release age).' });
  return 1;
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!hasCi(root)) return report.notApplicable(`no ${WORKFLOWS_DIR}/ folder and no ${DEPENDABOT_FILE}: this repo has no GitHub Actions CI`);
  const workflows = readWorkflows(root);
  if (workflows.length === 0 && existsSync(join(root, WORKFLOWS_DIR))) throw new UsageError(`nothing to check: ${WORKFLOWS_DIR}/ holds no .yml file`, 'Add a workflow (templates/workflows/ci.yml of this skill) or remove the empty folder.');
  for (const workflow of workflows) {
    if (workflow.error) {
      report.problem({ file: workflow.rel, line: workflow.error.line, rule: 'yaml-syntax', message: workflow.error.message, fix: 'Write plain block YAML: spaces only, no anchors, aliases or tags (GitHub reads them, this check does not, and a reviewer should not have to).' });
      continue;
    }
    checkTriggers(report, workflow);
    checkPermissions(report, workflow);
    checkConcurrency(report, workflow);
    checkLefthook(report, workflow);
    checkWorkflowSecrets(report, workflow);
    for (const entry of allEnvEntries(workflow)) {
      if (/^npm_config_/i.test(entry.key)) report.problem({ file: workflow.rel, line: entry.line, rule: 'npm-config-env', message: `${entry.key} beats the project .npmrc for every npm call of the run`, fix: 'Remove the variable; the committed .npmrc is the policy (check:deps fails an override).' });
    }
    for (const job of workflow.jobs) checkJob(report, workflow, job);
  }
  const checked = workflows.length + checkDependabot(report, root);
  return report.finish({ checked, unit: 'files' });
});
