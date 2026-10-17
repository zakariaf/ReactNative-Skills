#!/usr/bin/env node
// check-test-hooks.mjs: checks the app's test-only code: one literal gate with a derived type, an
// entry that is a manifest with one unique sentinel, every export reached through TEST_ONLY from the
// startup and the routes, the test-only folders declared, the debug deep-link registry strict and
// equal to its contract with a route behind it, and the simulated clock and connectivity behaving.
// Run from the repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-test-hooks.mjs .
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, parseJsonc, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { enableAppImports, reasonOf } from './lib/app-modules.mjs';
import { probeRegistry, probeSimulatedClock, probeSimulatedConnectivity } from './lib/hook-probes.mjs';
import { isTestFile, resolveSpecifier } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-test-hooks',
  summary: 'Checks the test-only gate, its entry and sentinel, the wiring through TEST_ONLY, the debug deep-link registry and the simulated clock and connectivity.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The debug-link contract (default: <contractsDir>/debug-links.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  gate-file            <srcDir>/test-only.ts exists once test-only code exists, beside test-only-entry.ts; no second gate',
    "  gate-form            the gate is exactly TEST_ONLY: TestOnlyApi | null = process.env.EXPO_PUBLIC_APP_VARIANT === 'production'",
    "                       ? null : (require('./test-only-entry') as TestOnlyApi), with nothing else at run time",
    "  api-derived          TestOnlyApi is typeof the entry (import type * as Entry from './test-only-entry'), never hand-written",
    "  sentinel             the entry exports one TEST_BUILD_SENTINEL = '<APP>_TEST_BUILD_ONLY' that no other app file contains",
    '  entry-manifest       the entry holds only `export { ... } from` lines and the sentinel',
    '  entry-reachable      every entry export but the sentinel is read as TEST_ONLY?.<name> by app code outside the test-only folders',
    "  hooks-wired          the file that calls TEST_ONLY?.createTestHooks (or TEST_ONLY.createTestHooks after a null check) hands the result's services on (heuristic)",
    '  test-only-folders    every folder the entry re-exports from is in contracts/architecture.json testOnlyFolders',
    '  debug-registry       the registry module and contracts/debug-links.json exist and agree (path, parameters, values)',
    '  registry-strict      the registry refuses an unknown, a repeated and a bad parameter, and accepts every listed value',
    '  link-route           an Expo Router route answers the link path and renders through TEST_ONLY with the search params',
    '  simulated-clock      createSimulatedClock changes today() only and forwards nowMs() and msUntilNextLocalDay() live',
    '  simulated-connectivity  createSimulatedConnectivity is a full ConnectivityPort: none while offline, the real value otherwise',
    '',
    'NOT APPLICABLE when the app has no test-only code at all (no gate, no entry, no TEST_ONLY reader, no contract).',
    'SKIP test-only-folders while contracts/architecture.json does not exist (architecture-and-boundaries creates it).',
  ].join('\n'),
};

