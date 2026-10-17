// query-rules.mjs: the TanStack Query rules of check-server-state (a helper, not an entry point): the
// signal in every queryFn, key factories, queries and mutations defined once in the API folder and
// read in model hooks, one client from one factory with a failure-aware retry policy, React Native
// focus and online wiring over the ConnectivityPort, deliberate cache effects and rollbacks, network
// mode and cache persistence.

import { posix } from 'node:path';

import { functionsOf, matchBracket } from './source-scan.mjs';
import { braceDepth, callArgumentRanges, codeMatches, enclosingObject, hasMarker, importsPackage, isUnder, memberCallRanges, objectEntries, siblingEntries, within } from './server-state-source.mjs';

const QUERY_HOOKS = ['useQuery', 'useSuspenseQuery', 'useInfiniteQuery', 'useSuspenseInfiniteQuery', 'useQueries', 'useSuspenseQueries', 'useMutation', 'useQueryClient', 'useIsFetching', 'useIsMutating', 'useMutationState', 'usePrefetchQuery', 'usePrefetchInfiniteQuery'];
const CACHE_EFFECT = /\b(?:invalidateQueries|setQueryData|setQueriesData|removeQueries|refetchQueries|resetQueries)\s*\(/;
const KEY_ARGUMENT_METHODS = /\.(?:setQueryData|getQueryData|getQueryState|ensureQueryData|prefetchQuery|fetchQuery|getQueriesData)\s*(?:<[^()]*>)?\s*\(\s*\[/g;

/** The value of the property whose key starts at `keyIndex` in an entries list, or null. */
function entryAt(entries, keyIndex) {
  return entries.find((entry) => entry.index === keyIndex) ?? null;
}

function checkQueryFns(ctx) {
  for (const src of ctx.appFiles) {
    for (const { index } of codeMatches(src, /\bqueryFn\s*:/g)) {
      const entry = entryAt(siblingEntries(src.code, index), index);
      const value = entry?.value ?? '';
      const inApi = isUnder(src.rel, ctx.layout.apiDir);
      if (!inApi) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-options', message: `a queryFn outside ${ctx.layout.apiDir}/: queries are defined once, with queryOptions, next to their keys`, fix: `Move it to ${ctx.layout.apiDir}/<resource>/<resource>-queries.ts (queryOptions) and call useQuery(<resource>Queries.x(api, ...)) in the model hook.` });
      } else if (!within(callArgumentRanges(src.code, '(?:queryOptions|infiniteQueryOptions)'), index)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-options', message: 'a queryFn that is not inside queryOptions(...): its key and data type are not tied together', fix: 'Wrap the options in queryOptions({ queryKey, queryFn }) (infiniteQueryOptions for pages).' });
      }
      if (/^skipToken$/.test(value) || inlineFunctionUsesSignal(value) || referencedFunctionUsesSignal(src, value)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-signal', message: 'a queryFn that does not pass TanStack\'s signal to the request: an abandoned or cancelled fetch keeps running to the end', fix: 'queryFn: ({ signal }) => unwrap(api.request({ ..., signal })).' });
    }
  }
}

/**
 * Whether the signal reaches the body: `signal` named there (not only destructured in the
 * parameters, which makes TanStack abort while the request runs on), or a single context parameter
 * handed on whole (`(context) => loadTasks(api, context)`).
 */
function signalReachesBody(params, body) {
  if (/\bsignal\b/.test(body)) return true;
  const whole = /^\s*([A-Za-z_$][\w$]*)\s*(?::[\s\S]*)?$/.exec(params);
  return whole !== null && new RegExp(`(?<![\\w$.])${whole[1].replace(/\$/g, '\\$')}\\b(?!\\s*\\.)`).test(body);
}

/** For an inline queryFn (`({ signal }) => ...`, `async function (context) { ... }`), whether it forwards the signal. */
function inlineFunctionUsesSignal(value) {
  const bare = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(value);
  if (bare !== null) return signalReachesBody(bare[1], value.slice(bare[0].length));
  const head = /^(?:async\s*)?(?:function\b[^(]*)?\(/.exec(value);
  if (head === null) return /^[A-Za-z_$][\w$]*$/.test(value) ? false : /\bsignal\b/.test(value);
  const open = head[0].length - 1;
  const close = matchBracket(value, open);
  if (close === -1) return /\bsignal\b/.test(value);
  return signalReachesBody(value.slice(open + 1, close), value.slice(close + 1));
}

/** For `queryFn: loadTasks`, whether that same-file function forwards a signal. */
function referencedFunctionUsesSignal(src, value) {
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return false;
  const fn = functionsOf(src.scan).find((candidate) => candidate.name === value);
  if (fn === undefined) return false;
  const close = matchBracket(src.code, fn.index);
  const end = fn.bodyEnd === -1 ? src.code.indexOf('\n', fn.index) : fn.bodyEnd;
  if (close === -1) return /\bsignal\b/.test(src.code.slice(fn.index, end));
  return signalReachesBody(src.code.slice(fn.index + 1, close), src.code.slice(close + 1, end));
}

function checkMutationFns(ctx) {
  for (const src of ctx.appFiles) {
    for (const { index } of codeMatches(src, /\bmutationFn\s*:/g)) {
      if (!isUnder(src.rel, ctx.layout.apiDir)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-options', message: `a mutationFn outside ${ctx.layout.apiDir}/: writes are defined once, with mutationOptions, with their cache effects`, fix: `Move it to ${ctx.layout.apiDir}/<resource>/<resource>-mutations.ts (mutationOptions) and call useMutation(<resource>Mutations.x(api, queryClient)) in the model hook.` });
      }
      const object = enclosingObject(src.code, index);
      if (object === null) continue;
      checkMutationObject(ctx, src, object, index);
    }
    for (const range of memberCallRanges(src.code, 'request')) {
      if (isUnder(src.rel, ctx.layout.apiDir) || !isApiRequest(src.code, range)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(range.callStart), rule: 'query-options', message: `an ApiClient request built outside ${ctx.layout.apiDir}/`, fix: 'Build requests in the resource\'s queryOptions or mutationOptions factory; the model hook calls useQuery/useMutation with it.' });
    }
  }
}

/** Whether a `.request(...)` call passes an ApiRequest literal ({ method, path, ... }), not, say, PermissionsAndroid.request. */
function isApiRequest(code, range) {
  const open = range.start + 1 + code.slice(range.start + 1).search(/\S/);
  if (code[open] !== '{') return false;
  const keys = new Set(objectEntries(code, { open, close: matchBracket(code, open) }).map((entry) => entry.key));
  return keys.has('method') && keys.has('path');
}

const NOT_CALLEES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function', 'async', 'void', 'new', 'Promise']);

/**
 * Whether a mutation callback (onSuccess, onSettled, onError) does what `pattern` matches (by default,
 * touches the cache): directly, or through a function it calls or names that is declared in the same
 * file or imported relatively from the same folder (`./task-cache`) and whose own body does. One
 * level deep.
 */
function callbackHasCacheEffect(ctx, src, value, pattern = CACHE_EFFECT) {
  if (pattern.test(value)) return true;
  const names = new Set([...value.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/g)].map((match) => match[1]).filter((name) => !NOT_CALLEES.has(name)));
  if (/^[A-Za-z_$][\w$]*$/.test(value)) names.add(value);
  return [...names].some((name) => functionHasCacheEffect(src, name, pattern) || importedFunctionHasCacheEffect(ctx, src, name, pattern));
}

/** The text of a function found by functionsOf: its braces, or an expression body up to the end of its statement. */
function functionText(code, fn) {
  if (fn.bodyEnd !== -1) return code.slice(fn.index, fn.bodyEnd);
  let depth = 0;
  for (let i = fn.index; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (depth < 0 || (depth === 0 && (c === ';' || c === ','))) return code.slice(fn.index, i);
  }
  return code.slice(fn.index);
}

function functionHasCacheEffect(src, name, pattern) {
  return functionsOf(src.scan).some((fn) => fn.name === name && pattern.test(functionText(src.code, fn)));
}

/** For `import { name } from './sibling'`, whether that sibling module's `name` matches `pattern`. */
function importedFunctionHasCacheEffect(ctx, src, name, pattern) {
  const dir = posix.dirname(src.rel);
  for (const entry of src.imports) {
    if (entry.typeOnly || !entry.spec.startsWith('./') || entry.spec.includes('/', 2)) continue;
    const clause = src.code.slice(src.code.lastIndexOf('import', entry.index), entry.index);
    if (!new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(clause)) continue;
    const base = posix.join(dir, entry.spec.replace(/\.[jt]sx?$/, ''));
    const target = ['.ts', '.tsx', '.js', '.jsx', '/index.ts'].map((ext) => ctx.sources.get(`${base}${ext}`)).find(Boolean);
    if (target !== undefined && functionHasCacheEffect(target, name, pattern)) return true;
  }
  return false;
}

function checkMutationObject(ctx, src, object, index) {
  const entries = objectEntries(src.code, object);
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const effects = ['onSuccess', 'onSettled'].some((key) => callbackHasCacheEffect(ctx, src, byKey.get(key)?.value ?? ''));
  if (!effects && !hasMarker(src, 'no-cache-effect', object.open, object.close)) {
    ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'mutation-cache', message: 'a mutation that never touches the cache: every list and detail it changed keeps showing the old data', fix: 'Invalidate (or set) the keys it changed in onSuccess or onSettled, or write // no-cache-effect: <why> inside the options when it changes no server state the app shows.' });
  }
  const retry = byKey.get('retry')?.value;
  if (retry !== undefined && !/^(?:false|0)$/.test(retry) && !byKey.has('idempotencyKey') && !/\bidempotencyKey\b/.test(src.code.slice(object.open, object.close))) {
    ctx.add({ file: src.rel, line: src.lineOf(byKey.get('retry').index), rule: 'retry-policy', message: 'a write that retries without an idempotency key: a retried POST can apply twice', fix: 'Send idempotencyKey (the server applies the write once) before letting it retry, or leave retry off.' });
  }
  checkOptimistic(ctx, src, byKey);
}

