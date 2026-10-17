// ota-code-rules.mjs: the rules check-ota reads from code rather than config (a helper, not an
// entry point): the fingerprint config, loaded and exercised the way @expo/fingerprint uses it, and
// the expo-updates adapter of the UpdatesPort.
//
//   checkFingerprintConfig(ctx)   fingerprint-scripts
//   checkAdapter(ctx)             updates-adapter, adapter-enabled-guard, emergency-launch
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';

import { maskComments, walkRepo } from '../check-lib.mjs';

/** Scripts that npm or EAS Build run by themselves: they can change native output. */
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'preprepare', 'prepare', 'postprepare', 'eas-build-pre-install', 'eas-build-post-install', 'eas-build-on-success'];
const SAMPLE_SCRIPTS = Object.fromEntries([...LIFECYCLE.map((name) => [name, `run ${name}`]), ['lint', 'eslint .'], ['start', 'expo start']]);
const PACKAGE_JSON_SCRIPTS_ALL = 1024;
const require = createRequire(import.meta.url);

function skipsAllScripts(sourceSkips) {
  if (typeof sourceSkips === 'number') return (sourceSkips & PACKAGE_JSON_SCRIPTS_ALL) !== 0;
  return Array.isArray(sourceSkips) && sourceSkips.includes('PackageJsonScriptsAll');
}

/** The scripts the hook keeps from SAMPLE_SCRIPTS, or an error text. */
function hashedScripts(config) {
  if (typeof config.fileHookTransform !== 'function') return { error: 'has no fileHookTransform, so every package.json script is hashed' };
  try {
    const out = config.fileHookTransform({ type: 'contents', id: 'packageJson:scripts' }, JSON.stringify(SAMPLE_SCRIPTS), true, 'utf8');
    return { kept: Object.keys(JSON.parse(String(out))) };
  } catch (error) {
    return { error: `fileHookTransform threw on package.json scripts (${error?.message ?? error})` };
  }
}

function fingerprintProblem(config) {
  if (config === null || typeof config !== 'object') return 'does not export a config object';
  if (skipsAllScripts(config.sourceSkips)) return 'skips every package.json script (PackageJsonScriptsAll): a postinstall that patches native code no longer changes the runtime version';
  const result = hashedScripts(config);
  if (result.error) return result.error;
  const lost = LIFECYCLE.filter((name) => !result.kept.includes(name));
  if (lost.length > 0) return `drops the lifecycle scripts ${lost.join(', ')} from the hash: they run during install or build and can change native output`;
  if (result.kept.includes('lint') || result.kept.includes('start')) return 'keeps scripts like "lint" in the hash: editing one gives every binary a new runtime version and strands the next update';
  return null;
}

export function checkFingerprintConfig(ctx) {
  const rel = ['fingerprint.config.js', 'fingerprint.config.cjs'].map(ctx.rel).find((candidate) => existsSync(join(ctx.root, candidate)));
  const fix = 'Copy templates/fingerprint.config.js (lifecycle scripts kept, version fields skipped) with scripts/ota/fingerprint-config.test.ts.';
  if (!rel) {
    ctx.report.problem({ file: ctx.rel('fingerprint.config.js'), line: 0, rule: 'fingerprint-scripts', message: 'no fingerprint.config.js: every package.json script is hashed, so a lint script edit strands the next update', fix });
    return;
  }
  let config;
  try {
    config = require(join(ctx.root, rel));
  } catch (error) {
    ctx.report.problem({ file: rel, line: 1, rule: 'fingerprint-scripts', message: `does not load (${error?.message ?? error}); @expo/fingerprint then silently uses its defaults`, fix });
    return;
  }
  const problem = fingerprintProblem(config?.default ?? config);
  if (problem) ctx.report.problem({ file: rel, line: 1, rule: 'fingerprint-scripts', message: problem, fix });
}

