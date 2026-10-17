#!/usr/bin/env node
// check-web-export.mjs: proves the web export (npx expo export --platform web) is what the contract
// promises: the entry, the bundle, a page per smoke route, the wasm asset and isolation headers
// expo-sqlite needs, no public source maps. With --browser it serves the export with the headers its
// host would send (the routes manifest on EAS Hosting, the headers file on a static host) and opens
// each smoke route in headless Chrome over the DevTools protocol: the route's testID must render with
// no console error and no uncaught exception, cross-origin isolated when expo-sqlite is installed,
// and in the contract's smokeLanguage with that language's <html dir> and lang.
// Zero dependencies; Node 22+ (global WebSocket). Run: node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs [repo-root]

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, extname, isAbsolute, join, posix, resolve } from 'node:path';

import { UsageError, createReporter, makeTempDir, parseArgs, removeTempDir, resolveLayout, run, toPosix, walk } from './check-lib.mjs';
import { contractProblems, notWebTargetReason, readAppConfig, readJson, webOutputOf } from './lib/web-target.mjs';

const SPEC = {
  name: 'check-web-export',
  summary: 'Checks a web export against contracts/web.json and, with --browser, opens each smoke route in headless Chrome.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'The Expo app folder inside the repo (default: the repo root)' },
    dist: { type: 'string', value: 'dir', help: 'The export folder, relative to the app (default: dist, what npx expo export writes)' },
    browser: { type: 'string', value: 'path|auto', help: 'Chrome or Chromium to drive headless; auto looks in the usual places' },
    timeout: { type: 'string', value: 'ms', help: 'How long each smoke route may take to show its testID (default 15000)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Export it first: APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform web',
    'Rules:',
    '  export-entry        index.html and the web bundle (_expo/static/js/web/*.js) exist',
    '  export-routes       static or server output: every smoke route has its page (<path>.html or <path>/index.html)',
    '  export-wasm         expo-sqlite installed: the export holds the wa-sqlite .wasm asset',
    '  export-headers      expo-sqlite on EAS Hosting: _expo/.routes.json carries both isolation headers,',
    '                      COEP require-corp (Safari and every iOS browser ignore credentialless)',
    '  export-source-maps  no .map file unless contracts/web.json publishSourceMaps is true',
    '  browser-console     (--browser) a smoke route logs no console error',
    '  browser-exception   (--browser) a smoke route throws no uncaught exception',
    '  browser-testid      (--browser) a smoke route shows its testID before the timeout',
    '  browser-isolation   (--browser) expo-sqlite installed: the page is cross-origin isolated',
    '  browser-direction   (--browser) contract smokeLanguage: Chrome started with --lang=<lang> shows the',
    '                      first smoke route with <html dir> equal to its dir and <html lang> starting with lang',
    'The smoke serves the headers the host would send: _expo/.routes.json headers (eas-hosting), the',
    'headersFile or the exported _headers (static-host; vercel.json headers too), the canonical isolation',
    'headers (custom-server, whose configuration is not read).',
  ].join('\n'),
};

const COEP = 'Cross-Origin-Embedder-Policy';
const COOP = 'Cross-Origin-Opener-Policy';
const COEP_VALUE = 'require-corp';
const ISOLATION = { [COEP]: COEP_VALUE, [COOP]: 'same-origin' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };
const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const BROWSER_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page a static host serves for a route path, or null. */
function pageFor(dist, path, output) {
  if (output === 'single') return isFile(join(dist, 'index.html')) ? 'index.html' : null;
  const clean = path.replace(/^\/+|\/+$/g, '');
  const candidates = clean === '' ? ['index.html'] : [`${clean}.html`, `${clean}/index.html`];
  return candidates.find((rel) => isFile(join(dist, rel))) ?? null;
}

function findBrowser(given) {
  if (given !== 'auto') {
    if (!isFile(given)) throw new UsageError(`--browser ${given} does not exist`, 'Pass the path of a Chrome or Chromium binary, or --browser auto.');
    return given;
  }
  const fromPath = (process.env.PATH ?? '').split(delimiter).flatMap((dir) => BROWSER_NAMES.map((name) => join(dir, name)));
  const found = [...BROWSERS, ...fromPath].find(isFile);
  if (!found) throw new UsageError('--browser auto found no Chrome, Chromium or Edge', 'Install Google Chrome, or pass --browser <path to the binary>.');
  return found;
}