const SOURCE = /\.[cm]?[jt]sx?$/;
const GATE_NAME = /(?:^|\/)test-only\.[cm]?[jt]sx?$/;
const ENTRY_NAME = /(?:^|\/)test-only-entry\.[cm]?[jt]sx?$/;
const GATE_EXPRESSION = /export\s+const\s+TEST_ONLY\s*:\s*TestOnlyApi\s*\|\s*null\s*=\s*process\.env\.EXPO_PUBLIC_APP_VARIANT\s*===\s*(['"])production\1\s*\?\s*null\s*:\s*\(?\s*require\(\s*(['"])\.\/test-only-entry(?:\.ts)?\2\s*\)\s*as\s+TestOnlyApi\s*\)?\s*;/;
const SENTINEL_CONST = /export\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*(['"])([^'"\n]*)\2\s*;?/g;
const SENTINEL_VALUE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_TEST_BUILD_ONLY$/;
const GATE_TEMPLATE = 'templates/src/test-only.ts';

function read(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function readJson(root, rel) {
  const text = read(root, rel);
  if (text === null) return { exists: false, data: null, error: null };
  try {
    return { exists: true, data: parseJsonc(text), error: null };
  } catch (error) {
    return { exists: true, data: null, error: reasonOf(error) };
  }
}

/** Bundled app code: source files under srcDir that are not tests, mocks or declarations. */
function appSources(root, layout) {
  return walkRepo(root, { include: [`${layout.srcDir}/**`] }).filter((rel) => SOURCE.test(rel) && !isTestFile(rel) && !rel.endsWith('.d.ts'));
}

/** The names and lines of `export { a, b as c } from '...'` lines, and every other statement. */
function entryStatements(text) {
  const code = maskComments(text);
  const reExports = [];
  const others = [];
  let rest = code;
  for (const match of code.matchAll(/export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/g)) {
    const line = lineOf(code, match.index);
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? '';
      if (name !== '' && !name.startsWith('type ')) reExports.push({ name, spec: match[3], line });
    }
    rest = rest.replace(match[0], ' '.repeat(match[0].length));
  }
  for (const match of code.matchAll(SENTINEL_CONST)) rest = rest.replace(match[0], ' '.repeat(match[0].length));
  let previous = -1;
  for (const match of rest.matchAll(/\S[^\n]*/g)) {
    const line = lineOf(rest, match.index);
    // One report per statement: the lines of a block that follows its first line are left out.
    if (line !== previous + 1) others.push({ text: match[0].trim().slice(0, 60), line });
    previous = line;
  }
  return { reExports, others };
}

function checkGate(ctx) {
  const { root, layout, report, gates, entries } = ctx;
  const gateRel = posix.join(layout.srcDir, 'test-only.ts');
  const entryRel = posix.join(layout.srcDir, 'test-only-entry.ts');
  for (const extra of gates.filter((rel) => rel !== gateRel)) {
    report.problem({ file: extra, line: 1, rule: 'gate-file', message: 'a second test-only gate: test-only code has exactly one way in', fix: `Export what this file gates from ${entryRel} and read it through TEST_ONLY from ${gateRel}; delete this gate.` });
  }
  for (const extra of entries.filter((rel) => rel !== entryRel)) {
    report.problem({ file: extra, line: 1, rule: 'gate-file', message: `a test-only entry away from the gate (${gateRel} loads only ${entryRel})`, fix: `Move its exports into ${entryRel}.` });
  }
  const gate = read(root, gateRel);
  if (gate === null) {
    report.problem({ file: gateRel, line: 0, rule: 'gate-file', message: `the app has test-only code (${ctx.evidence}) but no gate`, fix: `Copy ${GATE_TEMPLATE} and ${posix.join('templates', entryRel)}: without the gate's literal comparison, production bundles keep the code.` });
    return { gate: null, entry: read(root, entryRel), entryRel };
  }
  const entry = read(root, entryRel);
  if (entry === null) report.problem({ file: entryRel, line: 0, rule: 'gate-file', message: 'the gate has no entry beside it', fix: `Create ${entryRel} (the template): the gate requires './test-only-entry' and nothing else.` });
  checkGateForm(ctx, gateRel, gate);
  checkApiDerived(ctx, gateRel, gate);
  return { gate, entry, entryRel };
}

function gateFormHint(code) {
  if (/__DEV__/.test(code)) return '__DEV__ is false in preview builds too, so testers would lose the hooks';
  if (/process\.env\.NODE_ENV/.test(code)) return 'NODE_ENV is production in every release build, preview included';
  if (/EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview)\1/.test(code)) return "compare with 'production' only: another polarity ships the code to the store or strips it from preview";
  if (/EXPO_PUBLIC_APP_VARIANT\s*!==/.test(code)) return "write the verified polarity: === 'production' ? null : require(...)";
  if (/\bif\s*\(/.test(code)) return 'an if block is outside the verified form; write the one ternary';
  if (/\?\s*\(?\s*require\(/.test(code) || /:\s*\(?\s*require\(/.test(code)) return 'the condition is not the literal comparison: an imported constant or a helper call keeps the module in production bundles';
  return 'write the one expression of the template';
}

function checkGateForm({ report }, gateRel, gate) {
  const code = maskComments(gate);
  const requires = [...code.matchAll(/(?<![\w$.])require\s*\(/g)];
  const match = GATE_EXPRESSION.exec(code);
  if (!match) {
    const at = requires[0]?.index ?? code.search(/TEST_ONLY/);
    report.problem({ file: gateRel, line: at >= 0 ? lineOf(code, at) : 1, rule: 'gate-form', message: `the gate is not the literal production comparison around require('./test-only-entry'): ${gateFormHint(code)}`, fix: `Use the template verbatim: export const TEST_ONLY: TestOnlyApi | null = process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : (require('./test-only-entry') as TestOnlyApi);` });
    return;
  }
  if (requires.length > 1) report.problem({ file: gateRel, line: lineOf(code, requires[1].index), rule: 'gate-form', message: 'the gate requires more than its entry', fix: 'Export the extra module from test-only-entry.ts; the gate requires the entry once.' });
  const rest = code.replace(match[0], ' ').replace(/import\s+type\s[^;]*;/g, ' ').replace(/export\s+type\s+\w+\s*=\s*(?:\{[\s\S]*?\n\}|[^;]*);/g, ' ');
  const stray = /\S/.exec(rest);
  if (stray) report.problem({ file: gateRel, line: lineOf(rest, stray.index), rule: 'gate-form', message: 'the gate runs code besides TEST_ONLY', fix: 'Keep the gate to the type import, TestOnlyApi and the TEST_ONLY expression; anything else belongs in the entry or the app.' });
}

function checkApiDerived({ root, report, layout }, gateRel, gate) {
  const code = maskComments(gate);
  const namespace = /import\s+type\s+\*\s+as\s+(\w+)\s+from\s+(['"])\.\/test-only-entry(?:\.ts)?\2/.exec(code)?.[1];
  const derived = namespace !== undefined && new RegExp(`export\\s+type\\s+TestOnlyApi\\s*=\\s*typeof\\s+${namespace}\\s*;`).test(code);
  if (derived) return;
  const apiRel = posix.join(layout.srcDir, 'test-only-api.ts');
  const api = /import\s+type\s*\{\s*TestOnlyApi\s*\}\s*from\s*(['"])\.\/test-only-api(?:\.ts)?\1/.test(code) ? read(root, apiRel) : null;
  if (api !== null && /import\s+type\s+\*\s+as\s+(\w+)\s+from\s+(['"])\.\/test-only-entry(?:\.ts)?\2[\s\S]*export\s+type\s+TestOnlyApi\s*=\s*typeof\s+\1\s*;/.test(maskComments(api))) return;
  const line = lineOf(code, Math.max(0, code.search(/TestOnlyApi/)));
  report.problem({ file: api === null ? gateRel : apiRel, line: api === null ? line : 1, rule: 'api-derived', message: 'TestOnlyApi is written by hand, so TypeScript never compares it with the entry (the gate casts the require) and knip reports every export of the entry as unused', fix: "Derive it: import type * as TestOnlyEntry from './test-only-entry'; export type TestOnlyApi = typeof TestOnlyEntry;" });
}

function checkEntry(ctx, entryRel, entry) {
  const { report, sources } = ctx;
  const code = maskComments(entry);
  const sentinels = [...code.matchAll(SENTINEL_CONST)];
  if (sentinels.length === 0) {
    report.problem({ file: entryRel, line: 1, rule: 'sentinel', message: 'the entry exports no TEST_BUILD_SENTINEL, so no bundle or build check can prove the strip', fix: "Export const TEST_BUILD_SENTINEL = '<APP>_TEST_BUILD_ONLY' (a string that exists nowhere else)." });
  }
  for (const extra of sentinels.slice(1)) report.problem({ file: entryRel, line: lineOf(code, extra.index), rule: 'sentinel', message: `a second sentinel (${extra[1]}): every development bundle must contain each one, and one is the contract`, fix: 'Keep one TEST_BUILD_SENTINEL.' });
  const [first] = sentinels;
  if (first) {
    const [, name, , value] = first;
    const line = lineOf(code, first.index);
    if (name !== 'TEST_BUILD_SENTINEL') report.problem({ file: entryRel, line, rule: 'sentinel', message: `the sentinel is named ${name}`, fix: 'Name it TEST_BUILD_SENTINEL (the build skills and the bundle check read every exported *SENTINEL* string; one name keeps the contract plain).' });
    if (!SENTINEL_VALUE.test(value)) report.problem({ file: entryRel, line, rule: 'sentinel', message: `the sentinel '${value}' is not <APP>_TEST_BUILD_ONLY`, fix: "Use the app's name, upper snake case, then _TEST_BUILD_ONLY: a distinctive string no library or catalog contains." });
    for (const rel of sources) {
      if (rel === entryRel) continue;
      // Comments never reach a bundle; strings do.
      const text = maskComments(read(ctx.root, rel) ?? '');
      const at = text.indexOf(value);
      if (value !== '' && at >= 0) report.problem({ file: rel, line: lineOf(text, at), rule: 'sentinel', message: `also contains the sentinel text '${value}', so production bundles hold it even when the entry is stripped`, fix: 'Keep the sentinel text in the entry only; import nothing from the entry outside the gate.' });
    }
  }
  const { reExports, others } = entryStatements(entry);
  for (const other of others) report.problem({ file: entryRel, line: other.line, rule: 'entry-manifest', message: `holds code besides re-exports and the sentinel: ${other.text}`, fix: "Keep the entry a manifest: `export { createTestHooks } from '@/services/test-hooks/create-test-hooks';` lines; the code lives in a test-only folder." });
  return reExports;
}

function checkReachable(ctx, entryRel, reExports) {
  const { root, report, readers, testOnlyFolders } = ctx;
  const outside = readers.filter((rel) => !testOnlyFolders.some((folder) => rel.startsWith(folder)));
  const texts = new Map(outside.map((rel) => [rel, maskComments(read(root, rel) ?? '')]));
  for (const { name, line } of reExports) {
    const pattern = new RegExp(`\\bTEST_ONLY\\s*(?:\\?\\.|!?\\.)\\s*${name}\\b`);
    if (![...texts.values()].some((text) => pattern.test(text))) report.problem({ file: entryRel, line, rule: 'entry-reachable', message: `nothing reads TEST_ONLY?.${name}: the export rides in every development bundle and does nothing, or its wiring is missing`, fix: `Wire it where the skill's workflow says (the app's root-kit registry, src/services/create-root-kits.ts, or a debug route), reading TEST_ONLY?.${name}; or drop the export.` });
  }
  if (!reExports.some((entry) => entry.name === 'createTestHooks')) return;
  for (const [rel, text] of texts) {
    const call = CREATE_HOOKS_CALL.exec(text);
    if (call === null) continue;
    // Heuristic (references/checker.md): the variable the result lands in (const testHooks =
    // TEST_ONLY?.createTestHooks(...), or the ternary form TEST_ONLY === null ? null :
    // TEST_ONLY.createTestHooks(...)) must hand its services on; an inline call must read .services
    // off the call itself. The createTestHooks Jest test proves what the services hold.
    const holder = holderOf(text, call.index);
    const usesServices = holder === null ? /createTestHooks\s*\([\s\S]*?\)\s*\??\.\s*services\b/.test(text.slice(call.index)) : new RegExp(`\\b${holder}\\s*(?:\\?\\.|!?\\.)\\s*services\\b`).test(text);
    if (!usesServices) report.problem({ file: rel, line: lineOf(text, call.index), rule: 'hooks-wired', message: "calls TEST_ONLY?.createTestHooks but never uses the result's services, so the app keeps the real clock and connectivity and no debug switch reaches a reader", fix: 'Hand `testHooks?.services ?? deviceServices` to the app (the services with the simulated clock and connectivity), never the device services alongside them.' });
  }
}

/** TEST_ONLY?.createTestHooks( / TEST_ONLY.createTestHooks( / TEST_ONLY!.createTestHooks( */
const CREATE_HOOKS_CALL = /\bTEST_ONLY\s*(?:\?\.|!?\.)\s*createTestHooks\s*\(/;

/** The const or let the statement holding the call assigns to, or null for an inline call. */
function holderOf(text, callIndex) {
  const declarations = [...text.slice(0, callIndex).matchAll(/\b(?:const|let|var)\s+(\w+)\b[^=;]*=(?!=)/g)];
  const last = declarations.at(-1);
  if (last === undefined) return null;
  return text.slice(last.index + last[0].length, callIndex).includes(';') ? null : last[1];
}

function checkFolders(ctx, entryRel, reExports) {
  const { root, layout, report } = ctx;
  const contractRel = posix.join(layout.contractsDir, 'architecture.json');
  const contract = readJson(root, contractRel);
  const skip = notYetCreated(root, { file: contractRel, owner: 'architecture-and-boundaries' });
  if (skip) {
    report.skip({ file: contractRel, rule: 'test-only-folders', message: skip });
    return;
  }
  if (contract.error !== null) {
    report.problem({ file: contractRel, line: 1, rule: 'test-only-folders', message: `cannot be read: ${contract.error}`, fix: 'Fix the JSON.' });
    return;
  }
  const declared = (Array.isArray(contract.data?.testOnlyFolders) ? contract.data.testOnlyFolders : []).filter((value) => typeof value === 'string').map((value) => (value.endsWith('/') ? value : `${value}/`));
  const reported = new Set();
  for (const { name, spec, line } of reExports) {
    const target = resolveSpecifier(entryRel, spec, { root, aliases: layout.aliases });
    if (target === null || !existsSync(join(root, target))) {
      report.problem({ file: entryRel, line, rule: 'test-only-folders', message: `re-exports ${name} from '${spec}', which does not resolve to an app file`, fix: 'Point the re-export at the module in its test-only folder.' });
      continue;
    }
    const folder = `${posix.dirname(target)}/`;
    if (declared.some((entry) => folder.startsWith(entry)) || reported.has(folder)) continue;
    reported.add(folder);
    report.problem({ file: contractRel, line: 1, rule: 'test-only-folders', message: `testOnlyFolders lacks ${folder} (the entry re-exports ${name} from it), so check-boundaries cannot catch a static import that ships it`, fix: `Add "${folder}" to testOnlyFolders in ${contractRel}.` });
  }
}

/** The Expo Router route path of a route file: groups and a trailing index dropped. */
function routePathOf(routesDir, rel) {
  const segments = rel.slice(routesDir.length + 1).replace(/\.[jt]sx?$/, '').split('/').filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.at(-1) === 'index') segments.pop();
  return segments.join('/');
}

async function checkRegistry(ctx) {
  const { root, layout, report, options } = ctx;
  const contractRel = options.contract ?? posix.join(layout.contractsDir, 'debug-links.json');
  const contract = readJson(root, contractRel);
  const registryRel = typeof contract.data?.registry === 'string' ? contract.data.registry : posix.join(layout.featuresDir, 'debug', 'debug-links.ts');
  if (!contract.exists) {
    report.problem({ file: contractRel, line: 0, rule: 'debug-registry', message: 'the debug-link contract is missing: E2E flows have no list of what the debug link accepts', fix: 'Copy templates/contracts/debug-links.json (and its schema) and list every parameter of the registry.' });
  } else if (contract.error !== null || typeof contract.data?.params !== 'object' || contract.data.params === null) {
    report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `cannot be read as a debug-link contract${contract.error ? `: ${contract.error}` : ' (no params object)'}`, fix: 'Follow templates/contracts/debug-links.schema.json.' });
    return;
  }
  if (read(root, registryRel) === null) {
    report.problem({ file: registryRel, line: 0, rule: 'debug-registry', message: 'the debug-link registry is missing', fix: 'Copy templates/src/features/debug/debug-links.ts (or set "registry" in the contract to the module that exports DEBUG_LINK_PATH, DEBUG_LINK_PARAMS and parseDebugLink).' });
    return;
  }
  let registry;
  try {
    registry = await enableAppImports(root, { aliases: layout.aliases }).load(registryRel);
  } catch (error) {
    report.problem({ file: registryRel, line: 1, rule: 'debug-registry', message: `cannot be loaded as pure TypeScript: ${reasonOf(error)}`, fix: 'Keep the registry pure (core, i18n languages and type imports only) so tests and this check can run it.' });
    return;
  }
  const missing = ['DEBUG_LINK_PATH', 'DEBUG_LINK_PARAMS', 'parseDebugLink'].filter((name) => registry[name] === undefined);
  if (missing.length > 0) {
    report.problem({ file: registryRel, line: 1, rule: 'debug-registry', message: `does not export ${missing.join(', ')}`, fix: 'Export the link path, the parameter table and the strict parser (the template shows all three).' });
    return;
  }
  for (const problem of probeRegistry(registry)) report.problem({ file: registryRel, line: 1, rule: 'registry-strict', message: problem, fix: 'Refuse the whole link on an unknown, repeated or bad parameter (typed debug-link-* failures) and accept every listed value: a typo must fail the flow, not test another state.' });
  if (contract.exists) compareContract(ctx, contractRel, contract.data, registryRel, registry);
  checkLinkRoute(ctx, registry.DEBUG_LINK_PATH, registryRel);
}

function compareContract({ report }, contractRel, data, registryRel, registry) {
  const fix = `Change ${registryRel} and ${contractRel} in the same commit: flows read the contract, the app runs the registry.`;
  if (data.path !== registry.DEBUG_LINK_PATH) report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `path is ${JSON.stringify(data.path)} but the registry's DEBUG_LINK_PATH is ${JSON.stringify(registry.DEBUG_LINK_PATH)}`, fix });
  const listed = data.params;
  const actual = registry.DEBUG_LINK_PARAMS;
  for (const name of Object.keys(actual).filter((key) => !(key in listed))) report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `the registry accepts ${name}, the contract does not list it`, fix });
  for (const name of Object.keys(listed).filter((key) => !(key in actual))) report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `lists ${name}, which the registry refuses`, fix });
  for (const [name, spec] of Object.entries(actual)) {
    const entry = listed[name];
    if (entry === undefined) continue;
    if (spec.kind === 'date' || entry.kind === 'date') {
      if (spec.kind !== entry.kind) report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `${name} is a ${spec.kind === 'date' ? 'date' : 'list of values'} in the registry but not in the contract`, fix });
      continue;
    }
    const want = new Set(spec.values ?? []);
    const have = new Set(Array.isArray(entry.values) ? entry.values : []);
    const absent = [...want].filter((value) => !have.has(value));
    const extra = [...have].filter((value) => !want.has(value));
    if (absent.length > 0 || extra.length > 0) report.problem({ file: contractRel, line: 1, rule: 'debug-registry', message: `${name} values differ${absent.length ? `; missing ${absent.join(', ')}` : ''}${extra.length ? `; not accepted ${extra.join(', ')}` : ''}`, fix });
  }
}

function checkLinkRoute({ root, layout, report }, linkPath, registryRel) {
  const pkg = readJson(root, 'package.json').data ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps['expo-router'] === undefined) {
    report.note('note: link-route: expo-router is not in package.json; with React Navigation the linking config must map the link path to a screen rendered through TEST_ONLY');
    return;
  }
  const routes = walkRepo(root, { include: [`${layout.routesDir}/**`] }).filter((rel) => /\.[jt]sx?$/.test(rel) && !isTestFile(rel) && !/(?:^|\/)[_+][^/]*$/.test(rel));
  const route = routes.find((rel) => routePathOf(layout.routesDir, rel) === linkPath);
  if (route === undefined) {
    report.problem({ file: posix.join(layout.routesDir, '(debug)', `${linkPath}.tsx`), line: 0, rule: 'link-route', message: `no route answers the debug link path '${linkPath}' (${registryRel}), so Expo Router opens the not-found screen`, fix: 'Copy templates/src/app/(debug)/ (the group layout, the menu route and the link route).' });
    return;
  }
  const code = maskComments(read(root, route) ?? '');
  if (!/\bTEST_ONLY\b/.test(code) || !/useLocalSearchParams\s*\(/.test(code)) report.problem({ file: route, line: 1, rule: 'link-route', message: 'the link route does not hand useLocalSearchParams() to a screen read through TEST_ONLY', fix: 'Render TEST_ONLY?.DebugSetupRoot with params={useLocalSearchParams()} and <Redirect href="/" /> when it is undefined (production).' });
}

async function checkSimulations(ctx, reExports) {
  const { root, layout, report, sources } = ctx;
  const findModule = (name) => sources.find((rel) => new RegExp(`export\\s+function\\s+${name}\\b`).test(read(root, rel) ?? ''));
  const needed = reExports.some((entry) => entry.name === 'createTestHooks');
  const app = enableAppImports(root, { aliases: layout.aliases });
  const clockRel = findModule('createSimulatedClock');
  if (clockRel === undefined) {
    if (needed) report.problem({ file: posix.join(layout.servicesDir, 'test-hooks', 'simulated-clock.ts'), line: 0, rule: 'simulated-clock', message: 'the test hooks have no createSimulatedClock, so date= and the day buttons reach nothing', fix: 'Copy templates/src/services/test-hooks/simulated-clock.ts.' });
  } else {
    await probe(report, clockRel, 'simulated-clock', async () => probeSimulatedClock(await app.load(clockRel)), 'Wrap the real ClockPort: today() answers the simulated day when one is set; nowMs() and msUntilNextLocalDay() call the real clock every time.');
  }
  const offlineRel = findModule('createSimulatedConnectivity');
  if (offlineRel === undefined) return;
  const hubRel = posix.join(layout.servicesDir, 'connectivity', 'reachability-hub.ts');
  if (!app.exists(hubRel)) {
    report.problem({ file: hubRel, line: 0, rule: 'simulated-connectivity', message: 'the simulated connectivity has no reachability hub to build on', fix: "Copy networking-and-server-state's src/services/connectivity/ (the ConnectivityPort, its hub and fake)." });
    return;
  }
  await probe(report, offlineRel, 'simulated-connectivity', async () => probeSimulatedConnectivity(await app.load(offlineRel), await app.load(hubRel)), 'Build it on createReachabilityHub: report none while offline is simulated, forward the real reachability otherwise, and return { port, setOffline, stop }.');
}

async function probe(report, rel, rule, run, fix) {
  let problems;
  try {
    problems = await run();
  } catch (error) {
    problems = [`cannot be loaded or run as pure TypeScript: ${reasonOf(error)}`];
  }
  for (const message of problems) report.problem({ file: rel, line: 1, rule, message, fix });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  if (!existsSync(join(root, 'package.json')) && !existsSync(join(root, layout.srcDir))) {
    fail(`nothing to check: ${root} has no package.json and no ${layout.srcDir}/`, 'Run it from the app repo root, or pass the root: node check-test-hooks.mjs <repo-root>.');
  }
  const report = createReporter({ name: 'check-test-hooks', json: options.json });
  const sources = appSources(root, layout);
  const gates = sources.filter((rel) => GATE_NAME.test(rel));
  const entries = sources.filter((rel) => ENTRY_NAME.test(rel));
  const readers = sources.filter((rel) => !GATE_NAME.test(rel) && !ENTRY_NAME.test(rel) && /\bTEST_ONLY\b/.test(maskComments(read(root, rel) ?? '')));
  const contractRel = options.contract ?? posix.join(layout.contractsDir, 'debug-links.json');
  const hasContract = existsSync(join(root, contractRel));
  if (gates.length === 0 && entries.length === 0 && readers.length === 0 && !hasContract) {
    return report.notApplicable(`the app has no test-only code: no ${layout.srcDir}/test-only.ts, no test-only entry, no TEST_ONLY reader and no ${contractRel}`);
  }
  const architecture = readJson(root, posix.join(layout.contractsDir, 'architecture.json')).data;
  const testOnlyFolders = (Array.isArray(architecture?.testOnlyFolders) ? architecture.testOnlyFolders : []).filter((value) => typeof value === 'string').map((value) => (value.endsWith('/') ? value : `${value}/`));
  const evidence = [entries[0], readers[0] && `${readers[0]} reads TEST_ONLY`, hasContract && contractRel].filter(Boolean).join(', ');
  const ctx = { root, layout, report, options, sources, gates, entries, readers, testOnlyFolders, evidence };
  const { entry, entryRel } = checkGate(ctx);
  const reExports = entry === null ? [] : checkEntry(ctx, entryRel, entry);
  if (entry !== null) {
    checkReachable(ctx, entryRel, reExports);
    checkFolders(ctx, entryRel, reExports);
  }
  await checkRegistry(ctx);
  await checkSimulations(ctx, reExports);
  return report.finish({ checked: sources.length, unit: 'app source files' });
});
