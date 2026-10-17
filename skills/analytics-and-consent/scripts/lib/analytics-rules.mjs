// analytics-rules.mjs: check-analytics.mjs's rules. Each takes the loaded repo (analytics-repo.mjs)
// and the reporter and reports problems. Not an entry point.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments, notYetCreated } from '../check-lib.mjs';
import { balancedParens, functionsOf, scanSource } from './source-scan.mjs';
import { findConstInitializer, parseObjectEntries } from './ts-literal.mjs';
import {
  autoStartWhy,
  FACTS,
  guardedPackages,
  importsPackage,
  isVendorAdapter,
  isVendorAdapterTest,
  layoutPath,
  lineAt,
} from './analytics-repo.mjs';

const AUDIENCES = ['general', 'child-directed'];
const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/;

/** The parsed contract, or null (the contract rule reported why). */
export function contractOf(repo) {
  return repo.contract?.value && typeof repo.contract.value === 'object' ? repo.contract.value : null;
}

function contractLine(repo, key) {
  const path = join(repo.root, repo.paths.contract);
  if (!existsSync(path)) return 1;
  const text = readFileSync(path, 'utf8');
  const index = text.indexOf(`"${key}"`);
  return index === -1 ? 1 : lineAt(text, index);
}

function sdkName(repo) {
  const sdk = contractOf(repo)?.sdk;
  return typeof sdk === 'string' && sdk !== 'none' ? sdk : null;
}

function sdkFacts(repo) {
  const sdk = sdkName(repo);
  return sdk === null ? null : (FACTS.sdks[sdk] ?? null);
}

function adapters(repo) {
  return repo.sources.filter((source) => !source.isTest && isVendorAdapter(source.rel, repo));
}

function collects(repo) {
  const list = contractOf(repo)?.collects;
  return Array.isArray(list) ? list.filter((entry) => entry && typeof entry === 'object') : [];
}

// ------------------------------------------------------------------------------------------------
// contract, files, inventory
// ------------------------------------------------------------------------------------------------

function collectsProblems(list) {
  const problems = [];
  if (!Array.isArray(list)) return ['collects must be a list'];
  list.forEach((entry, index) => {
    const at = `collects[${index}]`;
    if (!entry || typeof entry !== 'object') return problems.push(`${at} is not an object`);
    if (!Object.hasOwn(FACTS.dataTypes, entry.dataType)) problems.push(`${at}.dataType "${entry.dataType}" is not one of ${Object.keys(FACTS.dataTypes).join(', ')}`);
    if (typeof entry.linked !== 'boolean' || typeof entry.tracking !== 'boolean') problems.push(`${at} needs linked and tracking booleans`);
    if (!Array.isArray(entry.purposes) || entry.purposes.length === 0 || !entry.purposes.every((p) => Object.hasOwn(FACTS.purposes, p))) {
      problems.push(`${at}.purposes needs one or more of ${Object.keys(FACTS.purposes).join(', ')}`);
    }
    if (typeof entry.why !== 'string' || entry.why.trim() === '') problems.push(`${at}.why must say what produces this data`);
  });
  return problems;
}

/** contract: the file exists, parses, and every key has a valid value. */
export function checkContract(repo, report) {
  const file = repo.paths.contract;
  const fix = 'Copy templates/contracts/analytics.json and fill it (every key is documented in analytics.schema.json).';
  if (repo.contract === null) return report.problem({ file, line: 1, rule: 'contract', message: 'the analytics contract is missing', fix });
  if (repo.contract.error) return report.problem({ file, line: 1, rule: 'contract', message: `the contract does not parse: ${repo.contract.error}`, fix });
  const contract = contractOf(repo);
  const problems = [];
  if (typeof contract.sdk !== 'string' || contract.sdk === '') problems.push(['sdk', 'sdk must name the npm package (or "none")']);
  if (!AUDIENCES.includes(contract.audience)) problems.push(['audience', 'audience must be general or child-directed']);
  for (const key of ['tracking', 'identifies']) if (typeof contract[key] !== 'boolean') problems.push([key, `${key} must be true or false`]);
  const endpoints = contract.endpoints;
  if (!Array.isArray(endpoints) || !endpoints.every((origin) => HTTPS_ORIGIN.test(origin))) problems.push(['endpoints', 'endpoints must be a list of https origins']);
  else if (sdkName(repo) !== null && endpoints.length === 0) problems.push(['endpoints', `endpoints is empty although ${contract.sdk} sends events`]);
  for (const message of collectsProblems(contract.collects)) problems.push(['collects', message]);
  for (const [key, message] of problems) report.problem({ file, line: contractLine(repo, key), rule: 'contract', message, fix });
}

/** files: the port, catalog, sanitizer, consent codec, gate, fake, config, manifest script and adapters exist. */
export function checkFiles(repo, report) {
  const fix = 'Copy the template at that path (templates/ mirrors the app layout).';
  for (const template of FACTS.requiredFiles) {
    const file = layoutPath(template, repo.layout);
    if (!existsSync(join(repo.root, file))) report.problem({ file, line: 1, rule: 'files', message: 'required analytics file is missing', fix });
  }
  const dir = repo.paths.analyticsDir;
  if (!repo.sources.some((source) => !source.isTest && source.rel.startsWith(`${dir}/`) && /-analytics-consent-adapter\.ts$/.test(source.rel))) {
    report.problem({ file: `${dir}/kv-analytics-consent-adapter.ts`, line: 1, rule: 'files', message: 'no consent store adapter (*-analytics-consent-adapter.ts)', fix });
  }
  if (sdkName(repo) !== null && adapters(repo).length === 0) {
    report.problem({ file: `${dir}/<vendor>-analytics-adapter.ts`, line: 1, rule: 'files', message: `contract sdk ${sdkName(repo)} has no vendor adapter`, fix: 'Write <vendor>-analytics-adapter.ts after examples/posthog-analytics-adapter.ts.' });
  }
}

