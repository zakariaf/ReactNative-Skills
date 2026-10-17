#!/usr/bin/env node
// check-server-state.mjs: checks an Expo app's network and server-state layer: network calls only in the
// ApiClient's fetch transport (with a deadline, a try/catch boundary and a schema check), tolerant
// response schemas, base URLs from config and no cleartext switches, and TanStack Query used the way the
// networking-and-server-state skill says (queryOptions and key factories in src/api, the signal in every
// queryFn, hooks in model hooks, one client from a factory with a failure-aware retry policy, focus and
// online managers wired to AppState and the ConnectivityPort, cache effects and rollbacks on every write).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-server-state.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, notYetCreated, parseArgs, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { checkApiLayer, hasNetworkCode } from './lib/api-rules.mjs';
import { checkQueryLayer } from './lib/query-rules.mjs';
import { importsPackage, isUnder, loadSources } from './lib/server-state-source.mjs';

const SPEC = {
  name: 'check-server-state',
  summary: "Checks an Expo app's ApiClient (src/api) and its TanStack Query usage against the networking-and-server-state rules.",
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, src)' },
    'api-dir': { type: 'string', value: 'dir', help: 'The API folder (default: from resolveLayout, <srcDir>/api)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (app code = files under srcDir and the routes folder, tests, API routes and +middleware excluded):',
    '  network-call        fetch(), globalThis.fetch, the fetch global passed on as a value, new XMLHttpRequest,',
    '                      new WebSocket/EventSource, navigator.sendBeacon outside <apiDir>/, or an HTTP client import',
    '                      (axios, ky, got, node-fetch, cross-fetch, expo/fetch, ...) anywhere',
    '  api-client          <apiDir>/api-client.ts (export type ApiClient) or <apiDir>/api-failure.ts (export type',
    '                      ApiFailure) missing; no file in <apiDir>/ calls fetch; a second file there calls fetch',
    '  transport-boundary  in the transport, an awaited fetch or body read (.text(), .json(), ...) outside a try with a',
    '                      catch (or attemptAsync/withTimeout arguments): the ApiClient must never reject',
    '  request-timeout     the transport neither aborts after a setTimeout nor uses AbortSignal.timeout',
    '  validated-response  the transport runs no safeParse/parse, or never records an invalid response; .json() or',
    '                      JSON.parse elsewhere in <apiDir>/, .json() in other app code; parsed JSON cast `as Type`;',
    '                      a .request({ method, ... }) without schema',
    '  response-schema     v.strictObject in <apiDir>/; v.picklist/v.enum there outside a v.fallback(...)',
    '  base-url            a remote URL literal in <apiDir>/; baseUrl: \'<literal>\' anywhere in app code',
    '  cleartext           NSAllowsArbitraryLoads: true or usesCleartextTraffic: true in app.config.ts/.js or app.json',
    '                      (comments ignored); an http:// URL to a host other than localhost/127.0.0.1/10.0.2.2 in',
    '                      <apiDir>/ or <configDir>/',
    '  test-fetch-mock     a test replaces the global fetch (jest.spyOn(globalThis, \'fetch\'), global.fetch = ...,',
    '                      jest.mock(\'expo/fetch\'))',
    'Rules when app code imports @tanstack/react-query:',
    '  query-signal        a queryFn whose body never uses signal (destructuring it alone does not count; a context',
    '                      parameter handed on whole does; a same-file function it names is followed; skipToken is fine)',
    '  query-key-factory   an inline queryKey/mutationKey array, or an array literal passed to setQueryData/getQueryData/',
    '                      getQueryState/getQueriesData/ensureQueryData/prefetchQuery/fetchQuery, outside *-keys.ts; a',
    '                      key factory without an `all` key and `as const`',
    '  query-options       a queryFn or mutationFn outside <apiDir>/; a queryFn in <apiDir>/ outside queryOptions(...)/',
    '                      infiniteQueryOptions(...); an ApiClient .request(...) outside <apiDir>/',
    '  query-hook-home     useQuery, useMutation, useQueryClient and the other TanStack hooks outside',
    '                      <featuresDir>/**/use-*.ts(x), <srcDir>/hooks/ and <apiDir>/',
    '  query-client        no `new QueryClient` factory in <apiDir>/; new QueryClient elsewhere; a client created at',
    '                      module level, or in a component or hook body outside a useState initializer',
    '  retry-policy        retry: true, Infinity or more than 3; the factory keeps the default retry (no retry function);',
    '                      a mutation that retries without an idempotencyKey',
    '  managers-wired      nothing calls onlineManager.setEventListener or focusManager.setEventListener/setFocused; no',
    '                      file outside <apiDir>/ renders <QueryProvider> (or <QueryClientProvider> and imports the wiring)',
    '  connectivity-port   <servicesDir>/connectivity/connectivity-port.ts missing; expo-network or NetInfo imported',
    '                      by any app file other than <servicesDir>/connectivity/*-adapter.ts',
    '  mutation-cache      a mutation options object whose onSuccess/onSettled invalidates/sets nothing, without',
    '                      "// no-cache-effect: <why>" inside it (a same-file or ./sibling helper it calls is followed)',
    '  optimistic-rollback an onMutate that writes the cache without cancelQueries first, without a getQueryData',
    '                      snapshot, without an onError that restores it, or without an onSettled that invalidates',
    '  network-mode        networkMode: \'always\' without "// network-mode-always: <why>" in its options',
    '  persist-cache       a persisted query cache (persist-client packages) without buster and maxAge (inline',
    '                      options or a same-file const named by persistOptions={options})',
    '',
    'NOT APPLICABLE when no app code imports @tanstack/react-query, no app code calls the network, and there is',
    'no <apiDir>/ folder. SKIP: <routesDir>/_layout.tsx [managers-wired] until it exists (navigation-and-routing).',
    'rn-skills.config.json keys read: the layout keys srcDir, routesDir, featuresDir, apiDir, configDir, servicesDir.',
    'Installed skills (.agents/, .claude/, skills/, any folder with a SKILL.md) are never scanned.',
  ].join('\n'),
};