const IMPORT = /\bfrom\s*['"]expo-updates['"]|\brequire\(\s*['"]expo-updates['"]\s*\)|\bimport\(\s*['"]expo-updates['"]\s*\)/;
const UPDATER_CALL = /\b(checkForUpdateAsync|fetchUpdateAsync|reloadAsync)\s*\(/;
const NETWORK_CALL = /\b(checkForUpdateAsync|fetchUpdateAsync)\s*\(/;
const DEV_CLIENT_CODE = 'ERR_NOT_AVAILABLE_IN_DEV_CLIENT';
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
/** Reads `name` from the module: Updates.name, or a named import { name } from expo-updates. */
const reads = (code, name) =>
  new RegExp(`\\.${name}\\b`).test(code) || new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]expo-updates['"]`).test(code);

export function checkAdapter(ctx) {
  const srcDir = posix.join(ctx.appRel, ctx.layout.srcDir);
  if (!existsSync(join(ctx.root, srcDir))) return;
  const files = walkRepo(ctx.root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'] }).filter(
    (rel) => rel.startsWith(`${srcDir}/`) && !/\.(test|spec)\.[jt]sx?$/.test(rel) && !rel.includes('/__mocks__/'),
  );
  const importers = files
    .map((rel) => ({ rel, code: maskComments(readFileSync(join(ctx.root, rel), 'utf8')) }))
    .filter(({ code }) => IMPORT.test(code));
  const servicesRel = posix.join(ctx.appRel, ctx.layout.servicesDir);
  const adapterRel = posix.join(servicesRel, 'updates', 'expo-updates-adapter.ts');
  const isAdapter = (rel) => rel.startsWith(`${servicesRel}/`) && /^[^/]+\/[^/]+-adapter\.[jt]sx?$/.test(rel.slice(servicesRel.length + 1));
  for (const { rel, code } of importers.filter((importer) => !isAdapter(importer.rel))) {
    ctx.report.problem({ file: rel, line: lineAt(code, IMPORT.exec(code).index), rule: 'updates-adapter', message: 'imports expo-updates outside an adapter: the app then depends on the native updater directly, which Expo Go, development builds and tests cannot run, and skips the isEnabled guard', fix: `Reach updates through the UpdatesPort (the update checker, useUpdateStatus); only ${adapterRel} imports expo-updates.` });
  }
  if (!importers.some((importer) => isAdapter(importer.rel))) {
    ctx.report.problem({ file: adapterRel, line: 0, rule: 'updates-adapter', message: 'no adapter imports expo-updates: the app has no UpdatesPort, so nothing checks on return to the foreground or reports an emergency launch', fix: 'Copy templates/src/services/updates/ (port, adapter, fake, checker, tests) and create the adapter in the composition root.' });
    return;
  }
  for (const { rel, code } of importers) {
    const call = UPDATER_CALL.exec(code);
    if (call && !reads(code, 'isEnabled')) {
      ctx.report.problem({ file: rel, line: lineAt(code, call.index), rule: 'adapter-enabled-guard', message: `${call[1]} without reading Updates.isEnabled: in Expo Go or a build without updates.url (isEnabled false) every call rejects`, fix: 'Return { kind: "disabled" } when !Updates.isEnabled before calling the updater.' });
    }
    const network = NETWORK_CALL.exec(code);
    if (network && !code.includes(DEV_CLIENT_CODE)) {
      ctx.report.problem({ file: rel, line: lineAt(code, network.index), rule: 'adapter-enabled-guard', message: `${network[1]} without mapping ${DEV_CLIENT_CODE}: a development build reports isEnabled true and rejects every check and fetch, so each foreground check logs a failure`, fix: `Map a rejection whose code is ${DEV_CLIENT_CODE} (or ERR_UPDATES_DISABLED) to { kind: "disabled" } (templates/src/services/updates/expo-updates-adapter.ts).` });
    }
  }
  const adapters = importers.filter((importer) => isAdapter(importer.rel));
  if (!adapters.some(({ code }) => reads(code, 'isEmergencyLaunch'))) {
    ctx.report.problem({ file: adapters[0].rel, line: 1, rule: 'emergency-launch', message: 'the expo-updates adapter never reads isEmergencyLaunch: a broken update that fell back to the embedded bundle goes unreported', fix: 'Expose isEmergencyLaunch and emergencyLaunchReason in running(), and record them once after the splash (update-checker reportLaunch).' });
  }
}
