// check-deep-links.mjs: proves an Expo Router app's incoming links are safe and complete. One gate
// (+native-intent) decides every custom-scheme, universal and App Link, cold start and warm; it
// opens only allow-listed routes with checked values (the checker replays hostile URLs through the
// app's own gate); verified hosts agree between the contract, the app config of every variant and
// the well-known files; nothing else listens to links or forwards a link's text to the outside.
// Zero dependencies: node: built-ins and the synced check-lib.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { UsageError, createReporter, lineOf, maskComments, parseArgs, requireDir, requireFile, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { enableAppImports, reasonOf } from './lib/app-modules.mjs';
import {
  VARIANTS, appLinkFilterHosts, evaluateAllVariants, expectedWellKnown, filterData, findAppConfig, hostFolder, linkPaths,
  originsOf, parseAppLink, readContract, routeIdUrl, routeUrls, sameJson,
} from './lib/link-facts.mjs';
import { placeholderProblem, placeholdersIn } from './lib/ship-placeholders.mjs';
import { isTestFile, matchBracket, resolveImport, scanSource } from './lib/source-scan.mjs';

const RULES = [
  ['intent-gate', 'src/app/+native-intent exports redirectSystemPath, which decides through routeIncomingLink and never returns its input unchecked'],
  ['intent-total', 'the module that defines redirectSystemPath is synchronous (no async, await, then, fetch) and converts a throw (attempt or try/catch)'],
  ['one-listener', 'no app code subscribes to links itself (Linking url listener, getInitialURL, getLinkingURL, useLinkingURL, useURL, legacy_subscribe)'],
  ['open-redirect', "no app code hands a value derived from useLocalSearchParams or useGlobalSearchParams (the object, a destructured name, any binding computed from them in the same file) to Linking.openURL, openBrowserAsync or openAuthSessionAsync, except as the argument of a URL builder imported from src/config"],
  ['link-routes', 'the allow-list (LINK_ROUTES) loads in Node and is sound: URL paths, a known kind per dynamic segment, plain query keys, query any only for test builds, open() for gated routes, no duplicates'],
  ['link-route-exists', 'every allow-listed path is a route file of the routes folder'],
  ['link-test-only', 'debug routes (navigation contract debugRoutes, /debug/...) are testBuildOnly'],
  ['link-secret', 'a route whose query or params carry a secret (a name with the word token, secret, password, otp, magic or session, or api key, reset code, auth code; on an auth path such as /reset-password, code or a name ending in code; names ending in Id are ids) is verifiedOnly'],
  ['pending-link', 'every gate a link route waits for is reported by useLinkGate and opened by useOpenPendingLink'],
  ['gate-behaviour', "the app's routeIncomingLink, replayed with the production policy, opens each listed route, refuses hostile URLs and never throws"],
  ['link-contract', 'contracts/deep-links.json is valid: bare hosts per variant, web paths, appleTeamId and certificate fingerprints for every variant with hosts'],
  ['native-links', 'for every variant the app config has exactly the contract hosts: applinks:<host> entries and one verified App Links filter (autoVerify, VIEW, BROWSABLE, DEFAULT, http/https only, a pathPattern per web path); a variant without hosts has no associatedDomains key at all'],
  ['web-paths', 'every web path opens a listed route, and every verifiedOnly route is reachable from a web path'],
  ['well-known', 'each host has an apple-app-site-association and assetlinks.json equal to what write-well-known.mjs writes, and no stale host folder'],
];