/** A path pattern of a headers file (Netlify/Cloudflare `/*`, `:name`; Vercel `/(.*)`, `:name*`) as a RegExp. */
function pathPattern(source) {
  let out = '';
  for (let i = 0; i < source.length; ) {
    if (source.startsWith('(.*)', i)) {
      out += '.*';
      i += 4;
      continue;
    }
    const named = /^:[A-Za-z_]\w*(\*)?/.exec(source.slice(i));
    if (named) {
      out += named[1] ? '.*' : '[^/]+';
      i += named[0].length;
      continue;
    }
    const ch = source[i];
    out += ch === '*' ? '.*' : /[.+?^${}()|[\]\\/]/.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/** Rules of a Netlify / Cloudflare Pages _headers file: [{ pattern, headers }]. */
function parseHeadersFile(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: pathPattern(line.trim()), headers: {} });
    else if (rules.length > 0) {
      const colon = line.indexOf(':');
      if (colon !== -1) rules.at(-1).headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return rules;
}

/**
 * What the host sends with each response, as (path) => headers, and a note naming the source:
 * eas-hosting the routes manifest's headers; static-host the headers file (vercel.json headers, or
 * a _headers file, read from the export when it lives in public/); custom-server the canonical set.
 */
function hostHeaders(root, dist, contract, manifest) {
  if (contract.host === 'eas-hosting') {
    const headers = manifest?.headers ?? {};
    return { headersFor: () => headers, source: '_expo/.routes.json headers (EAS Hosting)' };
  }
  if (contract.host === 'custom-server') return { headersFor: () => ({ ...ISOLATION }), source: `the canonical isolation headers (custom-server; ${contract.headersFile} is not read)` };
  const file = toPosix(contract.headersFile ?? 'public/_headers');
  const exported = file.startsWith('public/') ? join(dist, file.slice('public/'.length)) : null;
  const path = exported && isFile(exported) ? exported : join(root, file);
  if (!isFile(path)) return { headersFor: () => ({}), source: `no headers: ${file} does not exist` };
  const text = readFileSync(path, 'utf8');
  let rules;
  if (file.endsWith('.json')) {
    const config = readJson(path, file);
    rules = (Array.isArray(config.headers) ? config.headers : []).map((rule) => ({ pattern: pathPattern(String(rule.source ?? '')), headers: Object.fromEntries((rule.headers ?? []).map((h) => [h.key, h.value])) }));
  } else rules = parseHeadersFile(text);
  return { headersFor: (urlPath) => Object.assign({}, ...rules.filter((rule) => rule.pattern.test(urlPath)).map((rule) => rule.headers)), source: `${exported && isFile(exported) ? posix.join('dist', file.slice('public/'.length)) : file} (static host)` };
}

/** Serves the export the way a host does: the host's headers, .html for clean URLs, index.html for a single-page app. */
function serveExport(dist, { headersFor, output }) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let rel = path.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (!isFile(join(dist, rel))) rel = isFile(join(dist, `${rel}.html`)) ? `${rel}.html` : output === 'single' && extname(rel) === '' ? 'index.html' : null;
    const headers = headersFor(path);
    if (rel === null || !isFile(join(dist, rel))) {
      response.writeHead(404, headers);
      response.end('not found');
      return;
    }
    response.writeHead(200, { ...headers, 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    response.end(readFileSync(join(dist, rel)));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A DevTools protocol session on one page target. */
async function connectPage(wsUrl, onEvent) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message.result ?? { error: message.error });
      pending.delete(message.id);
    } else if (message.method) onEvent(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      nextId += 1;
      pending.set(nextId, resolve);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  return { send, evaluate, close: () => socket.close() };
}

/** Starts headless Chrome with a throwaway profile, hands its first page to `use`, and always cleans up. */
async function withChrome(browser, extraArgs, use) {
  const profile = makeTempDir('web-smoke-');
  const chrome = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let waited = 0; !isFile(portFile) || readFileSync(portFile, 'utf8').trim() === ''; waited += 100) {
      if (waited > 20000) throw new UsageError(`${browser} did not open its DevTools port within 20 s`, 'Check that the binary is Chrome or Chromium and can run headless on this machine.');
      await sleep(100);
    }
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const target = targets.find((entry) => entry.type === 'page');
    const sink = { events: [] };
    const page = await connectPage(target.webSocketDebuggerUrl, (message) => sink.events.push(message));
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');
    try {
      return await use(page, sink);
    } finally {
      page.close();
    }
  } finally {
    chrome.kill('SIGKILL');
    await sleep(200);
    removeTempDir(profile);
  }
}

