// write-well-known.mjs: writes the apple-app-site-association and assetlinks.json of every verified
// host from contracts/deep-links.json and the app config of each variant (bundle ids, packages):
// <wellKnownDir>/<host>/apple-app-site-association and <wellKnownDir>/<host>/assetlinks.json, to be
// served at https://<host>/.well-known/ over HTTPS with no redirect (application/json). With --check
// it writes nothing and fails when a file is missing or out of date. Zero dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { UsageError, createReporter, parseArgs, requireDir, requireFile, resolveLayout, run } from './check-lib.mjs';
import { VARIANTS, evaluateAllVariants, expectedWellKnown, findAppConfig, linkPaths, printWidthOf, readContract, sameJson, wellKnownText } from './lib/link-facts.mjs';

const SPEC = {
  name: 'write-well-known',
  summary: 'Writes (or with --check verifies) the apple-app-site-association and assetlinks.json of every verified host in contracts/deep-links.json.',
  usage: '[repo-root] [options]',
  options: {
    check: { type: 'boolean', help: 'Write nothing; fail when a file is missing or differs (CI)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (with --check):',
    '  well-known-drift   a host file is missing or differs from the contract and the app config',
    '',
    'Each host gets one folder (a wildcard host *.example.com is served from example.com). The AASA lists',
    '<appleTeamId>.<ios.bundleIdentifier> of every variant using the host and one component per webPaths',
    'entry; assetlinks.json lists android.package and androidCertFingerprints of each such variant.',
    'Files are written the way Prettier prints JSON (printWidth from .prettierrc.json) and compared as JSON.',
    'Exit 2 when the contract is missing or invalid, or when no variant has hosts.',
    'Example: node write-well-known.mjs . --check',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  requireFile(join(root, 'package.json'), 'package.json (the app root)');
  const paths = linkPaths(resolveLayout(root));
  const contract = readContract(root, paths.contract);
  if (!contract.exists) throw new UsageError(`nothing to write: ${paths.contract} does not exist`, 'Copy templates/contracts/deep-links.json and list the verified hosts.');
  if (contract.error) throw new UsageError(`${paths.contract} is not valid JSON: ${contract.error}`, 'Fix the JSON.');
  const data = contract.data;
  if (!VARIANTS.some((variant) => (data?.hosts?.[variant] ?? []).length > 0)) throw new UsageError(`nothing to write: ${paths.contract} lists no hosts`, 'Add the verified hosts per variant first.');
  if (!/^[A-Z0-9]{10}$/.test(String(data.appleTeamId ?? ''))) throw new UsageError(`${paths.contract} has no valid appleTeamId`, 'Set the 10-character Apple Team ID (check-deep-links rule link-contract).');
  const configRel = findAppConfig(root);
  if (configRel === null) throw new UsageError('no app config (app.config.ts or app.json) at the repo root', 'Run it from the app root.');
  const expected = expectedWellKnown(data, evaluateAllVariants(root, configRel));
  const report = createReporter({ name: 'write-well-known', json: options.json });
  const width = printWidthOf(root);
  for (const [rel, value] of expected) {
    const path = join(root, rel);
    let current = null;
    try {
      current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    } catch {
      current = null;
    }
    if (current !== null && sameJson(current, value)) continue;
    if (options.check) {
      report.problem({ file: rel, line: current === null ? 0 : 1, rule: 'well-known-drift', message: current === null ? 'missing or not JSON' : 'differs from the contract and the app config', fix: 'Run node <skill>/scripts/write-well-known.mjs . and deploy the files.' });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, wellKnownText(value, width));
    report.note(`wrote ${rel}`);
  }
  if (!options.check) report.note(`deploy each folder of ${data.wellKnownDir ?? 'well-known'}/ to https://<host>/.well-known/ (HTTPS, no redirect, application/json)`);
  return report.finish({ checked: expected.size, unit: 'files' });
});
