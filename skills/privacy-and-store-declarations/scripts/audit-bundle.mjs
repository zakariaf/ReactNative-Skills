#!/usr/bin/env node
// audit-bundle.mjs: the shipped JavaScript of a release export, iOS and Android, attributed module by
// module through the source maps: first-party network code only inside the seams contracts/privacy.json
// allows, every third-party network capability owned by a declared SDK or in the reasoned baseline, and (production) no
// Google sample ad ID outside the ads SDK and no StoreKit test code.
// Run from the repo root after npm run export:audit:
//   node ${CLAUDE_SKILL_DIR}/scripts/audit-bundle.mjs [repo-root] [--export dist-audit] [--variant production]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createReporter, fail, maskComments, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { contractPath, FACTS, isVirtualModule, matchesAny, networkSeams, packageOf, readContract, sourceCandidates, urlSeams } from './lib/privacy-scan.mjs';

const SPEC = {
  name: 'audit-bundle',
  summary: 'Audits the JavaScript of a release export (expo export with source maps, iOS and Android): first-party network code only in the seams of contracts/privacy.json, every third-party network capability owned by a declared SDK or in the reasoned baseline, and no sample ad IDs or StoreKit test code in a production bundle.',
  usage: '[repo-root] [--export <dir>] [--baseline <file>] [--contract <file>] [--variant production|preview|development] [--json]',
  options: {
    export: { type: 'string', value: 'dir', help: 'Output folder of expo export (default: <repo-root>/dist-audit, what npm run export:audit writes)' },
    baseline: { type: 'string', value: 'file', help: 'Network baseline (default: <contractsDir>/network-baseline.json, its "js" section)' },
    contract: { type: 'string', value: 'file', help: 'Privacy contract (default: rn-skills.config.json "privacyContract", else contracts/privacy.json)' },
    variant: { type: 'string', default: 'production', value: 'variant', help: 'The APP_VARIANT the export was made with; production adds the release checks' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: first-party-network, baseline-new, baseline-reason, sample-id, storekit-test-code, contract.',
    'first-party-network: a module outside node_modules that can open a connection (fetch, XMLHttpRequest, WebSocket,',
    '  EventSource, sendBeacon, an expo-file-system transfer) outside the network seams, or holds a remote URL outside',
    '  the URL seams (<configDir> and "linkFiles"). Comments are masked first. Never baselined.',
    'baseline-new: a package finding neither covered by the "js" baseline nor owned by an SDK declared in',
    '  contracts/privacy.json "sdks" (a declared SDK is covered whatever it can do, and so are the packages it',
    '  installs: its dependencies and optional dependencies in node_modules, followed recursively; never its peers).',
    'STALE baseline entries (in the baseline, not found in any platform) are notes and do not fail.',
    'The test-only sentinel and debug screens are checked by app-variants-and-environment (check-variant-bundle).',
    'Make the export with: APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios',
    '  --platform android --source-maps --output-dir dist-audit (the export:audit script).',
  ].join('\n'),
};

const PATTERNS = Object.entries(FACTS.jsPatterns).map(([category, source]) => [category, new RegExp(source)]);

function readModules(exportDir) {
  const jsDir = join(exportDir, '_expo', 'static', 'js');
  if (!existsSync(jsDir)) fail(`no bundles in ${jsDir}`, 'Export first: npm run export:audit (expo export --platform ios --platform android --source-maps --output-dir dist-audit).');
  const modules = [];
  const maps = [];
  for (const platform of readdirSync(jsDir).sort()) {
    for (const file of readdirSync(join(jsDir, platform)).filter((name) => name.endsWith('.map')).sort()) {
      const rel = `_expo/static/js/${platform}/${file}`;
      let map;
      try {
        map = JSON.parse(readFileSync(join(jsDir, platform, file), 'utf8'));
      } catch (error) {
        fail(`${rel} is not JSON (${error.message})`, 'Export again.');
      }
      if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)) fail(`${rel} embeds no sourcesContent`, 'Export with --source-maps (the map must carry the sources to attribute them).');
      maps.push(rel);
      map.sources.forEach((source, index) => modules.push({ platform, map: rel, source, content: map.sourcesContent[index] ?? '' }));
    }
  }
  if (maps.length === 0) fail(`no source maps under ${jsDir}`, 'Export with --source-maps.');
  return { maps, modules };
}

function readBaseline(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`the baseline ${file} is not readable JSON (${error.message})`, "Copy the skill's templates/contracts/network-baseline.json.");
  }
  if (typeof data?.js !== 'object' || data.js === null) fail(`the baseline ${file} has no "js" section`, 'Keep { "js": { ... }, "native": { ... } }.');
  return data.js;
}

function firstPartyPath(source, appRoot, globs) {
  return sourceCandidates(source, appRoot).find((candidate) => matchesAny(candidate, globs)) ?? null;
}

function scan({ modules, root, seams, report }) {
  const findings = new Map();
  for (const { platform, map, source, content } of modules) {
    if (isVirtualModule(source)) continue;
    const owner = packageOf(source);
    // First-party sources are the app's own TypeScript: a doc comment that names fetch() is no request.
    const code = owner === null ? maskComments(content) : content;
    for (const [category, pattern] of PATTERNS) {
      if (!pattern.test(code)) continue;
      if (owner !== null) {
        const found = findings.get(owner) ?? { map, categories: new Set() };
        found.categories.add(category);
        findings.set(owner, found);
        continue;
      }
      if (firstPartyPath(source, root, category === 'remoteUrl' ? seams.urls : seams.network) !== null) continue;
      report.problem({ file: `${map} (${sourceCandidates(source, root)[0]})`, rule: 'first-party-network', message: `shipped first-party ${platform} module can ${category === 'remoteUrl' ? 'hold a remote URL' : `open a connection (${category})`} outside the ${category === 'remoteUrl' ? 'URL' : 'network'} seams`, fix: 'Move the request behind the ApiClient port (src/api), the URL into src/config or a linkFiles entry, or remove it. First-party findings are never baselined.' });
    }
  }
  return findings;
}