const SET_DATA = /\bsetQuer(?:y|ies)Data\s*(?:<[^()]*>)?\s*\(/;
const INVALIDATE = /\binvalidateQueries\s*\(/;

function checkOptimistic(ctx, src, byKey) {
  const onMutate = byKey.get('onMutate');
  if (onMutate === undefined || !/\bsetQuer(?:y|ies)Data\s*(?:<[^()]*>)?\s*\(/.test(onMutate.value)) return;
  const missing = [];
  if (!/\bcancelQueries\s*\(/.test(onMutate.value)) missing.push(['onMutate does not cancelQueries first: a refetch in flight overwrites the optimistic value', 'await queryClient.cancelQueries({ queryKey }) before setQueryData.']);
  if (!/\bgetQuer(?:y|ies)Data\s*(?:<[^()]*>)?\s*\(/.test(onMutate.value)) missing.push(['onMutate saves no snapshot to roll back to', 'const previous = queryClient.getQueryData(key) (getQueriesData for every list) and return it.']);
  if (!callbackHasCacheEffect(ctx, src, byKey.get('onError')?.value ?? '', SET_DATA)) missing.push(['no onError restores the snapshot: a refused write stays on screen as if it happened', 'onError: (_error, _input, snapshot) => restore every saved key with setQueryData.']);
  if (!callbackHasCacheEffect(ctx, src, byKey.get('onSettled')?.value ?? '', INVALIDATE)) missing.push(['no onSettled refetches: the cache keeps the client\'s guess instead of the server\'s answer', 'onSettled: () => queryClient.invalidateQueries({ queryKey }).']);
  for (const [message, fix] of missing) ctx.add({ file: src.rel, line: src.lineOf(onMutate.index), rule: 'optimistic-rollback', message, fix });
}

function checkKeys(ctx) {
  for (const src of ctx.appFiles) {
    const isFactory = /-keys\.[jt]sx?$/.test(src.rel);
    if (!isFactory) {
      for (const { index, match } of codeMatches(src, /\b(queryKey|mutationKey)\s*:\s*\[/g)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-key-factory', message: `an inline ${match[1]} array: one typo and an invalidation misses it`, fix: `Take the key from the resource's key factory (${ctx.layout.apiDir}/<resource>/<resource>-keys.ts: <resource>Keys.list(filter)).` });
      }
      for (const { index } of codeMatches(src, KEY_ARGUMENT_METHODS)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-key-factory', message: 'an inline query key passed to the QueryClient', fix: 'Pass <resource>Keys.x(...) from the key factory.' });
      }
      continue;
    }
    // A *-keys.ts file is a TanStack key factory only in the api folder or when it exports <x>Keys:
    // secure-storage key names or i18n message keys are not query keys.
    const isQueryKeys = isUnder(src.rel, ctx.layout.apiDir) || /\bexport\s+const\s+[a-z][\w$]*Keys\b/.test(src.code);
    if (!isQueryKeys) continue;
    if (!/\bas\s+const\b/.test(src.code) || !/\ball\s*:/.test(src.code)) {
      ctx.add({ file: src.rel, line: 1, rule: 'query-key-factory', message: 'a key factory without an `all` root key and `as const` keys', fix: 'Export { all: [\'<resource>\'] as const, lists: () => [...all, \'list\'] as const, ... }: hierarchical, readonly tuples.' });
    }
  }
}

function isAllowedHookFile(ctx, rel) {
  const { featuresDir, apiDir, srcDir } = ctx.layout;
  return isUnder(rel, apiDir) || isUnder(rel, `${srcDir}/hooks`) || (isUnder(rel, featuresDir) && /\/use-[a-z0-9-]+\.[jt]sx?$/.test(rel));
}

function checkHookHome(ctx) {
  const pattern = new RegExp(`(?<![\\w$.])(${QUERY_HOOKS.join('|')})\\s*(?:<[^()]*>)?\\s*\\(`, 'g');
  for (const src of ctx.appFiles) {
    if (isAllowedHookFile(ctx, src.rel) || !importsPackage(src, '@tanstack/react-query')) continue;
    for (const { index, match } of codeMatches(src, pattern)) {
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-hook-home', message: `${match[1]} in ${src.rel}: server state is read in the feature's model hook`, fix: `Call it in ${ctx.layout.featuresDir}/<feature>/use-<feature>-model.ts and hand the view plain props.` });
    }
  }
}

function enclosingFunctionName(src, index) {
  const containing = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && index > fn.bodyStart && index < fn.bodyEnd);
  return containing.at(-1)?.name ?? null;
}

function checkClientCreation(ctx) {
  const factories = ctx.appFiles.filter((src) => isUnder(src.rel, ctx.layout.apiDir) && /\bnew\s+QueryClient\s*\(/.test(src.code));
  if (factories.length === 0) {
    ctx.add({ file: `${ctx.layout.apiDir}/create-query-client.ts`, line: 1, rule: 'query-client', message: 'no QueryClient factory in the API folder', fix: 'Copy templates/src/api/create-query-client.ts (retry policy, stale time, one place that records bugs).' });
  }
  for (const src of ctx.appFiles) {
    const useStates = callArgumentRanges(src.code, 'useState');
    for (const { index, match } of codeMatches(src, /\bnew\s+QueryClient\s*\(|(?<![\w$.])(createQueryClient)\s*\(/g)) {
      const isNew = match[1] === undefined;
      if (isNew && !factories.includes(src)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-client', message: 'a QueryClient made outside the factory', fix: 'Call createQueryClient() (the root layout, once); tests use the client test/test-app.tsx builds.' });
        continue;
      }
      if (/^\s*export\s+function\b/.test(src.code.slice(src.code.lastIndexOf('\n', index) + 1)) || within(useStates, index)) continue;
      const line = src.code.slice(src.code.lastIndexOf('\n', index) + 1, index);
      const fnName = enclosingFunctionName(src, index);
      if (braceDepth(src.code, index) === 0 && !/=>|\bfunction\b/.test(line)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-client', message: 'a QueryClient created at module level: it outlives logout, Fast Refresh and every test that imports the file', fix: 'Create it in the root layout\'s useState initializer (or a startApp function it calls).' });
      } else if (fnName !== null && /^(?:[A-Z]|use[A-Z])/.test(fnName) && !factories.includes(src)) {
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'query-client', message: `a QueryClient created in the body of ${fnName}: every render makes a new, empty cache`, fix: 'Create it once: const [queryClient] = useState(() => createQueryClient({ errorLog })).' });
      }
    }
  }
}

function checkRetryPolicy(ctx) {
  for (const src of ctx.appFiles) {
    for (const { index, match } of codeMatches(src, /\bretry\s*:\s*(true|Infinity|\d+)\b/g)) {
      if (/^\d+$/.test(match[1]) && Number(match[1]) <= 3) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'retry-policy', message: `retry: ${match[1]} retries every failure ${match[1] === 'true' || match[1] === 'Infinity' ? 'forever' : `${match[1]} times`}, a 404 and a schema mismatch included`, fix: 'Let the factory\'s shouldRetryQuery decide (retryable failures only, at most 3 times).' });
    }
  }
  const factory = ctx.appFiles.find((src) => isUnder(src.rel, ctx.layout.apiDir) && /\bnew\s+QueryClient\s*\(/.test(src.code));
  if (factory !== undefined && !/\bretry\s*:\s*(?:[A-Za-z_$][\w$]*|\()/.test(factory.code.replace(/\bretry\s*:\s*(?:true|false)\b/g, ''))) {
    ctx.add({ file: factory.rel, line: factory.lineOf(factory.code.search(/\bnew\s+QueryClient\s*\(/)), rule: 'retry-policy', message: 'the QueryClient keeps TanStack\'s default retry: three retries of every error, a 404 and an invalid body included (about seven seconds of spinner)', fix: 'defaultOptions.queries.retry: shouldRetryQuery (retryable ApiFailures only) and retryDelay: queryRetryDelay (honours Retry-After).' });
  }
}

function checkManagers(ctx) {
  const online = ctx.appFiles.filter((src) => /\bonlineManager\s*\.\s*setEventListener\s*\(/.test(src.code));
  const focus = ctx.appFiles.filter((src) => /\bfocusManager\s*\.\s*(?:setEventListener|setFocused)\s*\(/.test(src.code));
  const target = `${ctx.layout.apiDir}/query-managers.ts`;
  if (online.length === 0) ctx.add({ file: target, line: 1, rule: 'managers-wired', message: 'nothing feeds TanStack\'s onlineManager: React Native has no window online events, so queries never pause offline or resume on reconnect', fix: 'Copy templates/src/api/query-managers.ts (onlineManager over the ConnectivityPort) and mount QueryProvider.' });
  if (focus.length === 0) ctx.add({ file: target, line: 1, rule: 'managers-wired', message: 'nothing feeds TanStack\'s focusManager: returning to the app never refetches stale data', fix: 'Copy templates/src/api/query-managers.ts (focusManager over AppState).' });
  if (online.length > 0 && focus.length > 0) checkMounted(ctx, [...new Set([...online, ...focus])]);
}

/** Whether `src` imports one of the modules in `files` (matched by file name, any path form). */
function importsOneOf(src, files) {
  const stems = new Set(files.map((file) => file.rel.replace(/\.[jt]sx?$/, '').split('/').pop()));
  return src.imports.some((entry) => !entry.typeOnly && stems.has(entry.spec.split('/').pop()));
}

/**
 * The client must be mounted where the app starts: some file outside the API folder renders
 * <QueryProvider> (which wires the managers), or renders <QueryClientProvider> and imports the wiring.
 */
function checkMounted(ctx, wiringFiles) {
  const outside = ctx.appFiles.filter((src) => !isUnder(src.rel, ctx.layout.apiDir));
  const isMounted = outside.some((src) => /<\s*QueryProvider\b/.test(src.code) || (/<\s*QueryClientProvider\b/.test(src.code) && importsOneOf(src, wiringFiles)));
  if (isMounted) return;
  const layout = `${ctx.layout.routesDir}/_layout.tsx`;
  const reason = ctx.notYetCreated(layout, 'navigation-and-routing');
  if (reason) {
    ctx.skip({ file: layout, rule: 'managers-wired', message: reason });
    return;
  }
  ctx.add({ file: layout, line: 1, rule: 'managers-wired', message: 'no app file renders <QueryProvider>: the client is never mounted, and the focus and online wiring never runs', fix: 'Render <QueryProvider client={queryClient} connectivity={services.connectivity}> in the root layout, inside ServicesProvider, with the client from its useState initializer.' });
}

const CONNECTIVITY_PACKAGES = ['expo-network', '@react-native-community/netinfo'];

function checkConnectivityPort(ctx) {
  const dir = `${ctx.layout.servicesDir}/connectivity`;
  const port = `${dir}/connectivity-port.ts`;
  if (!ctx.sources.has(port)) {
    ctx.add({ file: port, line: 1, rule: 'connectivity-port', message: 'no ConnectivityPort: the onlineManager, offline banners, ads and purchases need one shared answer to "online?"', fix: 'Copy templates/src/services/connectivity/ (port, expo-network adapter, fake and tests) and create the adapter once in the composition root.' });
  }
  const isAdapter = (rel) => rel.startsWith(`${dir}/`) && /^[^/]+-adapter(?:\.(?:ios|android|native|web))?\.tsx?$/.test(rel.slice(dir.length + 1));
  for (const src of ctx.appFiles) {
    if (isAdapter(src.rel)) continue;
    for (const spec of CONNECTIVITY_PACKAGES) {
      const entry = src.imports.find((candidate) => candidate.spec === spec || candidate.spec.startsWith(`${spec}/`));
      if (entry === undefined) continue;
      const isWiring = /\bonlineManager\s*\.\s*setEventListener\s*\(/.test(src.code);
      ctx.add({ file: src.rel, line: src.lineOf(entry.index), rule: 'connectivity-port', message: isWiring ? `the onlineManager listens to ${spec} directly: a second native subscription the app cannot simulate or share` : `${spec} imported outside ${dir}/*-adapter.ts: a second native subscription (on iOS it can cancel the module's only monitor for good) that a simulated offline switch never reaches`, fix: isWiring ? 'Feed it from the ConnectivityPort: onlineManager.setEventListener((setOnline) => { setOnline(connectivity.isOnline()); return connectivity.subscribe(setOnline); }).' : 'Read services.connectivity instead (isOnline/subscribe, or reachability/subscribeReachability for a banner); a new network fact becomes a port method the adapter implements.' });
    }
    checkOnlineFedFromReachability(ctx, src);
  }
}

/**
 * The onlineManager follows isOnline()/subscribe, never the reachability hint: an Android network
 * that never validates stays `unvalidated` for good, and pausing on it keeps every query paused.
 * Looks inside the listener passed to each onlineManager.setEventListener(...) call only.
 */
function checkOnlineFedFromReachability(ctx, src) {
  for (const { index, match } of codeMatches(src, /\bonlineManager\s*\.\s*setEventListener\s*\(/g)) {
    const open = index + match[0].length - 1;
    const close = matchBracket(src.code, open);
    if (close === -1) continue;
    const hit = /\.\s*(?:reachability|subscribeReachability)\s*\(|\bisInternetReachable\b/.exec(src.code.slice(open, close));
    if (hit === null) continue;
    ctx.add({ file: src.rel, line: src.lineOf(open + hit.index), rule: 'connectivity-port', message: 'the onlineManager is fed from reachability: an Android network that never validates stays unvalidated for good, so every query and mutation stays paused although requests would succeed', fix: 'Feed it isOnline()/subscribe: setOnline(connectivity.isOnline()); return connectivity.subscribe(setOnline). Show reachability() in a banner instead.' });
  }
}

function checkNetworkMode(ctx) {
  for (const src of ctx.appFiles) {
    for (const { index } of codeMatches(src, /\bnetworkMode\s*:\s*['"`]/g)) {
      const literal = src.scan.strings.find((entry) => entry.index > index && entry.index < index + 20);
      if (literal?.value !== 'always') continue;
      const object = enclosingObject(src.code, index);
      if (object !== null && hasMarker(src, 'network-mode-always', object.open, object.close)) continue;
      ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'network-mode', message: "networkMode 'always' runs requests while offline: they fail, retry and show errors instead of pausing", fix: "Keep the default 'online' (paused while offline, resumed on reconnect); a query that never touches the network (a local read) says so with // network-mode-always: <why>." });
    }
  }
}

const PERSIST_PACKAGES = ['@tanstack/react-query-persist-client', '@tanstack/query-persist-client-core', '@tanstack/query-async-storage-persister', '@tanstack/query-sync-storage-persister'];

/**
 * The keys of the persist options that start at `at` (just after `persistOptions={`, `persistOptions:`
 * or `persistQueryClient(`): an inline object literal, or a same-file `const name = { ... }` it names.
 * Null when neither is readable (the caller then reads the next 600 characters).
 */
function persistOptionKeys(src, at) {
  const code = src.code;
  const start = at + code.slice(at).search(/\S/);
  if (code[start] === '{') {
    const close = matchBracket(code, start);
    return close === -1 ? null : new Set(objectEntries(code, { open: start, close }).map((entry) => entry.key));
  }
  const name = /^([A-Za-z_$][\w$]*)\s*[}),]/.exec(code.slice(start))?.[1];
  if (name === undefined) return null;
  const declaration = new RegExp(`\\b(?:const|let)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\{`).exec(code);
  if (declaration === null) return null;
  const open = declaration.index + declaration[0].length - 1;
  const close = matchBracket(code, open);
  return close === -1 ? null : new Set(objectEntries(code, { open, close }).map((entry) => entry.key));
}

function checkPersistence(ctx) {
  for (const src of ctx.appFiles) {
    if (!PERSIST_PACKAGES.some((spec) => importsPackage(src, spec))) continue;
    for (const { index, match } of codeMatches(src, /\b(?:persistOptions\s*=\s*\{|persistQueryClient\s*\(|persistOptions\s*:)/g)) {
      const keys = persistOptionKeys(src, index + match[0].length);
      const segment = src.code.slice(index, index + 600);
      for (const key of ['buster', 'maxAge']) {
        if (keys === null ? new RegExp(`\\b${key}\\s*[:,}]`).test(segment) : keys.has(key)) continue;
        ctx.add({ file: src.rel, line: src.lineOf(index), rule: 'persist-cache', message: `a persisted query cache without ${key}: ${key === 'buster' ? 'after a schema change the app restores data in the old shape, which no schema checked' : 'restored data can be any age'}`, fix: `Set ${key} (buster: the API schema version; maxAge no longer than the queries' gcTime).` });
      }
    }
  }
}

/** Runs every TanStack Query rule. */
export function checkQueryLayer(ctx) {
  checkQueryFns(ctx);
  checkMutationFns(ctx);
  checkKeys(ctx);
  checkHookHome(ctx);
  checkClientCreation(ctx);
  checkRetryPolicy(ctx);
  checkManagers(ctx);
  checkConnectivityPort(ctx);
  checkNetworkMode(ctx);
  checkPersistence(ctx);
}