/** Opens one route and waits for its testID; reports what the page logged and threw meanwhile. */
async function openRoute(page, sink, { origin, route, timeoutMs, label, add }) {
  sink.events = [];
  await page.send('Page.navigate', { url: `${origin}${route.path}` });
  const selector = JSON.stringify(`[data-testid="${route.testID}"]`);
  let isShown = false;
  for (let waited = 0; waited <= timeoutMs && !isShown; waited += 250) {
    await sleep(250);
    isShown = (await page.evaluate(`document.querySelector(${selector}) !== null`)) === true;
  }
  await sleep(500);
  for (const event of sink.events) {
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails;
      add(route.path, 'browser-exception', `${label}uncaught exception: ${String(details.exception?.description ?? details.text).split('\n')[0]}`, 'Fix the error; run the export with --dev for readable stacks (references/testing-web.md).');
    } else if (event.method === 'Runtime.consoleAPICalled' && (event.params.type === 'error' || event.params.type === 'assert')) {
      const text = event.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').split('\n')[0];
      add(route.path, 'browser-console', `${label}console.${event.params.type}: ${text}`, 'Fix what logs it; a web build that logs errors is broken somewhere the screen may not show.');
    } else if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error' && !/favicon\.ico/.test(event.params.entry.url ?? '')) {
      add(route.path, 'browser-console', `${label}browser error: ${event.params.entry.text.split('\n')[0]}`, 'Fix the failing request or resource (with COEP require-corp a cross-origin resource needs a Cross-Origin-Resource-Policy header or crossorigin).');
    }
  }
  if (!isShown) add(route.path, 'browser-testid', `${label}the page did not show [data-testid="${route.testID}"] within ${timeoutMs} ms`, 'Open the export in a browser (npx expo serve) and look at what renders instead; the crash screen, a storage notice or an empty page means an error above.');
  return isShown;
}

