// api-rules.mjs: the ApiClient rules of check-server-state (a helper, not an entry point): network calls
// only in the transport, the port and failure family, the transport's boundary, deadline and schema,
// tolerant response schemas, base URLs and cleartext, and test doubles for fetch.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { callArgumentRanges, codeMatches, importsPackage, isUnder, memberCallRanges, objectEntries, tryBlocksWithCatch, within } from './server-state-source.mjs';
import { functionsOf, matchBracket, scanSource } from './source-scan.mjs';

/** HTTP client packages: the app requests through the ApiClient over the built-in fetch instead. */
export const HTTP_CLIENTS = ['axios', 'ky', 'got', 'node-fetch', 'cross-fetch', 'isomorphic-fetch', 'whatwg-fetch', 'superagent', 'redaxios', 'ofetch', 'wretch', 'undici', 'expo/fetch'];

const NETWORK_PATTERNS = [
  { pattern: /(?<![\w$.])fetch\s*\(/g, what: 'fetch()' },
  { pattern: /\b(?:globalThis|window|global|self)\s*\.\s*fetch\b/g, what: 'globalThis.fetch' },
  { pattern: /\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/g, what: null },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/g, what: 'navigator.sendBeacon' },
  // The global handed on as a value ({ baseUrl, fetch }, fetch: fetch), not a key, a member or a type.
  { pattern: /(?<![\w$.])(?<!typeof\s+)fetch(?![\w$]|\s*[:(?])/g, what: 'fetch (the global, passed on)' },
];

/** Every network call site of a file: [{ index, what }]. */
export function networkCalls(src) {
  const calls = [];
  for (const { pattern, what } of NETWORK_PATTERNS) {
    for (const { index, match } of codeMatches(src, pattern)) {
      if (/^\s*import\b/.test(src.code.slice(src.code.lastIndexOf('\n', index) + 1, index))) continue;
      calls.push({ index, what: what ?? `new ${match[1]}` });
    }
  }
  for (const entry of src.imports) {
    if (HTTP_CLIENTS.includes(entry.spec) && !entry.typeOnly) calls.push({ index: entry.index, what: `import of ${entry.spec}` });
  }
  return calls.sort((a, b) => a.index - b.index);
}

/** The files of the API folder that call fetch themselves: the transport (one, by the rules). */
export function transportFiles(ctx) {
  const found = ctx.appFiles.filter((src) => isUnder(src.rel, ctx.layout.apiDir) && networkCalls(src).some((call) => call.what === 'fetch()' || call.what === 'globalThis.fetch'));
  // The canonical transport counts as the first one wherever it sorts; any other is the extra.
  const isCanonical = (src) => src.rel === `${ctx.layout.apiDir}/fetch-api-client.ts`;
  return [...found.filter(isCanonical), ...found.filter((src) => !isCanonical(src))];
}

function checkNetworkCalls(ctx) {
  const transports = new Set(transportFiles(ctx).map((src) => src.rel));
  for (const src of ctx.appFiles) {
    const inApi = isUnder(src.rel, ctx.layout.apiDir);
    for (const call of networkCalls(src)) {
      const isClient = call.what.startsWith('import of ');
      if (inApi && !isClient && transports.has(src.rel) && call.what !== 'new XMLHttpRequest') continue;
      if (inApi && call.what.startsWith('fetch (')) continue;
      if (inApi && !isClient && (call.what === 'new WebSocket' || call.what === 'new EventSource')) continue;
      ctx.add({
        file: src.rel,
        line: src.lineOf(call.index),
        rule: 'network-call',
        message: isClient
          ? `${call.what}: the app has one HTTP client, the ApiClient over the built-in fetch`
          : `${call.what} outside the ApiClient: network calls live in ${ctx.layout.apiDir}/ only`,
        fix: `Request through the ApiClient (a queryOptions or mutationOptions factory in ${ctx.layout.apiDir}/<resource>/), which the fetch transport serves.`,
      });
    }
  }
}

function checkPortFiles(ctx) {
  const { apiDir } = ctx.layout;
  const required = [
    { file: `${apiDir}/api-client.ts`, pattern: /export\s+type\s+ApiClient\b/, what: 'the ApiClient port type' },
    { file: `${apiDir}/api-failure.ts`, pattern: /export\s+type\s+ApiFailure\b/, what: 'the ApiFailure union' },
  ];
  for (const { file, pattern, what } of required) {
    const src = ctx.sources.get(file);
    if (src === undefined || !pattern.test(src.code)) {
      ctx.add({ file, line: 1, rule: 'api-client', message: `${file} must export ${what}`, fix: `Copy templates/${file.replace(`${apiDir}/`, 'src/api/')} from the networking-and-server-state skill.` });
    }
  }
  const transports = transportFiles(ctx);
  if (transports.length === 0) {
    ctx.add({ file: `${apiDir}/fetch-api-client.ts`, line: 1, rule: 'api-client', message: `no file in ${apiDir}/ calls fetch: the ApiClient has no transport`, fix: 'Copy templates/src/api/fetch-api-client.ts (the one file that calls fetch).' });
  }
  for (const extra of transports.slice(1)) {
    ctx.add({ file: extra.rel, line: extra.lineOf(networkCalls(extra)[0].index), rule: 'api-client', message: `a second fetch transport (the first is ${transports[0].rel})`, fix: `Route this request through the ApiClient; only ${transports[0].rel} calls fetch.` });
  }
}

const VENDOR_AWAIT = /(?:\bfetch\w*\s*\(|\.fetch\s*\(|\.(?:text|json|arrayBuffer|blob|formData)\s*\(\s*\))/;

/** Whether the function that runs the schema check also records (else the whole file must). */
function recordsNearParse(src) {
  const at = src.code.search(/\b(?:safeParse|parse)\s*\(/);
  const fn = functionsOf(src.scan).filter((candidate) => candidate.bodyStart !== -1 && at > candidate.bodyStart && at < candidate.bodyEnd).at(-1);
  const scope = fn === undefined ? src.code : src.code.slice(fn.bodyStart, fn.bodyEnd);
  return /\.record\s*\(/.test(scope);
}

function checkTransport(ctx, src) {
  const tries = tryBlocksWithCatch(src.code);
  const guarded = [...callArgumentRanges(src.code, 'attemptAsync'), ...callArgumentRanges(src.code, 'withTimeout')];
  for (const { index } of codeMatches(src, /\bawait\b/g)) {
    const statement = src.code.slice(index, index + 200).split(/[;\n]/)[0];
    if (!VENDOR_AWAIT.test(statement) || within(tries, index) || within(guarded, index)) continue;
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'transport-boundary', message: 'an awaited fetch or body read outside try/catch: its rejection escapes the ApiClient, which must never reject', fix: 'Await fetch and the body read inside one try { } catch { return err(failureFromThrown(...)) }, as fetch-api-client.ts does.' });
  }
  const hasDeadline = /\bsetTimeout\s*\(/.test(src.code) && /\babort\s*\(/.test(src.code);
  if (!hasDeadline && !/AbortSignal\s*\.\s*timeout\s*\(/.test(src.code)) {
    ctx.add({ file: src.rel, line: 1, rule: 'request-timeout', message: 'the transport sets no deadline: expo/fetch on Android uses OkHttp with connect, read and write timeouts of 0, so a stalled request never ends', fix: 'Abort each attempt after timeoutMs (a setTimeout that aborts an AbortController linked to the caller\'s signal) and return { kind: \'timed-out\' }.' });
  }
  if (!/\b(?:safeParse|parse)\s*\(/.test(src.code)) {
    ctx.add({ file: src.rel, line: 1, rule: 'validated-response', message: 'the transport never checks a response body against the request\'s schema', fix: 'v.safeParse(request.schema, json) every 2xx body; a mismatch is { kind: \'invalid-response\' }.' });
  } else if (!recordsNearParse(src)) {
    ctx.add({ file: src.rel, line: src.lineOf(src.code.search(/\b(?:safeParse|parse)\s*\(/)), rule: 'validated-response', message: 'an invalid response is not recorded: after the conversion only { kind } is left', fix: 'Record it once at the boundary: errorLog.record(\'network\', new Error(<method, path, issue paths>)), never the body.' });
  }
}

/** The transport files and the API-folder helpers they import (a JSON parser may live in one). */
function transportAndHelpers(ctx, transports) {
  const allowed = new Set(transports);
  for (const rel of transports) {
    for (const entry of ctx.sources.get(rel).imports) {
      if (entry.typeOnly) continue;
      const stem = entry.spec.split('/').pop();
      const helper = ctx.appFiles.find((src) => isUnder(src.rel, ctx.layout.apiDir) && src.rel.replace(/\.[jt]sx?$/, '').endsWith(`/${stem}`));
      if (helper !== undefined) allowed.add(helper.rel);
    }
  }
  return allowed;
}

function checkBodies(ctx, transports) {
  const allowed = transportAndHelpers(ctx, transports);
  for (const src of ctx.appFiles) {
    if (allowed.has(src.rel)) continue;
    const inApi = isUnder(src.rel, ctx.layout.apiDir);
    for (const { index } of codeMatches(src, /\.json\s*\(\s*\)|\bJSON\s*\.\s*parse\s*\(/g)) {
      if (!inApi && !/\.json/.test(src.code.slice(index, index + 6))) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'validated-response', message: 'a response body parsed outside the transport, where no schema checks it', fix: 'Let the ApiClient parse and validate: request({ ..., schema }) returns the checked value.' });
    }
  }
  for (const src of ctx.appFiles) {
    for (const { index } of codeMatches(src, /(?:\.json\s*\(\s*\)|\bJSON\s*\.\s*parse\s*\([^)]*\))\s*\)?\s*as\s+(?!unknown\b|const\b)[A-Z]/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'validated-response', message: 'parsed JSON cast to a type: the cast checks nothing at run time', fix: 'Check it with a valibot schema (v.safeParse) and use the schema\'s output type.' });
    }
    for (const range of memberCallRanges(src.code, 'request')) {
      const open = src.code.slice(range.start + 1).search(/\S/) + range.start + 1;
      if (src.code[open] !== '{') continue;
      const entries = objectEntries(src.code, { open, close: matchBracket(src.code, open) });
      const keys = new Set(entries.map((entry) => entry.key));
      if (keys.has('method') && !keys.has('schema')) {
        ctx.add({ file: src.rel, line: src.lineOf(range.callStart), rule: 'validated-response', message: 'a request without a schema: its response would reach the app unchecked', fix: 'Pass schema: <the valibot schema of the response> (NO_CONTENT for a 204).' });
      }
    }
  }
}

function checkResponseSchemas(ctx) {
  for (const src of ctx.appFiles) {
    if (!isUnder(src.rel, ctx.layout.apiDir)) continue;
    for (const { index } of codeMatches(src, /(?<![\w$])(?:v\s*\.\s*)?strictObject\s*\(/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'response-schema', message: 'v.strictObject in the API layer: a server that adds a field then breaks every installed copy of the app', fix: 'Use v.object (unknown keys are dropped from the output).' });
    }
    const fallbacks = callArgumentRanges(src.code, '(?:v\\s*\\.\\s*)?fallback');
    for (const { index } of codeMatches(src, /(?<![\w$])(?:v\s*\.\s*)?(?:picklist|enum_?)\s*\(/g)) {
      if (within(fallbacks, index)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'response-schema', message: 'a closed set without a fallback: a value the server adds later fails the whole response', fix: 'Wrap it: v.fallback(v.picklist(VALUES), <the value an unknown one reads as>).' });
    }
  }
}

const REMOTE_URL = /^(?:https?|wss?):\/\/[^\s'"`]+/i;
const CLEARTEXT_URL = /^http:\/\/(?!localhost\b|127\.0\.0\.1\b|10\.0\.2\.2\b|\[::1\])[^\s/'"`]+/i;

function checkUrls(ctx) {
  for (const src of ctx.appFiles) {
    const inApi = isUnder(src.rel, ctx.layout.apiDir);
    const inConfig = isUnder(src.rel, ctx.layout.configDir);
    for (const literal of src.scan.strings) {
      const text = literal.quote === '`' ? literal.parts[0] : literal.value;
      if (inApi && REMOTE_URL.test(text)) {
        ctx.add({ file: src.rel, line: literal.line, rule: 'base-url', message: `a URL literal in the API layer (${text.slice(0, 40)}): each variant talks to its own server`, fix: 'Read EXPO_PUBLIC_API_URL in src/config (parseApiBaseUrl) and pass it to createFetchApiClient({ baseUrl }); requests name paths only.' });
      } else if ((inApi || inConfig) && CLEARTEXT_URL.test(text)) {
        ctx.add({ file: src.rel, line: literal.line, rule: 'cleartext', message: `a cleartext URL (${text.slice(0, 40)}): release builds block http:// on iOS (ATS) and Android 9+`, fix: 'Use https://; only a development dev server (localhost, 10.0.2.2) may be http://.' });
      }
    }
    for (const { index } of codeMatches(src, /\bbaseUrl\s*:\s*['"`]/g)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'base-url', message: 'a literal base URL', fix: 'Pass the base URL your src/config reader returned (parseApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, variant)).' });
    }
  }
}

const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.json'];
const CLEARTEXT_SWITCHES = [
  { pattern: /["']?NSAllowsArbitraryLoads["']?\s*:\s*true/, what: 'NSAllowsArbitraryLoads: true switches App Transport Security off for every host on iOS' },
  { pattern: /["']?usesCleartextTraffic["']?\s*:\s*true/, what: 'usesCleartextTraffic: true allows http:// to every host in Android release builds' },
];

function checkTransportSecurity(ctx) {
  for (const file of CONFIG_FILES) {
    const path = join(ctx.root, file);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, 'utf8');
    // Comments are blanked (a note that warns against the switch is not the switch); keys stay.
    const text = file.endsWith('.json') ? raw : scanSource(raw).codeKeep;
    for (const { pattern, what } of CLEARTEXT_SWITCHES) {
      const match = pattern.exec(text);
      if (match === null) continue;
      const line = text.slice(0, match.index).split('\n').length;
      ctx.add({ file, line, rule: 'cleartext', message: what, fix: 'Serve the API over https. A dev server needs nothing: Expo\'s debug builds already allow cleartext on Android and NSAllowsLocalNetworking covers local hosts on iOS.' });
    }
  }
}

const FETCH_MOCKS = [
  /\bjest\s*\.\s*spyOn\s*\(\s*(?:global|globalThis|window)\s*,\s*['"]fetch['"]/g,
  /\b(?:global|globalThis|window)\s*\.\s*fetch\s*=(?!=)/g,
  /\bjest\s*\.\s*mock\s*\(\s*['"]expo\/fetch['"]/g,
];

function checkTests(ctx) {
  for (const src of ctx.testFiles) {
    for (const pattern of FETCH_MOCKS) {
      // Comments blanked, strings kept: the 'fetch' of spyOn(globalThis, 'fetch') is a string.
      for (const match of src.scan.codeKeep.matchAll(new RegExp(pattern.source, 'g'))) {
        const { index } = match;
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'test-fetch-mock', message: 'a test replaces the global fetch: it leaks into other tests and tests no seam the app uses', fix: 'Pass a fake to createFetchApiClient({ fetch }) for the transport, and the fake ApiClient (test/api/fake-api-client.ts) everywhere above it.' });
      }
    }
  }
}

/** Runs every ApiClient rule. */
export function checkApiLayer(ctx) {
  checkNetworkCalls(ctx);
  checkPortFiles(ctx);
  const transports = transportFiles(ctx);
  // Only the first transport is held to the transport rules: a second one is already an api-client
  // finding, and its fix is to delete it, not to give it a deadline.
  if (transports.length > 0) checkTransport(ctx, transports[0]);
  checkBodies(ctx, new Set(transports.map((src) => src.rel)));
  checkResponseSchemas(ctx);
  checkUrls(ctx);
  checkTransportSecurity(ctx);
  checkTests(ctx);
}

/** True when some app file talks to the network or imports an HTTP client. */
export function hasNetworkCode(ctx) {
  return ctx.appFiles.some((src) => networkCalls(src).length > 0 || HTTP_CLIENTS.some((spec) => importsPackage(src, spec)));
}