const SPEC = {
  name: 'check-deep-links',
  summary: 'Checks the incoming-link gate, the link allow-list, verified hosts (associatedDomains, App Links filters, AASA, assetlinks) and link hygiene of an Expo Router app.',
  usage: '[repo-root] [options]',
  options: {
    release: { type: 'boolean', help: 'Also fail on placeholder hosts, team ids and bundle ids (example.com, com.example.*, __TOKEN__)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    ...RULES.map(([id, text]) => `  ${id.padEnd(18)} ${text}`),
    '  ship-placeholder   (--release) a placeholder host, team id or production bundle id',
    '',
    'NOT APPLICABLE when expo-router is not in package.json, or when the app takes no input from links',
    '(no +native-intent, no contracts/deep-links.json, no allow-list, no associatedDomains or App Links',
    'filter, no dynamic route, no search-params hook, and no route other than / while a scheme or host',
    'is registered: Expo Router opens every route file for a link); one-listener and open-redirect run first.',
    'The app config is evaluated for development, preview and production (APP_VARIANT and',
    'EXPO_PUBLIC_APP_VARIANT set) the way Expo evaluates it. rn-skills.config.json may move the files:',
    '  "deepLinks": { "routesModule": "src/features/deep-links/link-routes.ts",',
    '                 "gateModule": "src/core/links/route-incoming-link.ts", "contract": "contracts/deep-links.json" }',
    'Tests, __mocks__/ and test/ are not scanned; installed skills (folders holding a SKILL.md, .agents/, skills/) are left out.',
    'When multi-package: run once per app, with the app folder as the root.',
    'Example: node check-deep-links.mjs . --release',
  ].join('\n'),
};

const SECRET_WORDS = new Set(['token', 'secret', 'password', 'passwd', 'otp', 'magic', 'session']);
const SECRET_PAIRS = ['api key', 'reset code', 'auth code'];

/**
 * Whether a param or query key names a secret, word by word (camelCase, snake_case, kebab-case):
 * sessionToken, otp, otpCode, reset_code, apiKey are secrets; sessionId, tokenId (an id naming a record),
 * footprint and adoptionDate are not.
 */
function isSecretName(name) {
  const words = (String(name).match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((word) => word.toLowerCase());
  if (words.length === 0 || words.at(-1) === 'id' || words.at(-1) === 'ids') return false;
  const joined = ` ${words.join(' ')} `;
  return words.some((word) => SECRET_WORDS.has(word)) || SECRET_PAIRS.some((pair) => joined.includes(` ${pair} `));
}
const STATIC_SEGMENT = /^[a-z0-9][a-z0-9._~-]*$/;
const DYNAMIC_SEGMENT = /^\[([a-z][A-Za-z0-9]*)\]$/;
const QUERY_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const WEB_PATH = /^\/(([a-z0-9-]+\/)*([a-z0-9-]+|\*))?$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const APPLINK_ENTRY = /^applinks:(\*\.)?[a-z0-9.-]+(\?mode=(developer|managed|developer\+managed))?$/;
const AASA_LIMIT = 128 * 1024;
const SAMPLE = { slug: 'link-check-1', uuid: '0b6f4a8e-7c1d-4e2f-9a3b-5c6d7e8f9a0b', int: '42' };
const DEFAULT_KINDS = ['slug', 'uuid', 'int'];

const AUTH_PATH_WORDS = new Set(['reset', 'recover', 'recovery', 'password', 'verify', 'verification', 'confirm', 'magic', 'login', 'signin', 'sign', 'auth', 'invite', 'activate']);
const EVERYDAY_CODES = new Set(['country', 'currency', 'language', 'locale', 'postal', 'zip', 'area', 'color', 'colour', 'promo', 'discount', 'coupon', 'qr', 'bar']);

/**
 * On a route whose path names an auth step (/reset-password, /verify-email, /auth/callback), a bare
 * `code` or a name ending in the word code (oobCode, verificationCode, confirmationCode) is the
 * one-time code an auth provider sends, so a secret; everyday codes (countryCode, currencyCode,
 * postalCode, promoCode) stay exempt.
 */
function isAuthCode(name, path) {
  const words = (String(name).match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((word) => word.toLowerCase());
  if (words.at(-1) !== 'code' || (words.length > 1 && EVERYDAY_CODES.has(words.at(-2)))) return false;
  const pathWords = String(path).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return pathWords.some((word) => AUTH_PATH_WORDS.has(word));
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

function readManifest(root) {
  try {
    return JSON.parse(read(root, 'package.json'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix package.json.');
  }
}

/** App code under the source folder, tests left out: [{ rel, raw, masked }]. */
function appSources(root, layout) {
  const prefix = `${layout.srcDir}/`;
  return walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'] })
    .filter((rel) => rel.startsWith(prefix) && !isTestFile(rel) && !rel.endsWith('.d.ts'))
    .map((rel) => {
      const raw = read(root, rel);
      return { rel, raw, masked: maskComments(raw) };
    });
}

// ---------------------------------------------------------------------------------------------
// Rules on all app code
// ---------------------------------------------------------------------------------------------

const LISTENER_PATTERNS = [
  [/\baddEventListener\s*\(\s*['"`]url['"`]/g, "a 'url' listener"],
  [/\bgetInitialURL\s*\(/g, 'getInitialURL()'],
  [/\bgetLinkingURL\s*\(/g, 'getLinkingURL()'],
  [/\buseLinkingURL\s*\(/g, 'useLinkingURL()'],
  [/\buseURL\s*\(/g, 'useURL()'],
  [/\bparseInitialURLAsync\s*\(/g, 'parseInitialURLAsync()'],
  [/\blegacy_subscribe\b/g, 'legacy_subscribe'],
];

function checkOneListener(sources, report) {
  for (const { rel, raw, masked } of sources) {
    for (const [pattern, what] of LISTENER_PATTERNS) {
      for (const match of masked.matchAll(pattern)) {
        report.problem({
          file: rel, line: lineOf(raw, match.index), rule: 'one-listener',
          message: `${what}: Expo Router already delivers every link (cold start and warm) through +native-intent; a second handler navigates twice or opens what the gate refused`,
          fix: 'Delete it and add the route to LINK_ROUTES; read params with useLocalSearchParams() in the screen model and parse them.',
        });
      }
    }
  }
}

const OPENERS = /\b(openURL|openBrowserAsync|openAuthSessionAsync)\s*\(/g;
const IDENT_NAME = /^[A-Za-z_$][\w$]*$/;
const PARAMS_HOOK = /use(?:Local|Global)SearchParams\b/;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names a destructuring pattern binds: '{ a, b: c, d = 1, ...rest }' -> [a, c, d, rest]. */
function boundNames(pattern) {
  const names = [];
  for (const part of pattern.split(',')) {
    const item = part.trim().replace(/^\.\.\./, '');
    if (item === '') continue;
    const target = (item.includes(':') ? item.slice(item.indexOf(':') + 1) : item).split('=')[0].trim();
    if (IDENT_NAME.test(target)) names.push(target);
  }
  return names;
}

const CONTINUES_LINE = /^[?:.|&+\-*/%<>=]/;
const ENDS_OPEN = /(?:[?:|&+\-*/%<>=(,[{]|=>)$/;

/**
 * The end of the expression that starts at `from` in blanked code: the first `;` or `,` at depth 0, a
 * bracket that closes below it, or a line break at depth 0 that neither line continues (Prettier's
 * multi-line ternaries and chains start the next line with `?`, `:`, `.` or an operator).
 */
function expressionEnd(code, from, limit = 800) {
  let depth = 0;
  const stop = Math.min(code.length, from + limit);
  for (let at = from; at < stop; at += 1) {
    const c = code[at];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return at;
      depth -= 1;
    } else if (depth === 0 && (c === ';' || c === ',')) return at;
    else if (depth === 0 && c === '\n') {
      const before = code.slice(from, at).trimEnd();
      const after = code.slice(at + 1).trimStart();
      if (before !== '' && !ENDS_OPEN.test(before) && !CONTINUES_LINE.test(after)) return at;
    }
  }
  return stop;
}

const mentions = (names) => (names.size > 0 ? new RegExp(`(?<![\\w$.])(${[...names].map(escapeRe).join('|')})\\b`) : null);

/**
 * The identifiers of one file that hold a link's params: the object a search-params hook returns and
 * every binding whose first expression mentions the hook call or an identifier already held, followed
 * to a fixed point: `const { returnTo } = params`, `const target = search.url`, `String(raw.x)`,
 * `parseHelpParams(raw)` or `parseHelpParams(useLocalSearchParams())` (a valibot `v.url()` field still
 * passes any URL), `typeof params.next === 'string' ? params.next : ''`. Member chains of a held name
 * (`parsed.value.returnTo`) are caught where the opener reads them. `code` has comments and strings blanked.
 */
function linkParamNames(code, helpers = new Set()) {
  const tainted = new Set();
  // `const webUrl = taskWebUrl(taskId)` with a src/config helper builds the URL from the app's own
  // origin: the binding is as safe as the inline `openURL(taskWebUrl(taskId))` form.
  const isHelperCall = (rhs) => {
    const call = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rhs);
    return call !== null && helpers.has(call[1]) && matchBracket(rhs, rhs.indexOf('(')) === rhs.trimEnd().length - 1;
  };
  const binding = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^{}]*\})\s*(?::[^=;]*)?=\s*/g;
  const bindings = [...code.matchAll(binding)].map((match) => {
    const start = match.index + match[0].length;
    return { target: match[1], rhs: code.slice(start, expressionEnd(code, start)) };
  });
  const namesOf = (target) => (target.startsWith('{') ? boundNames(target.slice(1, -1)) : [target]);
  for (let round = 0; round < 12; round += 1) {
    const before = tainted.size;
    const held = mentions(tainted);
    for (const { target, rhs } of bindings) {
      if (isHelperCall(rhs)) continue;
      if (PARAMS_HOOK.test(rhs) || held?.test(rhs)) namesOf(target).forEach((name) => tainted.add(name));
    }
    if (tainted.size === before) break;
  }
  return tainted;
}

/**
 * Names imported from the app's config folder ('@/config/links', '../config/links'): helpers that build
 * a URL from the app's own origin (`openURL(taskWebUrl(id))`), which open-redirect accepts.
 */
function configHelpers(code, raw) {
  const helpers = new Set();
  for (const match of code.matchAll(/\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*/g)) {
    const spec = /^['"]([^'"]+)['"]/.exec(raw.slice(match.index + match[0].length))?.[1] ?? '';
    if (!/(^|\/)config(\/|$)/.test(spec)) continue;
    for (const name of boundNames(match[1].replace(/\bas\b/g, ':'))) helpers.add(name);
  }
  return helpers;
}

function checkOpenRedirect(sources, report) {
  for (const { rel, raw } of sources) {
    if (!PARAMS_HOOK.test(raw)) continue;
    const { code } = scanSource(raw);
    const helpers = configHelpers(code, raw);
    const refersToParams = mentions(linkParamNames(code, helpers));
    for (const match of code.matchAll(OPENERS)) {
      const open = match.index + match[0].length - 1;
      const close = matchBracket(code, open);
      const argument = code.slice(open + 1, close === -1 ? open + 200 : close);
      if (!PARAMS_HOOK.test(argument) && !refersToParams?.test(argument)) continue;
      const builder = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(argument);
      if (builder && helpers.has(builder[1]) && matchBracket(argument, argument.indexOf('(')) === argument.trimEnd().length - 1) continue;
      report.problem({
        file: rel, line: lineOf(raw, match.index), rule: 'open-redirect',
        message: `${match[1]}() opens a URL taken from a link's params: anyone can send the app a link that opens any site (an open redirect, phishing with the app's trust)`,
        fix: 'Open only URLs the app builds itself (src/config); a link carries an id, never a URL.',
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

/** The module that defines redirectSystemPath: the intent file or the one it re-exports from. */
function definingModule(root, layout, intentRel, intentSource) {
  const reexport = /export\s*\{[^}]*\bredirectSystemPath\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/.exec(intentSource);
  if (reexport) {
    const target = resolveImport(intentRel, reexport[1], { root, aliases: layout.aliases });
    return target.exists ? { rel: target.path, source: read(root, target.path) } : { rel: null, missing: reexport[1] };
  }
  if (/export\s+(async\s+)?(function|const|let)\s+redirectSystemPath\b/.test(intentSource)) return { rel: intentRel, source: intentSource };
  return null;
}

function checkIntent(root, layout, paths, report) {
  const intentRel = paths.intentCandidates.find((rel) => isFile(join(root, rel)));
  const fix = 'Copy templates/src/app/+native-intent.tsx and templates/src/features/deep-links/ (redirectSystemPath over routeIncomingLink).';
  if (!intentRel) {
    report.problem({ file: paths.intentCandidates[0], rule: 'intent-gate', message: 'no +native-intent: Expo Router opens any incoming link as it is, any route with any params', fix });
    return;
  }
  const intentSource = read(root, intentRel);
  const module = definingModule(root, layout, intentRel, maskComments(intentSource));
  if (module === null || module.rel === null) {
    const message = module === null ? 'exports no redirectSystemPath, so no link passes a gate' : `re-exports redirectSystemPath from ${module.missing}, which does not exist`;
    report.problem({ file: intentRel, line: 1, rule: 'intent-gate', message, fix });
    return;
  }
  const masked = maskComments(module.source);
  if (!/\brouteIncomingLink\s*\(/.test(masked)) {
    report.problem({ file: module.rel, line: 1, rule: 'intent-gate', message: 'redirectSystemPath does not decide through routeIncomingLink: links open without the allow-list', fix });
  }
  // Any return whose expression mentions a `path` (bare, event.path, decision.path), whole or in a branch
  // (`return event.initial ? LINK_FALLBACK : event.path`). Concise arrow bodies are not seen (checker.md).
  const blanked = scanSource(module.source).code;
  for (const match of blanked.matchAll(/\breturn\b/g)) {
    const from = match.index + match[0].length;
    const expression = blanked.slice(from, expressionEnd(blanked, from));
    // A returned function (the factory's `return (event) => {...}`) is judged by its own returns, and
    // what routeIncomingLink(...) is given is the input of the gate, not its answer.
    if (/^\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/.test(expression)) continue;
    let answer = expression;
    for (const call of expression.matchAll(/\brouteIncomingLink\s*\(/g)) {
      const open = call.index + call[0].length - 1;
      const close = matchBracket(expression, open);
      if (close !== -1) answer = answer.slice(0, open + 1) + ' '.repeat(close - open - 1) + answer.slice(close);
    }
    if (!/(?<![\w$])path\b/.test(answer)) continue;
    report.problem({ file: module.rel, line: lineOf(module.source, match.index), rule: 'intent-gate', message: 'returns the incoming path unchecked: that link opens whatever it names', fix: 'Return only the href routeIncomingLink decided, LINK_FALLBACK on a cold start, or null.' });
  }
  for (const match of masked.matchAll(/\b(async|await)\b|\.then\s*\(|\bfetch\s*\(/g)) {
    report.problem({ file: module.rel, line: lineOf(module.source, match.index), rule: 'intent-total', message: `${match[0].trim()} in the gate: a slow answer holds the first screen and a rejection is an unhandled error with the link lost`, fix: 'Keep the decision synchronous; resolve a short link in a landing route that replaces itself.' });
  }
  if (!/\battempt\s*\(/.test(masked) && !/\btry\s*\{/.test(masked)) {
    report.problem({ file: module.rel, line: 1, rule: 'intent-total', message: 'a throw in redirectSystemPath crashes the launch (expo-router does not catch it)', fix: 'Wrap the decision in attempt(...) and report the error (templates/src/features/deep-links/redirect-system-path.ts).' });
  }
}

// ---------------------------------------------------------------------------------------------
// The allow-list
// ---------------------------------------------------------------------------------------------

function entryLine(source, path) {
  const index = source.search(new RegExp(`path:\\s*['"\`]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`));
  return index < 0 ? 1 : lineOf(source, index);
}

async function loadModule(app, rel) {
  try {
    return { module: await app.load(rel) };
  } catch (error) {
    return { error: reasonOf(error) };
  }
}

function entryProblems(entry, kinds) {
  const problems = [];
  if (typeof entry?.path !== 'string' || !entry.path.startsWith('/')) return ['path must be a string starting with /'];
  const named = new Set();
  for (const segment of entry.path.split('/').filter(Boolean)) {
    const dynamic = DYNAMIC_SEGMENT.exec(segment);
    if (!dynamic) {
      if (!STATIC_SEGMENT.test(segment)) problems.push(`segment "${segment}" is not a URL segment (no groups, catch-alls or capitals)`);
    } else if (!kinds.includes(entry.params?.[dynamic[1]])) {
      problems.push(`[${dynamic[1]}] needs a kind in params (${kinds.join(', ')})`);
    } else named.add(dynamic[1]);
  }
  for (const name of Object.keys(entry.params ?? {})) if (!named.has(name)) problems.push(`params.${name} is not a segment of the path`);
  for (const key of Array.isArray(entry.query) ? entry.query : []) if (named.has(key)) problems.push(`query key "${key}" shadows a path param: an unchecked query value would replace the checked segment value`);
  if (entry.query === 'any' && entry.testBuildOnly !== true) problems.push("query 'any' is for test-build routes only");
  if (entry.query !== undefined && entry.query !== 'any' && (!Array.isArray(entry.query) || entry.query.some((key) => !QUERY_KEY.test(key)))) problems.push('query must be a list of plain key names');
  if (entry.gate !== undefined && typeof entry.open !== 'function') problems.push(`gate "${entry.gate}" needs open() to reopen the link after the gate opens`);
  return problems;
}

async function loadTable(root, paths, app, report) {
  const rel = paths.routesModule;
  const fix = 'Copy templates/src/features/deep-links/link-routes.ts; keep it data and types only (it must load in Node).';
  if (!isFile(join(root, rel))) {
    report.problem({ file: rel, rule: 'link-routes', message: 'no link allow-list: the gate has nothing to open', fix });
    return null;
  }
  const loaded = await loadModule(app, rel);
  if (loaded.error) {
    report.problem({ file: rel, line: 1, rule: 'link-routes', message: `does not load in Node: ${loaded.error}`, fix });
    return null;
  }
  const routes = loaded.module.LINK_ROUTES;
  if (!Array.isArray(routes)) {
    report.problem({ file: rel, line: 1, rule: 'link-routes', message: 'exports no LINK_ROUTES array', fix });
    return null;
  }
  const kindsModule = await loadModule(app, `${dirname(paths.gateModule)}/link-route.ts`);
  const kinds = kindsModule.module?.PARAM_KINDS ? Object.keys(kindsModule.module.PARAM_KINDS) : DEFAULT_KINDS;
  const source = read(root, rel);
  const seen = new Set();
  for (const entry of routes) {
    const line = entryLine(source, String(entry?.path));
    if (seen.has(entry?.path)) report.problem({ file: rel, line, rule: 'link-routes', message: `${entry.path} is listed twice`, fix: 'Keep one entry per path.' });
    seen.add(entry?.path);
    for (const problem of entryProblems(entry, kinds)) report.problem({ file: rel, line, rule: 'link-routes', message: `${entry?.path}: ${problem}`, fix: 'Fix the entry (references/link-routing.md, "The allow-list").' });
  }
  return { rel, source, routes, kinds };
}

function checkTable(root, layout, table, sources, report) {
  const { rel, source, routes } = table;
  const urls = routeUrls(root, layout.routesDir);
  const navigation = readContract(root, `${layout.contractsDir}/navigation.json`);
  const debugUrls = new Set((navigation.data?.debugRoutes ?? []).map(routeIdUrl));
  for (const entry of routes) {
    if (typeof entry?.path !== 'string') continue;
    const line = entryLine(source, entry.path);
    if (!urls.some((route) => route.url === entry.path)) {
      report.problem({ file: rel, line, rule: 'link-route-exists', message: `no route file in ${layout.routesDir} opens ${entry.path}`, fix: 'Fix the path (groups are not part of a URL) or remove the entry.' });
    }
    if ((debugUrls.has(entry.path) || entry.path === '/debug' || entry.path.startsWith('/debug/')) && entry.testBuildOnly !== true) {
      report.problem({ file: rel, line, rule: 'link-test-only', message: `${entry.path} is a debug route: a production link must not reach it`, fix: 'Add testBuildOnly: true (debug-menu-and-test-hooks keeps the screen out of production bundles too).' });
    }
    const names = [...(Array.isArray(entry.query) ? entry.query : []), ...Object.keys(entry.params ?? {})];
    const secret = names.find((name) => isSecretName(name) || isAuthCode(name, entry.path));
    if (secret && entry.verifiedOnly !== true) {
      report.problem({ file: rel, line, rule: 'link-secret', message: `${entry.path} carries "${secret}" on a link any app can receive: another app can register the custom scheme and read it`, fix: 'Mark it verifiedOnly: true and send it only as an https link of a verified host (single-use, short-lived, confirmed on screen).' });
    }
  }
  for (const gate of new Set(routes.map((entry) => entry?.gate).filter((gate) => typeof gate === 'string'))) {
    const quoted = `['"\`]${gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`;
    const line = lineOf(source, Math.max(0, source.indexOf(gate)));
    for (const [hook, why] of [['useLinkGate', 'nobody reports the gate open, so its links always wait'], ['useOpenPendingLink', 'nobody opens a link that waited, so it is lost']]) {
      if (!sources.some((file) => new RegExp(`\\b${hook}\\s*\\(\\s*${quoted}`).test(file.masked))) {
        report.problem({ file: rel, line, rule: 'pending-link', message: `gate "${gate}": no ${hook}('${gate}') in app code: ${why}`, fix: `Call ${hook}('${gate}'${hook === 'useLinkGate' ? ', isOpen' : ''}) from ${hook === 'useLinkGate' ? 'the component that owns the guard' : "the first screen's model behind the guard"}.` });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// gate-behaviour: hostile URLs through the app's own gate
// ---------------------------------------------------------------------------------------------

/** The path with a sample value per dynamic segment ('/tasks/link-check-1'), or null for an unknown kind. */
function samplePath(entry, override = null) {
  const parts = entry.path.split('/').map((segment) => {
    const dynamic = DYNAMIC_SEGMENT.exec(segment);
    if (!dynamic) return segment;
    return override ?? SAMPLE[entry.params?.[dynamic[1]]] ?? null;
  });
  return parts.includes(null) ? null : parts.join('/');
}

function scenarios(routes, origins) {
  const scheme = origins.schemes[0] ?? 'app';
  const host = origins.hosts.find((item) => !item.startsWith('*.')) ?? null;
  const list = [{ url: `${scheme}://`, expect: 'home' }];
  const first = routes.find((entry) => !entry.path.includes('[') && entry.path !== '/') ?? routes[0];
  const firstPath = first ? samplePath(first) ?? '/tasks' : '/tasks';
  for (const entry of routes) {
    const path = samplePath(entry);
    if (path === null || path === '/') continue;
    const keys = Array.isArray(entry.query) ? entry.query : [];
    const query = keys.length > 0 ? `?${keys[0]}=a%26b&utm_source=link-check` : '?utm_source=link-check';
    const href = `${path}${keys.length > 0 ? `?${keys[0]}=a%26b` : ''}`;
    const viaScheme = `${scheme}://${path.slice(1)}${query}`;
    if (entry.testBuildOnly === true) {
      list.push({ url: viaScheme, expect: 'refused', why: 'a test-build route in a production build' });
      list.push({ url: viaScheme, expect: 'open', href: entry.query === 'any' ? `${path}${query}` : href, testBuild: true });
    } else if (entry.verifiedOnly === true) {
      list.push({ url: viaScheme, expect: 'refused', why: 'a verifiedOnly route through the custom scheme' });
      if (host) list.push({ url: `https://${host}${path}${query}`, expect: 'open', href });
    } else if (typeof entry.gate === 'string') {
      list.push({ url: viaScheme, expect: 'deferred', why: 'a gated route while its gate is closed' });
      list.push({ url: viaScheme, expect: 'open', href, gateOpen: true });
    } else {
      list.push({ url: viaScheme, expect: 'open', href });
      if (keys.length > 0) {
        list.push({ url: `${scheme}://${path.slice(1)}?${keys[0]}=a&${keys[0]}=b`, expect: 'refused', why: 'a repeated query key' });
        list.push({ url: `${scheme}://${path.slice(1)}?${keys[0]}=a%0Ab`, expect: 'refused', why: 'a control character in a query value' });
      }
    }
    if (entry.path.includes('[') && entry.testBuildOnly !== true) {
      list.push({ url: `${scheme}://${samplePath(entry, '..%2Fsettings').slice(1)}`, expect: 'refused', why: 'an encoded ../ in a dynamic segment' });
      list.push({ url: `${scheme}://${samplePath(entry, '%E0%A4%A').slice(1)}`, expect: 'refused', why: 'malformed percent-encoding' });
    }
  }
  list.push(
    { url: `link-check-foreign://${firstPath.slice(1)}`, expect: 'refused', why: 'a scheme the app does not register' },
    { url: 'javascript:alert(1)', expect: 'refused', why: 'a javascript: URL' },
    { url: `https://link-check.invalid${firstPath}`, expect: 'refused', why: 'an https host the app does not verify' },
    { url: `${scheme}:///link-check-not-a-route/x`, expect: 'refused', why: 'a path no entry lists' },
    { url: `${scheme}:///${'a'.repeat(5000)}`, expect: 'refused', why: 'an over-long URL' },
  );
  if (host) {
    list.push(
      { url: `https://user:secret@${host}${firstPath}`, expect: 'refused', why: 'user info in the URL' },
      { url: `https://${host}:8443${firstPath}`, expect: 'refused', why: 'a port' },
      { url: `https://evil${host}${firstPath}`, expect: 'refused', why: 'a lookalike host that ends with a verified host' },
      { url: `https://${host}.link-check.invalid${firstPath}`, expect: 'refused', why: 'a lookalike host that starts with a verified host' },
    );
  }
  const wildcard = origins.hosts.find((item) => item.startsWith('*.'));
  if (wildcard) {
    list.push({ url: `https://evil${wildcard.slice(2)}${firstPath}`, expect: 'refused', why: `a lookalike host that ends with ${wildcard.slice(2)} without a dot before it` });
  }
  return list;
}

/** Deterministic junk (a seeded LCG): the gate must answer every string without throwing. */
function junk(count) {
  let state = 20261014;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  const alphabet = 'abc/:%?#&=.[]-_~!@$\'()*+,;\\ \u0000\u00e9\u{1f600}';
  return Array.from({ length: count }, () => Array.from({ length: next() % 60 }, () => alphabet[next() % alphabet.length]).join(''));
}

function describeDecision(decision) {
  if (!decision || typeof decision !== 'object') return String(decision);
  if (decision.kind === 'open') return `open ${decision.href}`;
  if (decision.kind === 'refused') return `refused (${decision.reason})`;
  return String(decision.kind);
}

async function checkGateBehaviour(root, paths, app, table, configs, report) {
  const rel = paths.gateModule;
  const fix = 'Use the template gate (templates/src/core/links/), or make the app gate refuse what the message names.';
  if (!isFile(join(root, rel))) {
    report.problem({ file: rel, rule: 'gate-behaviour', message: 'no routeIncomingLink module: the decision cannot be replayed', fix });
    return 0;
  }
  const loaded = await loadModule(app, rel);
  const decide = loaded.module?.routeIncomingLink;
  if (typeof decide !== 'function') {
    report.problem({ file: rel, line: 1, rule: 'gate-behaviour', message: loaded.error ? `does not load in Node: ${loaded.error}` : 'exports no routeIncomingLink function', fix });
    return 0;
  }
  const origins = originsOf(configs.production);
  const policy = { ...origins, routes: table.routes, isTestBuild: false };
  const listed = table.routes.map((entry) => new RegExp(`^${entry.path.split('/').map((segment) => (DYNAMIC_SEGMENT.test(segment) ? '[^/?#]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}(\\?|$)`));
  const runOne = (url, options = {}) => {
    try {
      // Every scenario that expects a route to open sees its gate open; only 'deferred' sees it closed.
      const isGateOpen = options.expect === 'open' || options.gateOpen === true;
      return { decision: decide(url, options.testBuild ? { ...policy, isTestBuild: true } : policy, () => isGateOpen) };
    } catch (error) {
      return { error };
    }
  };
  const all = scenarios(table.routes, origins);
  for (const scenario of all) {
    const { decision, error } = runOne(scenario.url, scenario);
    const shown = scenario.url.length > 80 ? `${scenario.url.slice(0, 77)}...` : scenario.url;
    if (error) {
      report.problem({ file: rel, line: 1, rule: 'gate-behaviour', message: `"${shown}" threw ${error?.message ?? error}: a throw in +native-intent crashes the launch`, fix });
      continue;
    }
    const isWrongKind = decision?.kind !== scenario.expect;
    const isWrongHref = scenario.expect === 'open' && decision?.href !== scenario.href;
    if (isWrongKind || isWrongHref) {
      const wanted = scenario.expect === 'open' ? `open ${scenario.href}` : `${scenario.expect}${scenario.why ? ` (${scenario.why})` : ''}`;
      report.problem({ file: rel, line: 1, rule: 'gate-behaviour', message: `"${shown}" gave ${describeDecision(decision)}; expected ${wanted}`, fix });
    }
  }
  for (const url of [...junk(40), ...junk(20).map((text) => `${origins.schemes[0] ?? 'app'}://${text}`)]) {
    const { decision, error } = runOne(url);
    if (error) report.problem({ file: rel, line: 1, rule: 'gate-behaviour', message: `${JSON.stringify(url)} threw ${error?.message ?? error}`, fix });
    else if (decision?.kind === 'open' && !listed.some((pattern) => pattern.test(decision.href))) {
      report.problem({ file: rel, line: 1, rule: 'gate-behaviour', message: `${JSON.stringify(url)} opened ${decision.href}, which no entry lists`, fix });
    }
  }
  return all.length + 60;
}

// ---------------------------------------------------------------------------------------------
// Verified hosts: contract, app config, well-known files
// ---------------------------------------------------------------------------------------------

function contractProblems(data) {
  const problems = [];
  const hostsOk = data?.hosts && typeof data.hosts === 'object' && VARIANTS.every((variant) => Array.isArray(data.hosts[variant]));
  if (!hostsOk) return [`"hosts" must list ${VARIANTS.join(', ')} (arrays, empty when a variant has no verified links)`];
  for (const variant of VARIANTS) {
    for (const host of data.hosts[variant]) if (!HOST.test(String(host))) problems.push(`hosts.${variant}: "${host}" is not a bare lowercase host (no https://, path or port)`);
  }
  if (!Array.isArray(data.webPaths)) problems.push('"webPaths" must be a list');
  else for (const path of data.webPaths) if (!WEB_PATH.test(String(path))) problems.push(`webPaths: "${path}" is not '/segment/...' with an optional final *`);
  if (data.wellKnownDir !== undefined && !/^[a-z0-9._-]+(\/[a-z0-9._-]+)*$/.test(String(data.wellKnownDir))) problems.push('"wellKnownDir" must be a repo-relative folder');
  const withHosts = VARIANTS.filter((variant) => data.hosts[variant].length > 0);
  if (withHosts.length > 0 && !TEAM_ID.test(String(data.appleTeamId ?? ''))) problems.push('"appleTeamId" must be the 10-character Team ID once a variant has hosts (the AASA appIDs need it)');
  for (const variant of withHosts) {
    const prints = data.androidCertFingerprints?.[variant];
    if (!Array.isArray(prints) || prints.length === 0) problems.push(`androidCertFingerprints.${variant} must list the signing certificate SHA-256 (Android verifies the app against it)`);
    else for (const print of prints) if (!FINGERPRINT.test(String(print))) problems.push(`androidCertFingerprints.${variant}: "${print}" is not 32 upper-case hex pairs`);
  }
  return problems;
}

/** '/tasks/*' -> '/tasks/.*': the Android pathPattern of a web path (link-native-config.ts toPathPattern). */
const toPathPattern = (webPath) => (webPath.endsWith('*') ? `${webPath.slice(0, -1)}.*` : webPath);

/** The paths an intent filter opens, as pathPattern strings (path exact, pathPrefix + '.*'). */
function filterPathPatterns(data) {
  const patterns = [];
  for (const item of data) {
    if (typeof item.path === 'string') patterns.push(item.path);
    if (typeof item.pathPrefix === 'string') patterns.push(`${item.pathPrefix}.*`);
    if (typeof item.pathPattern === 'string') patterns.push(item.pathPattern);
  }
  return patterns;
}

function nativeProblems(config, hosts, variant, webPaths) {
  const problems = [];
  const domains = config?.ios?.associatedDomains;
  if (Array.isArray(domains) && domains.length === 0) problems.push('ios.associatedDomains is an empty array: prebuild still writes an empty Associated Domains entitlement, and signing fails with a profile that lacks the capability (EAS turns it on for an App ID without a domain)');
  const entries = (domains ?? []).filter((entry) => String(entry).startsWith('applinks:'));
  for (const entry of entries) {
    if (!APPLINK_ENTRY.test(String(entry))) problems.push(`ios.associatedDomains "${entry}" is not applinks:<host> (no https://, path, port or trailing /)`);
    if (variant === 'production' && /\?mode=/.test(String(entry))) problems.push(`ios.associatedDomains "${entry}" uses an alternate mode in production (it bypasses Apple's CDN for developer devices only)`);
  }
  const iosHosts = entries.map(parseAppLink).filter(Boolean).map((link) => link.host);
  const want = [...hosts].sort().join(', ') || '(none)';
  if ([...new Set(iosHosts)].sort().join(', ') !== [...hosts].sort().join(', ')) problems.push(`ios.associatedDomains applinks hosts are ${[...new Set(iosHosts)].sort().join(', ') || '(none)'}; the contract says ${want}`);
  for (const filter of config?.android?.intentFilters ?? []) {
    const data = filterData(filter);
    const schemes = data.map((item) => String(item.scheme ?? '').toLowerCase()).filter(Boolean);
    if (!schemes.some((scheme) => scheme === 'http' || scheme === 'https')) continue;
    if (filter.autoVerify !== true) problems.push('an http(s) intent filter without autoVerify: Android 12+ opens the browser instead, older versions show a chooser');
    if (!['VIEW', 'android.intent.action.VIEW'].includes(filter.action)) problems.push('the App Links filter action must be VIEW');
    const categories = [filter.category].flat().map(String);
    if (!['BROWSABLE', 'DEFAULT'].every((name) => categories.includes(name) || categories.includes(`android.intent.category.${name}`))) problems.push('the App Links filter needs the BROWSABLE and DEFAULT categories');
    if (schemes.some((scheme) => scheme !== 'http' && scheme !== 'https')) problems.push('a custom scheme inside the App Links filter: other schemes in a verified filter prevent its verification');
    if (filter.autoVerify !== true) continue;
    const patterns = [...new Set(filterPathPatterns(data))].sort();
    const wanted = [...new Set(webPaths.map(toPathPattern))].sort();
    if (patterns.length === 0) problems.push('the App Links filter has no path, pathPrefix or pathPattern: Android opens the app for every page of the host, and the gate then refuses the pages links never open');
    else if (patterns.join(', ') !== wanted.join(', ')) problems.push(`the App Links filter paths are ${patterns.join(', ')}; the contract webPaths give ${wanted.join(', ') || '(none)'}`);
  }
  const androidHosts = [...new Set(appLinkFilterHosts(config))].sort().join(', ');
  if (androidHosts !== [...hosts].sort().join(', ')) problems.push(`the App Links filter hosts are ${androidHosts || '(none)'}; the contract says ${want}`);
  return problems;
}

function webPathMatches(webPath, path) {
  return webPath.endsWith('*') ? path.startsWith(webPath.slice(0, -1)) : path === webPath;
}

function checkVerified(root, layout, paths, contract, configs, configRel, table, report) {
  const anyConfigHosts = VARIANTS.some((variant) => originsOf(configs[variant]).hosts.length > 0);
  if (!contract.exists) {
    if (anyConfigHosts) report.problem({ file: paths.contract, rule: 'link-contract', message: `${configRel} declares verified hosts but there is no contract: nothing generates the AASA and assetlinks.json for them`, fix: 'Copy templates/contracts/deep-links.json, list the hosts, and build the native config with scripts/deep-links/link-native-config.ts.' });
    return 0;
  }
  if (contract.error) {
    report.problem({ file: paths.contract, line: 1, rule: 'link-contract', message: `is not valid JSON: ${contract.error}`, fix: 'Fix the JSON.' });
    return 1;
  }
  const problems = contractProblems(contract.data);
  for (const problem of problems) report.problem({ file: paths.contract, line: 1, rule: 'link-contract', message: problem, fix: 'Fix the contract (templates/contracts/deep-links.schema.json describes every key).' });
  if (problems.length > 0) return 1;
  const data = contract.data;
  const configText = read(root, configRel);
  const anchor = [/associatedDomains|intentFilters/, /linkNativeConfig/].map((pattern) => configText.search(pattern)).find((index) => index >= 0) ?? 0;
  const configLine = lineOf(configText, anchor);
  for (const variant of VARIANTS) {
    for (const problem of nativeProblems(configs[variant], data.hosts[variant], variant, data.webPaths)) {
      report.problem({ file: configRel, line: configLine, rule: 'native-links', message: `${variant}: ${problem}`, fix: 'Build ios.associatedDomains and android.intentFilters with linkNativeConfig(readLinkContract(projectRoot), variant) (templates/scripts/deep-links/link-native-config.ts); spread associatedDomains in only when it is present (examples/app-config-deep-links.ts).' });
    }
  }
  const hasHosts = VARIANTS.some((variant) => data.hosts[variant].length > 0);
  if (hasHosts && table) {
    if (data.webPaths.length === 0) report.problem({ file: paths.contract, line: 1, rule: 'web-paths', message: 'verified hosts but no webPaths: no web URL opens the app', fix: 'List the web paths that open the app (one per linked route family: /tasks/*).' });
    const webRoutes = table.routes.filter((entry) => typeof entry?.path === 'string' && entry.testBuildOnly !== true);
    for (const webPath of data.webPaths) {
      if (!webRoutes.some((entry) => webPathMatches(webPath, samplePath(entry) ?? entry.path))) report.problem({ file: paths.contract, line: 1, rule: 'web-paths', message: `webPaths "${webPath}" matches no listed route: the app opens for that page, then refuses it`, fix: 'Remove it, or add the route to LINK_ROUTES.' });
    }
    for (const entry of webRoutes.filter((item) => item.verifiedOnly === true)) {
      if (!data.webPaths.some((webPath) => webPathMatches(webPath, samplePath(entry) ?? entry.path))) report.problem({ file: paths.contract, line: 1, rule: 'web-paths', message: `${entry.path} is verifiedOnly but no web path opens it: it can never open`, fix: 'Add its web path to webPaths.' });
    }
  }
  return 1 + checkWellKnown(root, data, configs, hasHosts, report);
}

function checkWellKnown(root, data, configs, hasHosts, report) {
  const dir = data.wellKnownDir ?? 'well-known';
  const expected = hasHosts ? expectedWellKnown(data, configs) : new Map();
  const fix = 'Run node <skill>/scripts/write-well-known.mjs . and deploy each <host> pair to https://<host>/.well-known/ (HTTPS, no redirect, application/json).';
  for (const [rel, value] of expected) {
    if (!isFile(join(root, rel))) {
      report.problem({ file: rel, rule: 'well-known', message: 'missing: the OS cannot verify the app for this host', fix });
      continue;
    }
    const text = read(root, rel);
    let actual = null;
    try {
      actual = JSON.parse(text);
    } catch (error) {
      report.problem({ file: rel, line: 1, rule: 'well-known', message: `is not valid JSON: ${error.message}`, fix });
      continue;
    }
    if (!sameJson(actual, value)) report.problem({ file: rel, line: 1, rule: 'well-known', message: 'differs from what the contract and the app config give (app ids, packages, fingerprints or paths)', fix });
    if (rel.endsWith('apple-app-site-association') && Buffer.byteLength(text) > AASA_LIMIT) report.problem({ file: rel, line: 1, rule: 'well-known', message: 'is over 128 KB uncompressed: iOS ignores it', fix: 'Use wildcards in webPaths.' });
  }
  const folders = new Set([...expected.keys()].map((rel) => rel.split('/').at(-2)));
  const abs = join(root, dir);
  if (existsSync(abs)) {
    for (const name of readdirSync(abs)) {
      if (statSync(join(abs, name)).isDirectory() && !folders.has(name)) report.problem({ file: `${dir}/${name}`, rule: 'well-known', message: `a host folder the contract no longer lists (${hostFolder(name)})`, fix: 'Delete it, and remove the files from that host if the app should no longer open its links.' });
    }
  }
  return expected.size;
}

function checkPlaceholders(paths, contract, configs, configRel, report) {
  const values = [];
  if (contract.data) {
    for (const variant of VARIANTS) for (const host of contract.data.hosts?.[variant] ?? []) values.push([paths.contract, `hosts.${variant}`, host]);
    if (contract.data.appleTeamId) values.push([paths.contract, 'appleTeamId', contract.data.appleTeamId]);
  }
  values.push([configRel, 'production ios.bundleIdentifier', configs.production?.ios?.bundleIdentifier ?? '']);
  values.push([configRel, 'production android.package', configs.production?.android?.package ?? '']);
  for (const [file, where, value] of values) {
    for (const entry of placeholdersIn(String(value))) report.problem(placeholderProblem({ entry, value, where, file, line: 1 }));
  }
}

// ---------------------------------------------------------------------------------------------

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  requireDir(root, 'repo root');
  requireFile(join(root, 'package.json'), 'package.json (the app root)');
  const manifest = readManifest(root);
  const report = createReporter({ name: 'check-deep-links', json: options.json });
  if (!{ ...manifest.dependencies, ...manifest.devDependencies }['expo-router']) {
    return report.notApplicable('expo-router is not in package.json (React Navigation apps: references/react-navigation-linking.md)');
  }
  const layout = resolveLayout(root);
  const paths = linkPaths(layout);
  const sources = appSources(root, layout);
  checkOneListener(sources, report);
  checkOpenRedirect(sources, report);
  const configRel = findAppConfig(root);
  if (configRel === null) throw new UsageError('no app config (app.config.ts or app.json) at the repo root', 'Run the check from the app root.');
  const configs = evaluateAllVariants(root, configRel);
  const contract = readContract(root, paths.contract);
  const urls = routeUrls(root, layout.routesDir);
  // Expo Router opens EVERY route file for a link of a registered scheme or verified host, so a
  // static /settings/delete-account is link input as much as a dynamic route is.
  const takesLinks = VARIANTS.some((variant) => {
    const origins = originsOf(configs[variant]);
    return origins.schemes.length > 0 || origins.hosts.length > 0;
  });
  const readsInput = urls.some((route) => route.url.includes('['))
    || sources.some((file) => /\buse(Local|Global)SearchParams\s*[<(]/.test(file.masked))
    || (takesLinks && urls.some((route) => route.url !== '/'));
  const adopted = paths.intentCandidates.some((rel) => isFile(join(root, rel))) || contract.exists || isFile(join(root, paths.routesModule)) || VARIANTS.some((variant) => originsOf(configs[variant]).hosts.length > 0);
  if (!adopted && !readsInput) {
    if (report.count > 0) return report.finish({ checked: sources.length, unit: 'files' });
    return report.notApplicable('the app takes no input from links: no +native-intent, no contracts/deep-links.json, no link allow-list, no associatedDomains or App Links filter, no dynamic route or search-params hook, and no route other than / that a link could open');
  }
  checkIntent(root, layout, paths, report);
  const app = enableAppImports(root, { aliases: layout.aliases });
  const table = await loadTable(root, paths, app, report);
  let checked = sources.length + VARIANTS.length;
  if (table) {
    checkTable(root, layout, table, sources, report);
    checked += table.routes.length + (await checkGateBehaviour(root, paths, app, table, configs, report));
  }
  checked += checkVerified(root, layout, paths, contract, configs, configRel, table, report);
  if (options.release) checkPlaceholders(paths, contract, configs, configRel, report);
  return report.finish({ checked, unit: 'link facts' });
});