/** sdk-inventory: the contract's SDK is installed, no other analytics SDK is, nothing starts on its own. */
export function checkInventory(repo, report) {
  const file = 'package.json';
  const sdk = sdkName(repo);
  if (sdk !== null && !repo.deps.has(sdk)) {
    report.problem({ file: repo.paths.contract, line: contractLine(repo, 'sdk'), rule: 'sdk-inventory', message: `contract sdk ${sdk} is not in package.json`, fix: `Install it (npm install -E ${sdk}@<version>) or set sdk to the installed package.` });
  }
  for (const name of repo.knownSdks) {
    const kind = FACTS.sdks[name]?.kind;
    if (Object.hasOwn(FACTS.bannedKinds, kind)) report.problem({ file, line: 1, rule: 'sdk-inventory', message: `${name}: ${FACTS.bannedKinds[kind]}`, fix: 'Uninstall it; product analytics sends catalog events only.' });
    else if (name !== sdk) report.problem({ file, line: 1, rule: 'sdk-inventory', message: `${name} is installed but contracts/analytics.json does not declare it`, fix: 'Declare it as the sdk (one analytics vendor) or uninstall it.' });
  }
  for (const name of repo.autoStart) {
    const entry = FACTS.autoStartSdks[name];
    report.problem({ file, line: 1, rule: 'sdk-inventory', message: `${name} ${autoStartWhy(entry)}`, fix: typeof entry === 'string' ? 'Uninstall it: analytics starts only after the user said yes.' : entry.fix });
  }
}

// ------------------------------------------------------------------------------------------------
// imports, lazy creation, options
// ------------------------------------------------------------------------------------------------

/** sdk-import: only the vendor adapter (and its own test) imports an analytics SDK. */
export function checkImports(repo, report) {
  const guarded = guardedPackages(repo);
  for (const source of repo.sources) {
    if (isVendorAdapter(source.rel, repo) || isVendorAdapterTest(source.rel, repo)) continue;
    for (const entry of source.imports) {
      const pkg = [...guarded].find((name) => importsPackage(entry.from, name));
      if (pkg === undefined) continue;
      const rule = source.isTest ? 'test-isolation' : 'sdk-import';
      const fix = source.isTest
        ? 'Tests use createFakeAnalytics() / createFakeAnalyticsSdk(); only the adapter test touches the SDK.'
        : 'Go through the AnalyticsPort; only src/services/analytics/<vendor>-analytics-adapter.ts imports the SDK.';
      report.problem({ file: source.rel, line: lineAt(source.text, entry.index), rule, message: `imports ${pkg}`, fix });
    }
  }
}

/** test-isolation: tests never import the vendor adapter (they use the fakes). */
export function checkTestIsolation(repo, report) {
  for (const source of repo.sources) {
    if (!source.isTest || isVendorAdapterTest(source.rel, repo)) continue;
    for (const entry of source.imports) {
      if (!/-analytics-adapter$/.test(entry.from.replace(/\.tsx?$/, ''))) continue;
      report.problem({ file: source.rel, line: lineAt(source.text, entry.index), rule: 'test-isolation', message: `imports the vendor adapter ${entry.from}`, fix: 'Give the test createFakeAnalytics() (or createFakeAnalyticsSdk() for the gate).' });
    }
  }
}