/** The package.json of `name` as Node resolves it from `fromDir` (its own node_modules first, then up to `root`). */
function installedManifest(root, fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const file = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(file)) {
      try {
        return { dir: dirname(file), manifest: JSON.parse(readFileSync(file, 'utf8')) };
      } catch {
        return null;
      }
    }
    if (resolve(dir) === resolve(root)) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Package name -> the declared SDK that installs it: every dependency and optional dependency of a
 * declared SDK, followed recursively through node_modules (peers are the app's own choice and are not
 * followed). Without node_modules nothing is added: only the declared names are covered.
 */
function sdkDependencyOwners(root, declared) {
  const owners = new Map();
  for (const sdk of declared) {
    const start = installedManifest(root, root, sdk);
    if (start === null) continue;
    const queue = [start];
    const seen = new Set([sdk]);
    while (queue.length > 0) {
      const { dir, manifest } = queue.shift();
      for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (!declared.has(dep) && !owners.has(dep)) owners.set(dep, sdk);
        const next = installedManifest(root, dir, dep);
        if (next !== null) queue.push(next);
      }
    }
  }
  return owners;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!['production', 'preview', 'development'].includes(options.variant)) fail(`--variant ${options.variant} is not production, preview or development`, 'Pass the APP_VARIANT the export was made with.');
  const layout = resolveLayout(root);
  const exportDir = requireDir(resolve(root, options.export ?? 'dist-audit'), 'export folder (npm run export:audit writes dist-audit)');
  const baselineFile = resolve(root, options.baseline ?? `${layout.contractsDir}/network-baseline.json`);
  if (!existsSync(baselineFile)) fail(`no network baseline at ${baselineFile}`, "Copy the skill's templates/contracts/network-baseline.json, or pass --baseline <file>.");
  const baseline = readBaseline(baselineFile);
  const contractRel = contractPath(layout, options.contract);
  const contractRead = readContract(root, contractRel);
  const report = createReporter({ name: 'audit-bundle', json: options.json });
  for (const problem of contractRead.problems) report.problem({ file: contractRel, rule: 'contract', message: problem.message, fix: problem.fix });
  const contract = contractRead.contract ?? { profile: 'api-port', networkModules: [], linkFiles: [], sdks: {} };
  const { modules } = readModules(exportDir);
  const seams = { network: networkSeams(contract, layout), urls: urlSeams(contract, layout) };
  const findings = scan({ modules, root, seams, report });
  for (const [owner, entry] of Object.entries(baseline)) {
    if (!Array.isArray(entry?.categories) || typeof entry?.reason !== 'string' || entry.reason.trim().length < 10) report.problem({ file: baselineFile, rule: 'baseline-reason', message: `js entry "${owner}" has no categories or no real reason`, fix: 'Every entry says what the package can do and why the app cannot reach it.' });
  }
  // A package the app uses to go online is a declared SDK: the declaration covers whatever it can do,
  // and the packages the SDK itself installs (@sentry/react-native brings @sentry/core and @sentry/browser).
  const declared = new Set(Object.keys(contract.sdks ?? {}));
  const owners = sdkDependencyOwners(root, declared);
  for (const [owner, { map, categories }] of [...findings].sort()) {
    if (declared.has(owner) || owners.has(owner)) continue;
    const extra = [...categories].filter((category) => !(baseline[owner]?.categories ?? []).includes(category));
    if (extra.length > 0) report.problem({ file: map, rule: 'baseline-new', message: `NEW ${owner}: ${extra.join(', ')} (not in the baseline)`, fix: 'Find out why the package can open a connection. If the app uses it to go online, declare it in contracts/privacy.json "sdks" (that covers its findings; references/sdk-inventory.md); if the app never reaches that code, add a baseline entry with the reason, a Gate-Change trailer and the reviewer\'s approval; otherwise remove the package.' });
  }
  for (const owner of Object.keys(baseline)) if (!findings.has(owner)) report.note(`NOTE STALE ${owner}: in the baseline but not found (delete the entry once the package has left)`);
  if (options.variant === 'production') {
    const storekit = new RegExp(FACTS.release.storekitTest);
    for (const { map, source, content } of modules) {
      if (isVirtualModule(source)) continue;
      const where = `${map} (${sourceCandidates(source, root)[0]})`;
      if (content.includes(FACTS.release.samplePublisher) && packageOf(source) !== FACTS.release.sampleAllowedPackage) report.problem({ file: where, rule: 'sample-id', message: "Google's sample ad publisher ID outside the ads SDK", fix: 'Production reads its own AdMob IDs (admob-ads-and-consent); sample IDs come only from the SDK\'s TestIds in testing variants. Never grep the raw bundle: the SDK\'s TestIds module ships in every bundle.' });
      if (storekit.test(content)) report.problem({ file: where, rule: 'storekit-test-code', message: 'StoreKit test code in the production bundle', fix: 'StoreKit testing lives in Xcode test plans and throwaway harness builds (in-app-purchases), never in app code.' });
    }
  }
  return report.finish({ checked: modules.length, unit: 'shipped modules' });
});
