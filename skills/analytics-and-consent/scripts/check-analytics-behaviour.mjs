#!/usr/bin/env node
// check-analytics-behaviour.mjs: runs the app's own analytics modules (the consent gate, the consent
// codec, the catalog sanitizer, the screen names, the build config and the store-declaration mapping)
// against scripted stand-ins: opt-in before any SDK, a no stops and forgets, off builds never create
// the SDK, the ATT answer reaches the adapter only in the tracking profile, nothing throws, nothing
// outside the catalog leaves, testing builds never reach the live project.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-analytics-behaviour.mjs [repo-root]

import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, requireFile, run } from './check-lib.mjs';
import { enableAppImports, errorText } from './lib/app-modules.mjs';
import { loadAnalyticsRepo } from './lib/analytics-repo.mjs';
import { SCENARIOS } from './lib/analytics-scenarios.mjs';

const SPEC = {
  name: 'check-analytics-behaviour',
  summary: "Runs the app's analytics gate, sanitizer, config and declaration mapping against scripted stand-ins.",
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details:
    'Rules: modules, ' + SCENARIOS.map(([rule]) => rule).join(', ') + '. NOT APPLICABLE when the app has ' +
    'no src/services/analytics/, no contracts/analytics.json and no analytics SDK in package.json (an SDK that ' +
    'starts itself is check-analytics\' sdk-inventory finding). A missing repo root or package.json exits 2.',
};

function modulePaths(repo) {
  const dir = repo.paths.analyticsDir;
  return {
    gate: `${dir}/create-analytics.ts`,
    consent: `${dir}/analytics-consent.ts`,
    events: `${dir}/analytics-events.ts`,
    sanitizer: `${dir}/analytics-sanitize.ts`,
    screen: `${dir}/screen-name.ts`,
    config: repo.paths.config,
    manifest: repo.paths.manifestScript,
  };
}

async function loadModules(repo, report) {
  const app = enableAppImports(repo.root, { aliases: repo.layout.aliases });
  const mods = {};
  for (const [key, rel] of Object.entries(modulePaths(repo))) {
    if (!app.exists(rel)) {
      report.problem({ file: rel, line: 1, rule: 'modules', message: 'missing, so its behaviour cannot be checked', fix: 'Copy the template at that path.' });
      continue;
    }
    try {
      mods[key] = await app.load(rel);
    } catch (error) {
      report.problem({ file: rel, line: 1, rule: 'modules', message: `does not load: ${errorText(error)}`, fix: 'Keep the module pure TypeScript (no React Native, Expo or vendor import) with erasable syntax only.' });
    }
  }
  return mods;
}

const GATE_MODULES = ['gate', 'consent', 'events', 'sanitizer'];
const NEEDS = { gate: GATE_MODULES, consent: GATE_MODULES, sanitizer: GATE_MODULES, screen: ['screen', 'sanitizer'] };

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  requireFile(join(root, 'package.json'), "the app's package.json (pass the app folder in a multi-package repo)");
  const repo = loadAnalyticsRepo(root, { srcDir: options['src-dir'] });
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!repo.present || repo.onlyAutoStart) {
    return report.notApplicable(repo.onlyAutoStart
      ? `no src/services/analytics/ and no contracts/analytics.json; ${repo.autoStart.join(', ')} starts itself (check-analytics reports it)`
      : 'no src/services/analytics/, no contracts/analytics.json and no analytics SDK in package.json');
  }
  const paths = modulePaths(repo);
  const mods = await loadModules(repo, report);
  let checked = 0;
  for (const [rule, key, scenario] of SCENARIOS) {
    const needs = NEEDS[key] ?? [key];
    if (!needs.every((name) => mods[name] !== undefined)) continue;
    if (rule === 'manifest-mapping' && !repo.contract?.value) {
      report.problem({ file: repo.paths.contract, line: 1, rule, message: 'no readable contract to map', fix: 'Copy templates/contracts/analytics.json and fill it.' });
      continue;
    }
    checked += 1;
    try {
      for (const message of await scenario(mods, repo.contract?.value)) {
        report.problem({ file: paths[key], line: 1, rule, message, fix: 'Restore the behaviour the template has (references/consent-gate.md explains each rule).' });
      }
    } catch (error) {
      report.problem({ file: paths[key], line: 1, rule, message: `the scenario crashed: ${errorText(error)}`, fix: 'Keep the exported API of the template.' });
    }
  }
  return report.finish({ checked, unit: 'scenarios' });
});