async function browserSmoke({ browser, dist, output, headersFor, isolate, routes, language, timeoutMs, add }) {
  const server = await serveExport(dist, { headersFor, output });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await withChrome(browser, [], async (page, sink) => {
      for (const route of routes) {
        await openRoute(page, sink, { origin, route, timeoutMs, label: '', add });
        if (isolate && (await page.evaluate('self.crossOriginIsolated')) !== true) add(route.path, 'browser-isolation', 'the page is not cross-origin isolated, so expo-sqlite has no SharedArrayBuffer', `Serve ${COEP}: ${COEP_VALUE} and ${COOP}: same-origin from the host (contracts/web.json host; references/hosting-and-headers.md).`);
      }
    });
    if (!language) return;
    // A second browser whose language is the contract's: the app must pick it and lay the page out in its direction.
    await withChrome(browser, [`--lang=${language.lang}`, `--accept-lang=${language.lang}`], async (page, sink) => {
      const route = routes[0];
      const label = `(--lang=${language.lang}) `;
      if (!(await openRoute(page, sink, { origin, route, timeoutMs, label, add }))) return;
      const [dir, lang] = (await page.evaluate('[document.documentElement.dir, document.documentElement.lang]')) ?? [];
      if (dir !== language.dir || !String(lang ?? '').toLowerCase().startsWith(language.lang.toLowerCase())) add(route.path, 'browser-direction', `${label}<html> has dir="${dir ?? ''}" lang="${lang ?? ''}", expected dir="${language.dir}" and lang ${language.lang}`, "Give src/i18n/direction.ts a .web sibling that keeps the direction on <html dir> (templates/src/i18n/direction.web.ts), and call syncDocumentLanguage(language) where the language changes (references/web-target-and-output.md section 4).");
    });
  } finally {
    server.close();
  }
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const appDir = toPosix(options['app-dir'] ?? '.').replace(/\/$/, '');
  const root = join(positionals[0] ?? '.', appDir);
  const shown = (rel) => (appDir === '.' ? rel : `${appDir}/${rel}`);
  const timeoutMs = options.timeout === undefined ? 15000 : Number(options.timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new UsageError(`--timeout ${options.timeout} is not a whole number of milliseconds (1000 or more)`, 'Pass --timeout 15000.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  if (!isFile(join(root, 'package.json'))) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root, or pass --app-dir.');
  const pkg = readJson(join(root, 'package.json'), shown('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const appConfig = deps['react-native'] || deps.expo ? readAppConfig(root) : null;
  const notTarget = notWebTargetReason(deps, appConfig);
  if (notTarget) return report.notApplicable(notTarget);

  const contractRel = posix.join(resolveLayout(root).contractsDir, 'web.json');
  if (!isFile(join(root, contractRel))) throw new UsageError(`${shown(contractRel)} does not exist`, 'Create it first (check-web-support.mjs reports what it needs).');
  const contract = readJson(join(root, contractRel), shown(contractRel));
  contractProblems(contract, shown(contractRel), report);
  if (report.count > 0) return report.finish({ checked: 0, unit: 'routes' });
  const output = (appConfig ? webOutputOf(appConfig).value : null) ?? contract.output;

  const distRel = toPosix(options.dist ?? 'dist').replace(/\/$/, '');
  const dist = resolve(root, distRel);
  const distShown = isAbsolute(distRel) ? distRel : shown(distRel);
  if (!existsSync(dist)) throw new UsageError(`nothing to check: ${distShown} does not exist`, 'Export the web build first: APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform web');
  const files = walk(dist, { defaultIgnores: false });
  const add = (rel, rule, message, fix) => report.problem({ file: posix.join(distShown, rel), line: 0, rule, message, fix });

  if (!files.includes('index.html')) add('index.html', 'export-entry', 'the export has no index.html', 'Run npx expo export --platform web from the app folder.');
  if (!files.some((rel) => /^_expo\/static\/js\/web\/[^/]+\.js$/.test(rel))) add('_expo/static/js/web', 'export-entry', 'the export has no web bundle', 'Run npx expo export --platform web; a failed bundle prints why.');
  if (output !== 'single') {
    for (const route of contract.smokeRoutes) {
      if (route.path === '/' && !files.includes('index.html')) continue;
      if (pageFor(dist, route.path, output) === null) add(route.path === '/' ? 'index.html' : `${route.path.replace(/^\//, '')}.html`, 'export-routes', `web.output is "${output}" but the export has no page for ${route.path}`, 'Make the route render at export time (generateStaticParams for a dynamic route), or fix its path in smokeRoutes.');
    }
  }
  const usesSqlite = Boolean(deps['expo-sqlite']);
  if (usesSqlite && !files.some((rel) => rel.endsWith('.wasm'))) add('assets', 'export-wasm', 'expo-sqlite is installed but the export holds no .wasm asset, so the SQLite worker cannot start', "Add 'wasm' to Metro's assetExts (withWebSqlite in metro.config.js) and export again.");
  const manifest = isFile(join(dist, '_expo/.routes.json')) ? readJson(join(dist, '_expo/.routes.json'), posix.join(distShown, '_expo/.routes.json')) : null;
  if (usesSqlite && contract.host === 'eas-hosting') {
    const headers = manifest?.headers ?? {};
    if (!headers[COEP] || !headers[COOP]) add('_expo/.routes.json', 'export-headers', manifest === null ? 'the export has no _expo/.routes.json, so EAS Hosting sends no cross-origin isolation headers and expo-sqlite fails' : 'the routes manifest does not carry both cross-origin isolation headers', "Use web.output 'static' or 'server' and set the headers in the expo-router plugin options, then export again.");
    else if (headers[COEP] !== COEP_VALUE) add('_expo/.routes.json', 'export-headers', `the routes manifest sends ${COEP}: ${headers[COEP]}, ${headers[COEP] === 'credentialless' ? 'which Safari and every iOS browser ignore (MDN browser-compat-data 8.1.6, verified 2026-10-16): those visitors get no SharedArrayBuffer and no storage' : 'which does not isolate the page'}`, `Send ${COEP}: ${COEP_VALUE} (the expo-router plugin headers), then export again.`);
  }
  if (contract.publishSourceMaps !== true) {
    const maps = files.filter((rel) => rel.endsWith('.map'));
    if (maps.length > 0) add(maps[0], 'export-source-maps', `the export holds ${maps.length} source map(s), which publish the app's source to anyone`, 'Export without --source-maps for the site (upload maps to the crash reporter instead), or set publishSourceMaps: true on purpose.');
  }

  if (options.browser !== undefined && report.count > 0) report.note('check-web-export: browser smoke not run: fix the export problems first');
  if (options.browser !== undefined && report.count === 0) {
    const browser = findBrowser(options.browser);
    const { headersFor, source } = hostHeaders(root, dist, contract, manifest);
    const pageOf = (path) => pageFor(dist, path, output) ?? path.replace(/^\/+/, '');
    await browserSmoke({ browser, dist, output, headersFor, isolate: usesSqlite, routes: contract.smokeRoutes, language: contract.smokeLanguage, timeoutMs, add: (path, rule, message, fix) => add(pageOf(path), rule, `${path}: ${message}`, fix) });
    report.note(`check-web-export: opened ${contract.smokeRoutes.length} route(s)${contract.smokeLanguage ? ` and ${contract.smokeRoutes[0].path} with --lang=${contract.smokeLanguage.lang}` : ''} in ${browser}, served with ${source}`);
  }
  return report.finish({ checked: contract.smokeRoutes.length, unit: 'routes' });
});