function createAnalyticsSpans(source) {
  const spans = [];
  for (const match of source.masked.matchAll(/(?<![\w$.])createAnalytics\s*\(/g)) {
    if (/function\s+$/.test(source.masked.slice(Math.max(0, match.index - 20), match.index))) continue;
    const open = match.index + match[0].length - 1;
    const inner = balancedParens(source.masked, open);
    if (inner !== null) spans.push({ start: match.index, open, end: open + inner.length + 1 });
  }
  return spans;
}

const BUILTIN_CLASSES = 'Map|Set|WeakMap|WeakSet|WeakRef|Error|TypeError|RangeError|RegExp|Date|Promise|URL|URLSearchParams|Array|Proxy|AbortController|TextEncoder|TextDecoder|Intl';

/**
 * The spans of the adapter's exported factory bodies (create<Vendor>AnalyticsAdapter with a block
 * body). The SDK client is constructed only inside one; anywhere else in the module (top level, a
 * module-level helper) it is built when the composition root imports the adapter: at launch.
 */
function factoryBodies(source) {
  return functionsOf(scanSource(source.text))
    .filter((fn) => /^create[A-Z]\w*AnalyticsAdapter$/.test(fn.name) && fn.bodyStart !== -1 && fn.bodyEnd !== -1)
    .map((fn) => [fn.bodyStart, fn.bodyEnd]);
}

function checkAdapterConstruction(repo, source, report) {
  const facts = sdkFacts(repo);
  const construct = new RegExp(facts?.constructPattern ?? `(?<![\\w$.])new\\s+(?!(?:${BUILTIN_CLASSES})\\b)[A-Z][\\w$.]*\\s*\\(`, 'g');
  const bodies = factoryBodies(source);
  for (const match of source.masked.matchAll(construct)) {
    if (bodies.some(([from, to]) => match.index > from && match.index < to)) continue;
    report.problem({ file: source.rel, line: lineAt(source.text, match.index), rule: 'sdk-lazy', message: `${match[0].replace(/\s*\($/, '')} runs outside the body of the exported create<Vendor>AnalyticsAdapter function, so the client exists as soon as the module is imported (before consent)`, fix: 'Construct the client inside create<Vendor>AnalyticsAdapter (a function with a block body), which createAnalytics calls in createSdk after a yes.' });
  }
}

/**
 * True when `index` lies in the value of the createSdk property (createSdk: () => ..., or the method
 * createSdk() { ... }) that is the last one before it in the createAnalytics(...) call: a call in
 * another property (clearSdkStorage: () => createAdapter().reset()) is not lazy.
 */
function insideCreateSdk(masked, from, index) {
  const before = masked.slice(from, index);
  let last = -1;
  for (const match of before.matchAll(/(?<![\w$.])createSdk\s*(?=[:(])/g)) last = match.index + match[0].length;
  if (last === -1) return false;
  const valueStart = from + last + (masked[from + last] === ':' ? 1 : 0);
  return index < expressionEnd(masked, valueStart);
}

/** sdk-lazy: the gate is created in the composition root and the adapter only inside its createSdk. */
export function checkLazy(repo, report) {
  const root = repo.paths.compositionRoot;
  for (const source of repo.sources) {
    if (source.isTest) continue;
    if (isVendorAdapter(source.rel, repo)) {
      checkAdapterConstruction(repo, source, report);
      continue;
    }
    const spans = createAnalyticsSpans(source);
    if (source.rel !== root) {
      for (const span of spans) report.problem({ file: source.rel, line: lineAt(source.text, span.start), rule: 'sdk-lazy', message: 'createAnalytics() outside the root-kit registry (the composition root of the optional kits)', fix: `Create the one AnalyticsPort in ${root} and hand it to createAnalyticsKit, which provides it to the app (useAnalytics()).` });
    }
    for (const match of source.masked.matchAll(/(?<![\w$.])create[A-Z]\w*AnalyticsAdapter\s*\(/g)) {
      if (/function\s+$/.test(source.masked.slice(Math.max(0, match.index - 20), match.index))) continue;
      const inside = spans.find((span) => match.index > span.open && match.index < span.end);
      const lazy = source.rel === root && inside !== undefined && insideCreateSdk(source.masked, inside.open, match.index);
      if (!lazy) report.problem({ file: source.rel, line: lineAt(source.text, match.index), rule: 'sdk-lazy', message: 'the vendor adapter is created outside createAnalytics({ createSdk })', fix: `Write the adapter call inside createSdk: () => ... in ${root}, so the SDK exists only after consent.` });
    }
  }
}

/**
 * sdk-clear: an SDK that persists ids passes clearSdkStorage to createAnalytics, so a no or forget()
 * in a session where the SDK never started still deletes the earlier session's ids and queue.
 */
export function checkClearStorage(repo, report) {
  if (!sdkFacts(repo)?.persistsInstallId) return;
  const root = repo.sources.find((source) => source.rel === repo.paths.compositionRoot);
  if (root === undefined) return;
  const code = maskComments(root.text);
  for (const span of createAnalyticsSpans(root)) {
    if (/\bclearSdkStorage\b/.test(code.slice(span.open, span.end))) continue;
    report.problem({ file: root.rel, line: lineAt(root.text, span.start), rule: 'sdk-clear', message: `createAnalytics() gets no clearSdkStorage although ${sdkName(repo)} keeps its ids and unsent queue on the device`, fix: 'Pass clearSdkStorage (PostHog: clearPosthogStorage from the adapter), so a no or forget() with no SDK in the session deletes them (references/consent-gate.md).' });
  }
}

function optionProblems(repo, facts, source) {
  const text = maskComments(source.text);
  const out = [];
  const anonymous = contractOf(repo)?.identifies !== true;
  for (const entry of [...facts.required, ...(anonymous ? (facts.requiredWhenAnonymous ?? []) : [])]) {
    if (!new RegExp(entry.pattern).test(text)) out.push({ line: 1, message: `missing ${entry.pattern.replace(/\\s\*|\\/g, '')}: ${entry.why}` });
  }
  for (const entry of facts.banned) {
    const match = new RegExp(entry.pattern).exec(text);
    if (match) out.push({ line: lineAt(text, match.index), message: `${match[0]}: ${entry.why}` });
  }
  return out;
}

/** sdk-options: the adapter sets the SDK's privacy-relevant options as the facts table requires. */
export function checkOptions(repo, report) {
  const facts = sdkFacts(repo);
  if (facts === null) return;
  const fix = 'Set the option as examples/posthog-analytics-adapter.ts does (references/vendors-and-sdk-facts.md says why).';
  for (const source of adapters(repo)) {
    for (const { line, message } of optionProblems(repo, facts, source)) report.problem({ file: source.rel, line, rule: 'sdk-options', message, fix });
  }
  if (facts.configFile) {
    const path = join(repo.root, facts.configFile);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    for (const entry of facts.configRequired ?? []) {
      if (!new RegExp(entry.pattern).test(text)) report.problem({ file: facts.configFile, line: 1, rule: 'sdk-options', message: `missing ${entry.pattern.replace(/\\s\*|\\/g, '')}: ${entry.why}`, fix });
    }
  }
}

// ------------------------------------------------------------------------------------------------
// the event catalog and track() calls
// ------------------------------------------------------------------------------------------------

function eventsFile(repo) {
  return `${repo.paths.analyticsDir}/analytics-events.ts`;
}

/** The catalog entries [{ key, line, value }] or null (event-catalog reported). */
export function readCatalog(repo, report) {
  const file = eventsFile(repo);
  const path = join(repo.root, file);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const start = findConstInitializer(text, 'ANALYTICS_EVENTS');
  const fix = 'Keep ANALYTICS_EVENTS a plain object literal (as const satisfies ...), as the template has it.';
  if (start === -1) {
    report?.problem({ file, line: 1, rule: 'event-catalog', message: 'no ANALYTICS_EVENTS object', fix });
    return null;
  }
  const entries = [];
  let parsed;
  try {
    parsed = parseObjectEntries(text, start);
  } catch (error) {
    report?.problem({ file, line: lineAt(text, error?.index ?? start), rule: 'event-catalog', message: `ANALYTICS_EVENTS is not plain data: ${error?.message ?? error}`, fix });
    return null;
  }
  for (const entry of parsed) {
    if (entry.error) report?.problem({ file, line: lineAt(text, entry.errorIndex ?? entry.index), rule: 'event-catalog', message: `event ${entry.key}: ${entry.error}`, fix });
    else entries.push({ key: entry.key, line: lineAt(text, entry.index), value: entry.value });
  }
  return entries;
}

function nameProblem(name, maxLength) {
  const { namePattern, reservedPrefixes } = FACTS.events;
  if (!new RegExp(namePattern).test(name)) return `${name} is not snake_case`;
  if (name.length > maxLength) return `${name} is longer than ${maxLength} characters`;
  const prefix = reservedPrefixes.find((p) => name.startsWith(p));
  return prefix === undefined ? null : `${name} uses the reserved prefix ${prefix}`;
}

function piiWord(name) {
  const words = new Set(FACTS.events.piiWords);
  if (words.has(name)) return name;
  return name.split('_').find((part) => words.has(part)) ?? null;
}

function propProblem(spec) {
  const { propKinds, maxEnumValueLength } = FACTS.events;
  if (!spec || !propKinds.includes(spec.kind)) return `kind must be one of ${propKinds.join(', ')} (never free text)`;
  if (spec.kind === 'enum') {
    const ok = Array.isArray(spec.values) && spec.values.length > 0 && spec.values.every((v) => typeof v === 'string' && /^[a-z0-9_]+$/.test(v) && v.length <= maxEnumValueLength);
    return ok ? null : 'enum values must be a non-empty list of lowercase words';
  }
  if (spec.kind === 'count') return Number.isInteger(spec.max) && spec.max > 0 ? null : 'count needs a whole max above 0';
  return null;
}

function checkEvent(entry, file, report) {
  const fix = 'Follow the catalog rules (references/event-catalog.md).';
  const { key, line, value } = entry;
  const nameIssue = nameProblem(key, FACTS.events.maxNameLength) ?? (FACTS.events.reservedNames.includes(key) ? `${key} is a name analytics vendors reserve for their automatic events` : null);
  if (nameIssue) report.problem({ file, line, rule: 'event-name', message: nameIssue, fix });
  if (piiWord(key)) report.problem({ file, line, rule: 'event-pii', message: `event ${key} names personal data (${piiWord(key)})`, fix: 'Events describe actions, never people or what they typed.' });
  if (typeof value?.purpose !== 'string' || value.purpose.trim().length < 10) report.problem({ file, line, rule: 'event-purpose', message: `event ${key} has no purpose`, fix: 'Give it a purpose: one sentence on what decision the event informs.' });
  const props = value?.props && typeof value.props === 'object' ? value.props : null;
  if (props === null) return report.problem({ file, line, rule: 'event-props', message: `event ${key} has no props object`, fix });
  const names = Object.keys(props);
  if (names.length > FACTS.events.maxProps) report.problem({ file, line, rule: 'event-props', message: `event ${key} has ${names.length} props (at most ${FACTS.events.maxProps})`, fix });
  for (const prop of names) {
    const issue = nameProblem(prop, FACTS.events.maxPropNameLength) ?? propProblem(props[prop]);
    if (issue) report.problem({ file, line, rule: 'event-props', message: `${key}.${prop}: ${issue}`, fix });
    if (piiWord(prop)) report.problem({ file, line, rule: 'event-pii', message: `${key}.${prop} names personal data (${piiWord(prop)})`, fix: 'Send a category, a boolean or a bucketed count instead, never an id or text.' });
  }
}

/** event-name, event-props, event-pii, event-purpose over the catalog. Returns the event names. */
export function checkCatalog(repo, report) {
  const entries = readCatalog(repo, report);
  if (entries === null) return null;
  for (const entry of entries) checkEvent(entry, eventsFile(repo), report);
  return entries.map((entry) => entry.key);
}

const PATH_WORDS = /\b(pathname|usePathname|useGlobalSearchParams|useLocalSearchParams|searchParams|params|href|url)\b/;

/** track-literal and screen-pathname over every track() call. */
export function checkTrackCalls(repo, report, names) {
  const catalog = new Set(names ?? []);
  for (const source of repo.sources) {
    if (source.isTest || isVendorAdapter(source.rel, repo)) continue;
    for (const match of source.masked.matchAll(/\.track\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const argument = balancedParens(source.text, open) ?? '';
      const line = lineAt(source.text, match.index);
      const name = /^\s*\{\s*name\s*:\s*(['"])([a-z0-9_]+)\1/.exec(argument)?.[2];
      if (name === undefined) report.problem({ file: source.rel, line, rule: 'track-literal', message: 'track() without an object literal starting with a literal event name', fix: "Call analytics.track({ name: 'event_name', props: { ... } }) with the name written out." });
      else if (names !== null && !catalog.has(name)) report.problem({ file: source.rel, line, rule: 'track-literal', message: `event ${name} is not in ANALYTICS_EVENTS`, fix: 'Add it to the catalog (and review the store declarations) or use a catalog event.' });
      const word = PATH_WORDS.exec(maskComments(argument))?.[1];
      if (word) report.problem({ file: source.rel, line, rule: 'screen-pathname', message: `track() sends ${word}`, fix: 'Send route patterns from useSegments (useScreenViews), never a path, a URL or params.' });
    }
    checkPathReads(source, report);
  }
}

const PATH_HOOK = /(?<![\w$.])(usePathname|useGlobalSearchParams|useLocalSearchParams)\s*(<[^>()]*>)?\s*\(/g;

/** The names a path hook's result is bound to: `const where = usePathname()`, `const { id, ...rest } = useLocalSearchParams()`. */
function boundNames(masked, index) {
  const before = masked.slice(Math.max(0, masked.lastIndexOf('\n', index - 1) - 200), index);
  const simple = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/.exec(before);
  if (simple) return [simple[1]];
  const destructured = /(?:const|let|var)\s*\{([^}]*)\}\s*(?::[^=]*)?=\s*$/.exec(before);
  if (!destructured) return [];
  return destructured[1].split(',').map((part) => part.replace(/^\s*\.\.\./, '').split(/[:=]/).pop().trim()).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * screen-pathname, beyond the track() argument: a screen-view module that reads a path hook, a file
 * that both tracks and reads usePathname() (a concrete path has no other use next to track()), and
 * a search-param value that flows by name into a track() argument. Indirection through other
 * variables is not followed (references/event-catalog.md says so).
 */
function checkPathReads(source, report) {
  const hooks = [...source.masked.matchAll(PATH_HOOK)];
  if (hooks.length === 0) return;
  const fix = 'Name screens with useSegments() and screenNameFromSegments(): patterns, never concrete paths or params.';
  const reportsScreens = /\b(useScreenViews|screenNameFromSegments)\s*\(/.test(source.masked) || /export function useScreenViews\b/.test(source.masked);
  const trackArgs = [...source.masked.matchAll(/\.track\s*\(/g)].map((match) => maskComments(balancedParens(source.text, match.index + match[0].length - 1) ?? ''));
  for (const hook of hooks) {
    const line = lineAt(source.text, hook.index);
    if (reportsScreens) {
      report.problem({ file: source.rel, line, rule: 'screen-pathname', message: `screen views read ${hook[1]}()`, fix });
      continue;
    }
    if (trackArgs.length === 0) continue;
    if (hook[1] === 'usePathname') {
      report.problem({ file: source.rel, line, rule: 'screen-pathname', message: 'usePathname() in a file that calls track(): a concrete path carries record ids', fix });
      continue;
    }
    const leaked = boundNames(source.masked, hook.index).find((name) => trackArgs.some((arg) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(arg)));
    if (leaked) report.problem({ file: source.rel, line, rule: 'screen-pathname', message: `${leaked} from ${hook[1]}() is sent in a track() call`, fix });
  }
}

// ------------------------------------------------------------------------------------------------
// identity, tracking, audience, declarations
// ------------------------------------------------------------------------------------------------

/** identify: an anonymous contract means no identify/alias/person calls in the adapter. */
export function checkIdentify(repo, report) {
  if (contractOf(repo)?.identifies !== false) return;
  const calls = new RegExp(`\\.(${FACTS.identifyCalls.join('|')})\\s*[(.]`);
  for (const source of adapters(repo)) {
    const match = calls.exec(maskComments(source.text));
    if (match) report.problem({ file: source.rel, line: lineAt(source.text, match.index), rule: 'identify', message: `${match[1]}() although contracts/analytics.json identifies is false`, fix: 'Keep analytics anonymous, or set identifies: true and declare a linked user-id (references/store-declarations.md).' });
  }
}

/** tracking: the profile in the contract matches the composition root, the adapter and the collects. */
export function checkTracking(repo, report) {
  const contract = contractOf(repo);
  if (contract === null || typeof contract.tracking !== 'boolean') return;
  const root = repo.sources.find((source) => source.rel === repo.paths.compositionRoot);
  const passes = root !== undefined && createAnalyticsSpans(root).some((span) => /\btracking\s*:/.test(maskComments(root.text).slice(span.open, span.end)));
  const fix = 'Keep the default (tracking: false, no tracking option, no advertising id), or follow references/att-and-tracking.md for the tracking profile.';
  if (!contract.tracking) {
    if (passes) report.problem({ file: root.rel, line: 1, rule: 'tracking', message: 'createAnalytics gets a tracking option although the contract says tracking: false', fix });
    collects(repo).forEach((entry) => {
      if (entry.tracking === true) report.problem({ file: repo.paths.contract, line: contractLine(repo, 'collects'), rule: 'tracking', message: `${entry.dataType} is declared tracking: true although the contract says tracking: false`, fix });
    });
    const ids = new RegExp(`\\b(${FACTS.advertisingIdApis.join('|')})\\b`);
    for (const source of adapters(repo)) {
      const match = ids.exec(maskComments(source.text));
      if (match) report.problem({ file: source.rel, line: lineAt(source.text, match.index), rule: 'tracking', message: `the adapter touches an advertising identifier (${match[1]})`, fix });
    }
    return;
  }
  if (!passes) report.problem({ file: repo.paths.compositionRoot, line: 1, rule: 'tracking', message: 'tracking: true but createAnalytics gets no tracking option (Apple\'s ATT answer)', fix: 'Pass tracking: createExpoTrackingConsentAdapter({ onError }) (the canonical ConsentPort half).' });
  if (!collects(repo).some((entry) => entry.tracking === true)) report.problem({ file: repo.paths.contract, line: contractLine(repo, 'collects'), rule: 'tracking', message: 'tracking: true but no collected data type is declared tracking: true', fix: 'Mark the data types used for tracking (usually device-id and product-interaction).' });
}

/** child-directed: no third-party analytics SDK in an app for children. */
export function checkAudience(repo, report) {
  const contract = contractOf(repo);
  if (contract?.audience !== 'child-directed') return;
  if (sdkName(repo) !== null) report.problem({ file: repo.paths.contract, line: contractLine(repo, 'sdk'), rule: 'child-directed', message: `a child-directed app ships the third-party analytics SDK ${contract.sdk}`, fix: 'Remove it (App Review 1.3 and 5.1.4, Play Families); stop and ask the developer before any analytics in an app for children.' });
  if (contract.tracking === true || contract.identifies === true) report.problem({ file: repo.paths.contract, line: contractLine(repo, 'audience'), rule: 'child-directed', message: 'a child-directed app may neither track nor identify', fix: 'Set tracking and identifies to false.' });
}

function required(repo, names) {
  const facts = sdkFacts(repo);
  const contract = contractOf(repo);
  const out = [];
  if ((names?.length ?? 0) > 0) out.push(['product-interaction', 'the catalog sends events']);
  if (facts?.persistsInstallId) out.push(['device-id', `${contract.sdk} saves an install id on the device`]);
  if (contract.identifies === true) out.push(['user-id', 'identifies is true']);
  if (facts && facts.kind === 'product-analytics') {
    const off = facts.geoipOff ? adapters(repo).some((source) => new RegExp(facts.geoipOff).test(maskComments(source.text))) : false;
    if (!off) out.push(['coarse-location', `${contract.sdk} derives a location from the IP address unless switched off`]);
  }
  return out;
}

/** declarations: collects covers what the catalog, the SDK and the identity setting imply. */
export function checkDeclarations(repo, report, names) {
  const contract = contractOf(repo);
  if (contract === null || sdkName(repo) === null) return;
  const declared = new Map(collects(repo).map((entry) => [entry.dataType, entry]));
  const line = contractLine(repo, 'collects');
  const fix = 'Declare it in contracts/analytics.json collects (references/store-declarations.md), then update App Store Connect and Play Console.';
  for (const [dataType, why] of required(repo, names)) {
    if (!declared.has(dataType)) report.problem({ file: repo.paths.contract, line, rule: 'declarations', message: `${dataType} is collected but not declared (${why})`, fix });
  }
  if (contract.identifies === true) {
    for (const entry of declared.values()) if (entry.linked !== true) report.problem({ file: repo.paths.contract, line, rule: 'declarations', message: `${entry.dataType} must be linked: events carry the account id`, fix: 'Set linked: true on every entry while identifies is true.' });
  }
}

/** manifest-wiring: app.config.ts declares collects in the privacy manifest and writes expo.extra.analytics. */
export function checkWiring(repo, report) {
  if (hasNoVendor(repo)) return;
  const config = repo.sources.find((source) => /^app\.config\.[jt]s$/.test(source.rel));
  if (config === undefined) {
    const reason = notYetCreated(repo.root, { file: 'app.config.ts', owner: 'expo-project-bootstrap' });
    if (reason) report.skip({ file: 'app.config.ts', rule: 'manifest-wiring', message: reason });
    return;
  }
  const code = maskComments(config.text);
  const fix = 'Wire app.config.ts as examples/app-config-analytics.ts shows.';
  if (!/NSPrivacyCollectedDataTypes\s*:[^\n]*analyticsCollectedDataTypes\s*\(/.test(code) && !/NSPrivacyCollectedDataTypes\s*:\s*\[[^\]]*analyticsCollectedDataTypes\s*\(/.test(code)) {
    report.problem({ file: config.rel, line: 1, rule: 'manifest-wiring', message: 'ios.privacyManifests.NSPrivacyCollectedDataTypes does not come from analyticsCollectedDataTypes()', fix });
  }
  if (!/\banalyticsExtra\s*\(/.test(code)) report.problem({ file: config.rel, line: 1, rule: 'manifest-wiring', message: 'expo.extra does not come from analyticsExtra()', fix });
  // privacy-and-store-declarations owns the manifest: when its PRIVACY_MANIFESTS exists, the
  // analytics rows are added to it, never written instead of it (that drops the required-reason
  // APIs, and App Store Connect rejects the upload with ITMS-91053).
  const privacyManifest = `${repo.layout.configDir}/privacy-manifest.ts`;
  if (existsSync(join(repo.root, privacyManifest)) && !/\.\.\.\s*PRIVACY_MANIFESTS\b/.test(code)) {
    report.problem({ file: config.rel, line: 1, rule: 'manifest-wiring', message: `ios.privacyManifests does not spread PRIVACY_MANIFESTS (${privacyManifest}), so the required-reason APIs are dropped`, fix: 'Write privacyManifests: { ...PRIVACY_MANIFESTS, NSPrivacyCollectedDataTypes: [...analyticsCollectedDataTypes(projectRoot)] }.' });
  }
}

function collectKey(entry, typeKey) {
  const purposes = Array.isArray(entry.purposes) ? [...entry.purposes].sort().join('+') : '';
  return `${entry[typeKey]} linked=${entry.linked === true} tracking=${entry.tracking === true} purposes=${purposes}`;
}

/**
 * privacy-sync: contracts/analytics.json is the one source of the analytics SDK's collects; the
 * privacy contract (privacy-and-store-declarations) carries the same rows under sdks["<sdk>"].
 */
export function checkPrivacySync(repo, report) {
  const sdk = sdkName(repo);
  if (sdk === null || contractOf(repo) === null) return;
  const file = `${repo.layout.contractsDir}/privacy.json`;
  const reason = notYetCreated(repo.root, { file, owner: 'privacy-and-store-declarations' });
  if (reason) return report.skip({ file, rule: 'privacy-sync', message: reason });
  const fix = `Copy every collects entry of ${repo.paths.contract} into ${file} sdks["${sdk}"].collects as { "type": <dataType>, "linked", "tracking", "purposes", "optional": true } (references/store-declarations.md).`;
  let privacy;
  try {
    privacy = JSON.parse(readFileSync(join(repo.root, file), 'utf8'));
  } catch (error) {
    return report.problem({ file, line: 1, rule: 'privacy-sync', message: `does not parse: ${error instanceof Error ? error.message : String(error)}`, fix });
  }
  const text = readFileSync(join(repo.root, file), 'utf8');
  const at = text.indexOf(`"${sdk}"`);
  const line = at === -1 ? 1 : lineAt(text, at);
  const entry = privacy?.sdks?.[sdk];
  if (!entry || typeof entry !== 'object') return report.problem({ file, line, rule: 'privacy-sync', message: `sdks has no "${sdk}" entry although ${repo.paths.contract} declares it`, fix });
  const theirs = new Set((Array.isArray(entry.collects) ? entry.collects : []).filter((c) => c && typeof c === 'object').map((c) => collectKey(c, 'type')));
  const ours = new Set(collects(repo).map((c) => collectKey(c, 'dataType')));
  for (const key of ours) if (!theirs.has(key)) report.problem({ file, line, rule: 'privacy-sync', message: `sdks["${sdk}"].collects lacks ${key}`, fix });
  for (const key of theirs) if (!ours.has(key)) report.problem({ file, line, rule: 'privacy-sync', message: `sdks["${sdk}"].collects has ${key}, which ${repo.paths.contract} does not declare`, fix: `Declare it in ${repo.paths.contract} collects first (the source), then copy.` });
  if (contractOf(repo).tracking !== (entry.tracking === true)) report.problem({ file, line, rule: 'privacy-sync', message: `sdks["${sdk}"].tracking differs from ${repo.paths.contract} tracking`, fix: 'Set the same tracking value in both contracts.' });
}

/** key-literal: no project key typed in code, no EXPO_PUBLIC_ANALYTICS_*, env read only in config. */
export function checkKeys(repo, report) {
  const configDir = `${repo.layout.configDir}/`;
  for (const source of repo.sources) {
    if (source.isTest) continue;
    for (const { name, pattern } of FACTS.keyPatterns) {
      const match = new RegExp(pattern).exec(source.text);
      if (match) report.problem({ file: source.rel, line: lineAt(source.text, match.index), rule: 'key-literal', message: `${name} is typed in code`, fix: 'Set ANALYTICS_KEY in the EAS environment of the build profile; app.config.ts writes it to expo.extra.' });
    }
    const code = maskComments(source.text);
    const inlined = /EXPO_PUBLIC_ANALYTICS_\w*/.exec(code);
    if (inlined) report.problem({ file: source.rel, line: lineAt(code, inlined.index), rule: 'key-literal', message: `${inlined[0]} is inlined into the bundle`, fix: 'Use ANALYTICS_KEY / ANALYTICS_HOST / ANALYTICS_MODE through analyticsExtra() and readAnalyticsExtra().' });
    const env = /process\.env(\.|\[['"])ANALYTICS_\w*/.exec(code);
    if (env && !source.rel.startsWith(configDir) && !/^app\.config\.[jt]s$/.test(source.rel)) report.problem({ file: source.rel, line: lineAt(code, env.index), rule: 'key-literal', message: 'reads ANALYTICS_* from process.env outside app.config.ts', fix: 'Read the build values with readAnalyticsExtra(Constants.expoConfig?.extra, applicationId).' });
  }
}

const ADS_CONSENT = /\b(canRequestAds|isPrivacyOptionsRequired|showFormIfRequired|showPrivacyOptions|requestTracking|consentInfo|ConsentInfo|AdsConsent|getConsentInfo|gatherConsent)\b/;

const GRANTED_LITERAL = /^\s*(['"`])granted\1\s*(as\s+const\s*)?$/;
const NO_USER_HOOKS = /(?<![\w$.])(useEffect|useLayoutEffect|useInsertionEffect|useFocusEffect|useMemo|useState|useReducer)\s*(<[^()]*>)?\s*\(\s*(async\s*)?$/;

/** Where an expression-bodied arrow ends: the first unmatched closer, or a , or ; at its depth. */
function expressionEnd(masked, from) {
  let depth = 0;
  for (let k = from; k < masked.length; k += 1) {
    const c = masked[k];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return k;
      depth -= 1;
    } else if (depth === 0 && (c === ',' || c === ';')) return k;
  }
  return masked.length;
}

/** The innermost function around `index`: { name, start } (start: where the function expression begins), or null at module scope. */
function enclosingFunction(source, index) {
  let best = null;
  for (const fn of functionsOf(scanSource(source.text))) {
    let inside;
    if (fn.bodyStart !== -1) inside = index > fn.bodyStart && index < fn.bodyEnd;
    else {
      const arrow = source.masked.indexOf('=>', fn.index);
      inside = arrow !== -1 && arrow < index && index < expressionEnd(source.masked, arrow + 2);
    }
    if (inside && (best === null || fn.index > best.index)) best = fn;
  }
  if (best === null) return null;
  const head = source.masked.slice(Math.max(0, best.index - 200), best.index);
  const keyword = best.kind === 'function' ? /(async\s+)?function\b[^()]*$/.exec(head) : /(async\s*)?(<[^()]*>\s*)?$/.exec(head);
  return { name: best.name, start: best.index - (keyword?.[0].length ?? 0) };
}

/**
 * The `.setConsent(` calls on the AnalyticsPort: the receiver's last name is `analytics`
 * (`analytics.setConsent(`, `useServices().analytics.setConsent(`, `services.analytics?.setConsent(`).
 * Other ports have a member of the same name (crash-reporting-and-observability's
 * `crashReporter.setConsent(isGranted)`), and their calls answer another question.
 */
function analyticsConsentCalls(masked) {
  return [...masked.matchAll(/\.setConsent\s*\(/g)].filter((match) => {
    const name = receiverName(masked, match.index);
    return name !== null && /analytics$/i.test(name);
  });
}

/**
 * The last name of the receiver before `.setConsent(` at `dot`: `analytics` for `services.analytics.`,
 * and the callee for a call result (`createAppAnalytics(errorLog, now).setConsent(`), so a gate built
 * and granted in one expression still counts as an analytics call.
 */
function receiverName(masked, dot) {
  let end = dot;
  while (end > 0 && /[\s?]/.test(masked[end - 1])) end -= 1;
  if (masked[end - 1] === ')') {
    let depth = 0;
    let k = end - 1;
    for (; k >= 0; k -= 1) {
      if (masked[k] === ')') depth += 1;
      else if (masked[k] === '(') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (k < 0) return null;
    end = k;
    while (end > 0 && /[\s?.]/.test(masked[end - 1]) && masked[end - 1] !== '.') end -= 1;
  }
  const receiver = /([\w$]+)$/.exec(masked.slice(Math.max(0, end - 80), end));
  return receiver === null ? null : receiver[1];
}

/** Why a literal setConsent('granted') at `index` is not a user's answer, or null when it sits in a handler. */
function autoGrantWhere(repo, source, index) {
  if (source.rel.startsWith(`${repo.layout.servicesDir}/`)) return `in ${source.rel === repo.paths.compositionRoot ? 'the composition root' : 'a service'}, where no user acts`;
  const fn = enclosingFunction(source, index);
  if (fn === null) return 'at module scope (runs at import)';
  const hook = NO_USER_HOOKS.exec(source.masked.slice(Math.max(0, fn.start - 120), fn.start));
  if (hook) return `in a ${hook[1]} callback (runs without a tap)`;
  if (/^(use[A-Z0-9][\w$]*|[A-Z][\w$]*)$/.test(fn.name)) return `directly in the body of ${fn.name} (runs on render)`;
  return null;
}

/**
 * consent-source: the analytics answer comes from the user's choice in the usage-data prompt or
 * row, never from Google's ads consent (UMP) or the ATT answer, and never from the app itself.
 * Flags a setConsent() call whose argument reads ads or tracking consent, and a literal
 * setConsent('granted') outside a handler: in src/services/ (the composition root included), at
 * module scope, directly in a component or hook body, or in an effect, memo or state initializer.
 * A value passed through another variable or a helper first is not followed (consent-gate.md).
 */
export function checkConsentSource(repo, report) {
  for (const source of repo.sources) {
    if (source.isTest) continue;
    for (const match of analyticsConsentCalls(source.masked)) {
      const argument = maskComments(balancedParens(source.text, match.index + match[0].length - 1) ?? '');
      const line = lineAt(source.text, match.index);
      const word = ADS_CONSENT.exec(argument)?.[1];
      if (word) report.problem({ file: source.rel, line, rule: 'consent-source', message: `setConsent() derives the analytics answer from ${word} (ads or tracking consent)`, fix: "Ask the analytics question on its own (the usage-data prompt and row) and pass the user's answer; UMP asks for Google's ad vendors, not the app's analytics vendor." });
      if (!GRANTED_LITERAL.test(argument)) continue;
      const where = autoGrantWhere(repo, source, match.index);
      if (where) report.problem({ file: source.rel, line, rule: 'consent-source', message: `setConsent('granted') ${where}: the app answers for the user`, fix: "Call setConsent only from the handler of the user's tap (onShare, onToggle in the usage-data model); the state stays 'unknown' until then." });
    }
  }
}

/** consent-ui: some screen lets the user answer and change the analytics question. */
export function checkConsentUi(repo, report) {
  if (hasNoVendor(repo)) return;
  const services = `${repo.layout.servicesDir}/`;
  const found = repo.sources.some((source) => !source.isTest && !source.rel.startsWith(services) && analyticsConsentCalls(source.masked).length > 0);
  if (!found) report.problem({ file: repo.paths.analyticsDir, line: 1, rule: 'consent-ui', message: 'no screen calls analytics.setConsent(): the user can neither say yes nor withdraw', fix: 'Add the opt-in prompt and the settings row (examples/use-usage-data-model.ts, examples/usage-data-prompt.tsx).' });
}

/**
 * True when the contract says sdk: "none": the app has the port, the catalog and the gate but no
 * vendor yet, so nothing can leave the device. The build wiring (manifest-wiring) and the consent
 * question (consent-ui) are written together with the vendor; check-analytics prints a note instead.
 */
export function hasNoVendor(repo) {
  return contractOf(repo)?.sdk === 'none';
}

/**
 * root-kit: the one AnalyticsPort reaches the app through the analytics root kit (app-startup-and-
 * bootstrap's slots): the registry that creates it also registers createAnalyticsKit, so features get
 * useAnalytics(), screen views are sent and queued events flush on the way to the background.
 */
export function checkRootKit(repo, report) {
  const root = repo.sources.find((source) => !source.isTest && source.rel === repo.paths.compositionRoot);
  const kitFile = `${repo.paths.analyticsDir}/analytics-root-kit.tsx`;
  const definesKit = repo.sources.some((source) => !source.isTest && /export\s+function\s+createAnalyticsKit\b/.test(source.masked));
  const creates = root !== undefined && createAnalyticsSpans(root).length > 0;
  const registers = root !== undefined && /(?<![\w$.])createAnalyticsKit\s*\(/.test(maskComments(root.text));
  if (!definesKit) {
    report.problem({ file: kitFile, line: 1, rule: 'root-kit', message: 'no analytics root kit: the port reaches no screen, no screen view is sent and nothing flushes on the way to the background', fix: 'Copy templates/src/services/analytics/analytics-root-kit.tsx and analytics-context.tsx (+ tests), and register createAnalyticsKit in src/services/create-root-kits.ts.' });
    return;
  }
  if (!registers) {
    report.problem({ file: repo.paths.compositionRoot, line: 1, rule: 'root-kit', message: creates ? 'the registry creates the AnalyticsPort but never registers createAnalyticsKit, so useAnalytics() throws and no screen view is sent' : 'the analytics root kit is never registered in the root-kit registry', fix: `Add createAnalyticsKit({ analytics, errorLog: data.errorLog }) to the list createRootKits returns in ${repo.paths.compositionRoot}; the root files stay unchanged.` });
  }
}

/** The fingerprint of what the consent question covers: the SDK, its endpoints and every collects row. */
export function consentFingerprint(contract) {
  const rows = (Array.isArray(contract?.collects) ? contract.collects : [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ dataType: entry.dataType, linked: entry.linked === true, tracking: entry.tracking === true, purposes: [...(Array.isArray(entry.purposes) ? entry.purposes : [])].sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const endpoints = [...(Array.isArray(contract?.endpoints) ? contract.endpoints : [])].sort();
  return createHash('sha256').update(JSON.stringify({ sdk: contract?.sdk ?? null, endpoints, collects: rows })).digest('hex').slice(0, 12);
}

/**
 * consent-covers: the consent question's version moves with what it covers. contracts/analytics.json
 * "consent" holds { version, covers }: covers is the fingerprint of sdk, endpoints and collects when the
 * version was set, and version equals ANALYTICS_CONSENT_VERSION in the codec. A changed fingerprint means
 * the collection changed without a new question; the checker cannot know whether the version was raised
 * (it has no history), so the fix says to raise both and record the new fingerprint, and the contract is a
 * gated path the reviewer sees.
 */
export function checkConsentCovers(repo, report) {
  const contract = contractOf(repo);
  if (contract === null || sdkName(repo) === null) return;
  const file = repo.paths.contract;
  const line = contractLine(repo, 'consent');
  const expected = consentFingerprint(contract);
  const consent = contract.consent;
  if (!consent || typeof consent !== 'object' || !Number.isInteger(consent.version) || typeof consent.covers !== 'string') {
    return report.problem({ file, line, rule: 'consent-covers', message: 'the contract has no "consent": { "version", "covers" }, so a change to sdk, endpoints or collects cannot be tied to a new consent question', fix: `Add "consent": { "version": <ANALYTICS_CONSENT_VERSION>, "covers": "${expected}" } (the fingerprint of sdk, endpoints and collects).` });
  }
  const codec = repo.sources.find((source) => !source.isTest && source.rel.endsWith('/analytics/analytics-consent.ts'));
  const declared = codec ? /export\s+const\s+ANALYTICS_CONSENT_VERSION\s*=\s*(\d+)\b/.exec(codec.masked) : null;
  if (declared && Number(declared[1]) !== consent.version) report.problem({ file: codec.rel, line: lineAt(codec.text, declared.index), rule: 'consent-covers', message: `ANALYTICS_CONSENT_VERSION is ${declared[1]}, but contracts/analytics.json consent.version is ${consent.version}`, fix: 'Keep the two equal: the codec asks again for every answer older than its version, and the contract records which collection that version covers.' });
  if (consent.covers !== expected) report.problem({ file, line, rule: 'consent-covers', message: `sdk, endpoints or collects changed since consent version ${consent.version} was set (covers ${consent.covers}, now ${expected})`, fix: `The user said yes to the old collection: raise ANALYTICS_CONSENT_VERSION (src/services/analytics/analytics-consent.ts) and consent.version to ${consent.version + 1}, then set consent.covers to "${expected}". Every earlier answer then reads as unknown and the prompt asks again before the new collection starts.` });
}