/** Expo Router server code may call the network (it runs on a server, not in the app). */
function isServerFile(rel) {
  return /\+(?:api|middleware)\.[jt]sx?$/.test(rel);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  if (!existsSync(join(root, 'package.json'))) {
    throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root (or pass it as the first argument).');
  }
  try {
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
  const report = createReporter({ name: 'check-server-state', json: options.json });
  const layout = resolveLayout(root, { srcDir: options['src-dir'], apiDir: options['api-dir'] });
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'], ignore: ['**/*.d.ts'] });
  const sources = loadSources(root, files);
  const all = [...sources.values()];
  const isAppPath = (rel) => isUnder(rel, layout.srcDir) || isUnder(rel, layout.routesDir);
  const ctx = {
    root,
    layout,
    sources,
    appFiles: all.filter((src) => isAppPath(src.rel) && !src.isTest && !isServerFile(src.rel)),
    testFiles: all.filter((src) => src.isTest),
    add: (problem) => report.problem(problem),
    skip: (entry) => report.skip(entry),
    notYetCreated: (file, owner) => notYetCreated(root, { file, owner }),
  };
  const usesQuery = ctx.appFiles.some((src) => importsPackage(src, '@tanstack/react-query'));
  if (!usesQuery && !hasNetworkCode(ctx) && !existsSync(join(root, layout.apiDir))) {
    return report.notApplicable(`no app code imports @tanstack/react-query or calls the network, and there is no ${layout.apiDir}/`);
  }
  checkApiLayer(ctx);
  if (usesQuery) checkQueryLayer(ctx);
  return report.finish({ checked: ctx.appFiles.length + ctx.testFiles.length, unit: 'source files' });
});
