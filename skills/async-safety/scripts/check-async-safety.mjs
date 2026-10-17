#!/usr/bin/env node
// check-async-safety.mjs: proves the async rules of an Expo app that ESLint and tsc cannot see: no
// promise handed by reference to a slot that ignores it, callback types that return void, effects
// that cancel the async work they start, abort code that works on the device (not only in Jest),
// every subscription handle released, every timer id cleared, and screen work scoped to focus.
// Usage: node check-async-safety.mjs [repo-root] [options]   (see --help)

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, matchGlob, parseArgs, resolveLayout, run } from './check-lib.mjs';
import {
  callArguments,
  chainStart,
  effectBlocks,
  escapeRegExp,
  holderOf,
  inRegions,
  isReleased,
  memberReturnIndex,
  promiseFunctions,
  readAppSources,
  readPackageJson,
  repoDependsOn,
  stateSetters,
  topLevelCleanup,
} from './lib/async-scan.mjs';
import { matchBracket, typeRegionsOf } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-async-safety',
  summary:
    'Checks the async rules of a React Native app that ESLint and tsc cannot see: promises passed by reference, callback types, effect races, device abort APIs, subscription handles, timer ids and focus-scoped screen work.',
  usage: '[repo-root] [options]',
  options: {
    'src-dir': { type: 'string', value: 'dir', help: 'App source folder (default: from resolveLayout, src)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (test files, __mocks__ and test/ are skipped):',
    '  async-by-reference     a promise-returning function goes by reference into a JSX on* prop, an on* object property',
    '                         (a model field) or a listener registration: an async function or one annotated Promise<...>',
    '                         of the same file, a member whose type returns Promise<...> everywhere it is declared (also',
    '                         when destructured: const { save } = useModel()), an',
    '                         *Async name, Linking.openURL/openSettings, Share.share, StoreReview.requestReview, or a name',
    '                         in "promiseFunctions" (not onMutate/onSuccess/onError/onSettled inside mutationOptions(),',
    '                         useMutation() or new MutationCache(), which TanStack Query awaits)',
    '  void-callback-type     an on*/handle* member or prop type returns Promise<...>, PromiseLike<...> or unknown (type',
    '                         annotations only: () => Promise.all(...) as a value is an implementation, not read)',
    '  effect-stale-result    a useEffect/useLayoutEffect/useFocusEffect whose async continuation (await, .then/.catch/',
    '                         .finally, or a same-file async function that sets state) sets state (a setter, a Zustand',
    '                         action from use*Store() or use*Store.getState().action()), dispatches or',
    '                         navigates, and whose cleanup neither aborts (with .aborted read after each await that',
    '                         precedes a write) nor flips a flag the continuation checks; a write whose argument awaits',
    '                         (setX(await y)); a mounted ref (ref.current = false) in an effect with dependencies; or an',
    '                         effect that awaits a watch*Async() subscription without such a guard. The cleanup is the',
    '                         last top-level return <expr> (a bare guard-clause return; is skipped); an effect that only',
    '                         calls same-file latest-wins actions (latest.start(), .aborted, latest.cancel()) is accepted',
    '  abort-signal           abort code that passes in Jest and fails on the device: signal.throwIfAborted(), reading',
    '                         signal.reason, AbortSignal.abort(), addEventListener(..., { signal }), deciding',
    '                         cancellation by error.name === "AbortError" or instanceof DOMException',
    '  subscription-released  the handle of addEventListener/addListener/add*Listener/subscribe/watch*() is dropped, or',
    '                         kept and never removed, called, returned or handed over (an EventTarget listener may',
    '                         instead be removed with removeEventListener for the same event, or use { once: true });',
    '                         Keyboard/DeviceEventEmitter.removeAllListeners(). A listener or timer that lives as long',
    '                         as the app (created once by the composition root, in a .ts file outside the screen',
    '                         folders) carries "// app-lifetime: <why>" on or above its line',
    '  timer-cleared          the id of setTimeout/setInterval/requestAnimationFrame/requestIdleCallback is dropped (a',
    '                         bare statement, a Promise executor body), or kept and never passed to its clear function',
    '  focus-scoped-work      (with expo-router or @react-navigation/native) a useEffect in a screen folder runs an',
    '                         interval, a watch*Async() subscription or a sensor listener: use useFocusEffect',
    'rn-skills.config.json "asyncSafety": { "promiseFunctions": ["name", ...], "focusDirs": ["src/features", "src/app"] }',
    'NOT APPLICABLE when package.json (root or a workspace) lists no react-native. Exit 2 when package.json or the',
    'source folder is missing. When multi-package: run once per app or package with --src-dir apps/<app>/src.',
  ].join('\n'),
};

const KNOWN_PROMISE_MEMBERS = new Set(['Linking.openURL', 'Linking.openSettings', 'Share.share', 'StoreReview.requestReview']);
const RELEASE_CALLS = 'remove|unsubscribe|cancel|stop|close|dispose|release|disconnect|off';
const CLEAR_OF = {
  setTimeout: 'clearTimeout',
  setInterval: 'clearInterval',
  requestAnimationFrame: 'cancelAnimationFrame',
  requestIdleCallback: 'cancelIdleCallback',
};
const NAVIGATION = /\b(?:router|navigation|navigator)\s*\??\.\s*(?:push|replace|navigate|back|goBack|dismiss\w*|reset|setParams|dispatch)\s*\(/;
/** A Zustand action called outside React: useTaskStore.getState().select(value). */
const STORE_ACTION = /\buse[A-Z][\w$]*Store\s*\.\s*getState\s*\(\s*\)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/;
/**
 * A mutation awaits a promise these callbacks return (verified in @tanstack/query-core 5.104.0
 * mutation.js), so an async function by reference is fine inside mutationOptions/useMutation/new
 * MutationCache. QueryCache callbacks and mutate(vars, { onSuccess }) are not awaited: still flagged.
 */
const AWAITED_CALLBACK = /^on(?:Mutate|Success|Error|Settled)$/;
const AWAITING_CALLS = /(?<![\w$.])(?:mutationOptions|useMutation|new\s+MutationCache)\s*\(/g;
const SENSORS = /\b(?:Accelerometer|Gyroscope|Magnetometer|MagnetometerUncalibrated|DeviceMotion|Barometer|Pedometer|LightSensor)\s*\.\s*addListener\s*\(/;
const REF = '[A-Za-z_$][\\w$]*(?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*';
const DETAILS_FIX = 'examples/use-task-details-model.ts in the async-safety skill';

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: SPEC.name, json: options.json });
  const pkg = readPackageJson(root);
  if (pkg === null) fail(`no package.json in ${root}`, 'Pass the app repo root (the folder with package.json).');
  if (pkg.invalid) fail(`package.json in ${root} is not valid JSON`, 'Fix package.json, then rerun.');
  if (!repoDependsOn(root, pkg, 'react-native')) return report.notApplicable('react-native is not in package.json');
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: ${layout.srcDir}/ does not exist`, 'Pass the app repo root, or --src-dir <dir>.');
  const config = readConfig(layout);
  const files = readAppSources(root, layout.srcDir);
  const app = files.filter((file) => !file.isTest);
  const focusDirs = config.focusDirs ?? [layout.featuresDir, layout.routesDir];
  const context = {
    report,
    focusDirs,
    promiseMembers: memberReturnIndex(app),
    extraPromise: new Set(config.promiseFunctions),
  };
  const hasRouter = repoDependsOn(root, pkg, 'expo-router') || repoDependsOn(root, pkg, '@react-navigation/native');
  for (const file of app) {
    checkByReference(file, context);
    checkCallbackTypes(file, context);
    checkEffects(file, context);
    checkAbortApis(file, context);
    checkSubscriptions(file, context);
    checkTimers(file, context);
    if (hasRouter && context.focusDirs.some((dir) => matchGlob(file.rel, `${dir}/**`))) checkFocusWork(file, context);
  }
  if (!hasRouter) report.note('focus-scoped-work not applied: neither expo-router nor @react-navigation/native is a dependency');
  return report.finish({ checked: files.length, unit: 'source files' });
}

function readConfig(layout) {
  const raw = layout.config?.asyncSafety ?? {};
  const fix = 'rn-skills.config.json "asyncSafety" is { "promiseFunctions": [names], "focusDirs": [repo-relative folders] }.';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('"asyncSafety" in rn-skills.config.json is not an object', fix);
  const list = (key) => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) fail(`"asyncSafety.${key}" is not a list of names`, fix);
    return value.map((item) => item.replace(/\/$/, ''));
  };
  return { promiseFunctions: list('promiseFunctions') ?? [], focusDirs: list('focusDirs') };
}

function problem(context, file, index, rule, message, fix) {
  context.report.problem({ file: file.rel, line: file.scan.lineOf(index), rule, message, fix });
}

// --- async-by-reference ---------------------------------------------------------------------------

function checkByReference(file, context) {
  const { code } = file.scan;
  const local = new Set(promiseFunctions(file.scan).map((fn) => fn.name));
  const destructured = destructuredMembers(code);
  const types = typeRegionsOf(code);
  const isPromiseRef = (ref) => {
    const parts = ref.replace(/\s+/g, '').replace(/\?\./g, '.').split('.');
    const last = parts.at(-1);
    if (context.extraPromise.has(last) || /Async$/.test(last)) return true;
    if (parts.length === 1) return local.has(last) || (destructured.has(last) && context.promiseMembers.has(destructured.get(last)));
    return KNOWN_PROMISE_MEMBERS.has(parts.slice(-2).join('.')) || context.promiseMembers.has(last);
  };
  const flag = (index, ref, slot) => {
    const name = ref.replace(/\s+/g, '');
    problem(context, file, index, 'async-by-reference', `${name} returns a promise and goes by reference into ${slot}, which ignores what it returns, so a rejection is lost`, `Pass a synchronous function that ends the promise, () => { ${name}().catch(reportError); }, and type the slot to return void.`);
  };
  for (const match of code.matchAll(new RegExp(`(?<![\\w$.-])(on[A-Z][\\w$]*)\\s*=\\s*\\{\\s*(${REF})\\s*\\}`, 'g'))) {
    if (isPromiseRef(match[2])) flag(match.index, match[2], `${match[1]} (a JSX prop)`);
  }
  const awaiting = [...code.matchAll(AWAITING_CALLS)].map((match) => [match.index, matchBracket(code, match.index + match[0].length - 1)]);
  const isAwaited = (name, index) => AWAITED_CALLBACK.test(name) && inRegions(awaiting, index);
  for (const match of code.matchAll(new RegExp(`(?<![\\w$.])(on[A-Z][\\w$]*)\\s*:\\s*(${REF})\\s*(?=[,}\\n;])`, 'g'))) {
    if (!inRegions(types, match.index) && !isAwaited(match[1], match.index) && isPromiseRef(match[2])) flag(match.index, match[2], `${match[1]} (an object property)`);
  }
  for (const match of code.matchAll(/[{,]\s*(on[A-Z][\w$]*)\s*(?=[,}])/g)) {
    if (local.has(match[1]) && !inRegions(types, match.index) && !isAwaited(match[1], match.index)) flag(match.index, match[1], `${match[1]} (an object property)`);
  }
  for (const match of code.matchAll(/(?:\.\s*(add[A-Z]?[\w$]*Listener|subscribe)|(?<![\w$.])(add[A-Z][\w$]*Listener))\s*\(/g)) {
    const args = callArguments(code, match.index + match[0].length - 1);
    const last = args.at(-1)?.text.trim() ?? '';
    if (new RegExp(`^${REF}$`).test(last) && isPromiseRef(last)) flag(match.index, last, `the listener of ${match[1] ?? match[2]}()`);
  }
}

/**
 * Names bound by object destructuring in the file, mapped to the member they read:
 * `const { saveNote, reload: refresh } = useNotesModel();` gives saveNote → saveNote, refresh → reload.
 */
function destructuredMembers(code) {
  const out = new Map();
  for (const match of code.matchAll(/\b(?:const|let|var)\s*\{([^{}]*)\}\s*(?::[^=;]*)?=/g)) {
    for (const part of match[1].split(',')) {
      const bound = /^\s*(?:\.\.\.)?\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=[^,]*)?$/.exec(part);
      if (bound && !part.trim().startsWith('...')) out.set(bound[2] ?? bound[1], bound[1]);
    }
  }
  return out;
}

// --- void-callback-type ---------------------------------------------------------------------------

function checkCallbackTypes(file, context) {
  // Only a return that reads as a TYPE counts: `Promise<`, `PromiseLike<`, or `unknown` not followed
  // by `.` or `(`. A value such as `onSuccess: () => Promise.all([...])` (TanStack awaits it) or
  // `handleNotification: () => Promise.resolve({...})` is an implementation, not a callback type.
  const member = /(?<![\w$.])((?:on|handle)[A-Z][\w$]*)\??\s*:\s*(?:<[^<>()]*>\s*)?\((?:[^()]|\([^()]*\))*\)\s*=>\s*(?:(Promise|PromiseLike)\s*<|(unknown)\b(?!\s*[.(]))/g;
  for (const match of file.scan.code.matchAll(member)) {
    const what = match[3] === 'unknown' ? 'unknown' : 'a promise';
    problem(context, file, match.index, 'void-callback-type', `${match[1]} is typed to return ${what}, so an async function passes into it silently`, `Type it to return void (${match[1]}: (...) => void): no-misused-promises then rejects a promise-returning function, and the implementation starts its async work with .catch(reportError).`);
  }
}

// --- effect-stale-result --------------------------------------------------------------------------

/** Same-file async functions that write state, by name, with their bodies. */
function statefulAsync(file, setters) {
  const { code } = file.scan;
  const names = new Map();
  for (const fn of promiseFunctions(file.scan)) {
    if (fn.bodyStart === -1) continue;
    const text = code.slice(fn.bodyStart, fn.bodyEnd);
    if (writesState(text, setters, new Map())) names.set(fn.name, text);
  }
  return names;
}

function callsAny(text, names) {
  return [...names.keys()].some((name) => new RegExp(`(?<![\\w$.])${escapeRegExp(name)}\\s*\\(`).test(text));
}

function writesState(text, setters, stateful) {
  if (/\.setState\s*\(/.test(text) || STORE_ACTION.test(text) || NAVIGATION.test(text) || callsAny(text, stateful)) return true;
  return [...setters].some((name) => new RegExp(`(?<![\\w$.])${escapeRegExp(name)}\\s*\\(|\\.then\\s*\\(\\s*${escapeRegExp(name)}\\s*[,)]`).test(text));
}

function guardOf(cleanup) {
  if (cleanup === null) return null;
  if (/\.(?:cancel|invalidate)\s*\(/.test(cleanup)) return { kind: 'cancel' };
  if (/\.abort\s*\(/.test(cleanup)) return { kind: 'abort' };
  const ref = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\.\s*current\s*=\s*(?:false|true)\b/.exec(cleanup);
  if (ref) return { kind: 'ref', name: `${ref[1]}.current` };
  const flag = /(?<![\w$.=!<>])([A-Za-z_$][\w$]*)\s*=\s*(?:false|true)\b/.exec(cleanup);
  if (flag) return { kind: 'flag', name: flag[1] };
  if (/^\s*[A-Za-z_$][\w$.]*\s*;?\s*$/.test(cleanup)) return { kind: 'opaque' };
  return null;
}

/** A regex that finds a read of the guard: `.aborted`, the flag, or `<ref>.current`. */
function guardRead(guard) {
  if (guard.kind === 'abort') return /\.aborted\b/;
  const n = escapeRegExp(guard.name).replace(/\\\./g, '\\s*\\??\\.\\s*');
  return new RegExp(`(?<![\\w$.])${n}\\b`);
}

/**
 * A guard counts only when it is read before each write that follows async work: in every
 * .then/.catch/.finally callback that writes and in every stretch between one `await` and the next
 * that writes (one check after the first await does not cover a write after a second await). For an
 * abort, every same-file async function the effect calls must read `.aborted` too: passing the
 * signal is not enough, since a port that resolves (a Result, a cached value) instead of rejecting
 * still hands the stale answer to the write.
 */
function isGuardChecked(guard, body, setters, stateful) {
  if (guard.kind === 'cancel' || guard.kind === 'opaque') return true;
  const read = guardRead(guard);
  if (guard.kind === 'abort') {
    const helpers = [...stateful].filter(([name]) => callsAny(body, new Map([[name, '']])));
    if (helpers.some(([, text]) => !read.test(text))) return false;
  } else if ((body.match(new RegExp(read.source, 'g')) ?? []).length < 2) {
    return false;
  }
  return continuationParts(body).every((part) => !writesState(part, setters, new Map()) || read.test(part));
}

/**
 * The parts of an effect body that run after async work: the arguments of .then/.catch/.finally,
 * and everything after the first await. A setter called by a listener the effect registers is not one.
 */
function continuationText(body) {
  return continuationParts(body).join('\n');
}

/** Each .then/.catch/.finally call of an effect body, and each stretch from one await to the next. */
function continuationParts(body) {
  const parts = [];
  for (const match of body.matchAll(/\.(?:then|catch|finally)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(body, open);
    if (close !== -1) parts.push(body.slice(match.index, close + 1));
  }
  const awaits = [...body.matchAll(/\bawait\b/g)].map((match) => match.index);
  awaits.forEach((at, i) => parts.push(body.slice(at, awaits[i + 1] ?? body.length)));
  return parts;
}

/** A write whose argument awaits (`setTitle(await repo.get(id))`): it runs the moment the await resolves. */
function awaitedWrite(body, setters) {
  const names = [...setters].map(escapeRegExp);
  const callee = names.length === 0 ? '\\.\\s*setState' : `(?:\\.\\s*setState|(?<![\\w$.])(?:${names.join('|')}))`;
  return new RegExp(`${callee}\\s*\\([^()]*\\bawait\\b`).exec(body)?.[0].replace(/\s*\([^]*$/, '').replace(/^\.\s*/, '.') ?? null;
}

/**
 * A same-file async function that is latest-wins on its own (effects-and-races.md, section 7): it starts
 * a latest request (`const signal = latest.start();`), reads `.aborted`, and the file cancels that
 * holder (`useEffect(() => () => { latest.cancel(); }, [latest])`). An effect that only calls it needs
 * no cleanup of its own: the next run's start() aborts the older call and unmount cancels the last.
 */
function isLatestWins(text, code) {
  const holder = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\??\.\s*start\s*\(\s*\)/.exec(text);
  if (!holder || !/\.aborted\b/.test(text)) return false;
  return new RegExp(`(?<![\\w$.])${escapeRegExp(holder[1])}\\s*\\??\\.\\s*cancel\\s*\\(`).test(code);
}

function checkEffects(file, context) {
  const { code } = file.scan;
  const setters = stateSetters(code);
  const stateful = statefulAsync(file, setters);
  for (const effect of effectBlocks(code)) {
    const cleanup = topLevelCleanup(code, effect.open, effect.close);
    const body = cleanup === null ? effect.inner : effect.inner.slice(0, effect.inner.length - cleanup.length);
    const isWatch = /(?<![\w$])watch[A-Z][\w$]*Async\s*\(/.test(body);
    const inlineWrite = awaitedWrite(body, setters);
    const isStaleWrite = inlineWrite !== null || callsAny(body, stateful) || writesState(continuationText(body), setters, new Map());
    if (!isStaleWrite && !isWatch) continue;
    const guard = guardOf(cleanup);
    if (guard === null && !isWatch && inlineWrite === null && !writesState(continuationText(body), setters, new Map())) {
      const called = [...stateful].filter(([name]) => callsAny(body, new Map([[name, '']])));
      if (called.length > 0 && called.every(([, text]) => isLatestWins(text, code))) continue;
    }
    if (guard === null) {
      const message = isWatch && !isStaleWrite
        ? `the ${effect.hook} awaits a watch*Async() subscription; if its cleanup runs first, the subscription arrives afterwards and is never removed`
        : `the ${effect.hook} sets state, dispatches or navigates after async work, and its cleanup neither aborts that work nor marks it stale`;
      const fix = isWatch && !isStaleWrite
        ? 'let isActive = true; watchXAsync(...).then((sub) => { if (isActive) subscription = sub; else sub.remove(); }).catch(reportError); return () => { isActive = false; subscription?.remove(); };'
        : `Create an AbortController in the effect, pass its signal to the work, check signal.aborted before each write, and return () => { controller.abort(); } (${DETAILS_FIX}).`;
      problem(context, file, effect.index, 'effect-stale-result', message, fix);
      continue;
    }
    const isMountOnly = effect.hook !== 'useFocusEffect' && /^\s*,\s*\[\s*\]\s*\)/.test(code.slice(effect.close + 1));
    if (guard.kind === 'ref' && !isMountOnly) {
      problem(context, file, effect.index, 'effect-stale-result', `the ${effect.hook} cleanup sets ${guard.name}, a mounted ref, which covers unmount only; a dependency change (or a refocus) still lets the older answer write`, `Use one AbortController per run: pass its signal, check signal.aborted before each write, and return () => { controller.abort(); } (${DETAILS_FIX}).`);
    } else if (inlineWrite !== null && guard.kind !== 'cancel' && guard.kind !== 'opaque') {
      problem(context, file, effect.index, 'effect-stale-result', `${inlineWrite}(await ...) in the ${effect.hook} writes the moment the await resolves, so no guard can run between the answer and the write`, 'Await into a const first, then check the guard and write: const value = await load(signal); if (signal.aborted) return; setValue(value);');
    } else if (!isGuardChecked(guard, body, setters, stateful)) {
      const what = guard.kind === 'abort' ? 'aborts a controller whose signal' : `sets ${guard.name}, which`;
      const check = guard.kind === 'abort' ? 'signal.aborted' : `!${guard.name}`;
      problem(context, file, effect.index, 'effect-stale-result', `the ${effect.hook} cleanup ${what} the async continuation does not check before every write (each await needs its own check), so a late result still writes`, `Check it after every await and in every callback, before the write: if (${check}) return;`);
    }
  }
}

// --- abort-signal ---------------------------------------------------------------------------------

const ABORT_PATTERNS = [
  [/\.\s*throwIfAborted\s*\(/g, 'signal.throwIfAborted() does not exist on the device: React Native 0.86 polyfills AbortSignal with abort-controller 3.0.0, while Jest on Node has it', 'if (signal.aborted) return err({ kind: \'cancelled\' });'],
  [/(?<![\w$])(?:[A-Za-z_$][\w$]*Signal|signal)\s*\??\.\s*reason\b/g, 'signal.reason is undefined on the device for a plain AbortController (abort-controller 3.0.0 drops the reason); Jest on Node keeps it', 'Decide by signal.aborted, and keep any reason in your own variable before calling abort().'],
  [/\bAbortSignal\s*\.\s*abort\s*\(/g, 'AbortSignal.abort() does not exist on the device (abort-controller 3.0.0; Expo adds only timeout and any)', 'const controller = new AbortController(); controller.abort(); use controller.signal.'],
  [/\.name\s*(?:===|!==|==|!=)\s*(['"`])AbortError\1|(['"`])AbortError\2\s*(?:===|!==|==|!=)/g, 'cancellation decided by the error name: on iOS and Android expo/fetch (the global fetch in SDK 57) rejects most aborted requests (aborted before or during the request) with a FetchError ("fetch failed: ..."), not an AbortError', 'Ask the signal instead: catch (error) { if (signal.aborted) return cancelled; ... }.'],
  [/\binstanceof\s+DOMException\b/g, 'cancellation decided by instanceof DOMException: on iOS and Android expo/fetch rejects most aborted requests (aborted before or during the request) with a FetchError, not a DOMException', 'Ask the signal instead: if (signal.aborted) treat it as cancelled.'],
];

function checkAbortApis(file, context) {
  const { codeKeep, code } = file.scan;
  for (const [pattern, message, fix] of ABORT_PATTERNS) {
    for (const match of codeKeep.matchAll(pattern)) problem(context, file, match.index, 'abort-signal', message, fix);
  }
  for (const match of code.matchAll(/\.\s*addEventListener\s*\(/g)) {
    const options = callArguments(code, match.index + match[0].length - 1)[2]?.text ?? '';
    if (/(?<![\w$])signal\s*[:,}]/.test(options)) {
      problem(context, file, match.index, 'abort-signal', 'addEventListener(..., { signal }) never removes the listener on the device: the polyfilled EventTarget (event-target-shim 5) ignores the signal option', 'Remove the listener yourself (removeEventListener in the cleanup), or register it with { once: true }.');
    }
  }
}

// --- subscription-released ------------------------------------------------------------------------

const LIFETIME_MARKER = /\/\/\s*app-lifetime:\s*(.{10,})$/;

/**
 * True when a reasoned `// app-lifetime: <why>` comment sits on the call's line or one of the three
 * lines above it, in a file that is not React code (.tsx, or a screen folder): a listener or timer
 * that lives exactly as long as the app, created once by the composition root, has nothing to release.
 */
function hasLifetimeMarker(file, index, context) {
  if (file.rel.endsWith('.tsx') || context.focusDirs.some((dir) => matchGlob(file.rel, `${dir}/**`))) return false;
  const line = file.scan.lineOf(index);
  const lines = file.text.split('\n');
  return lines.slice(Math.max(0, line - 4), line).some((text) => LIFETIME_MARKER.test(text.trim()));
}

/** True for `function watchX(`, a method shorthand `watchX(...) {` and `watchX(...): T {` (not a ternary). */
function isDeclaration(code, match) {
  if (/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, match.index - 24), match.index))) return true;
  const close = matchBracket(code, match.index + match[0].length - 1);
  if (close === -1) return false;
  const next = code.slice(close + 1).trimStart()[0];
  if (next === '{') return true;
  return next === ':' && !/\?\s*$/.test(code.slice(Math.max(0, match.index - 80), match.index));
}

function eventTargetReleased(file, open) {
  const { code, codeKeep } = file.scan;
  const args = callArguments(code, open);
  if (/\bonce\s*:\s*true\b/.test(args[2]?.text ?? '')) return true;
  const event = /^\s*(['"`])([^'"`]+)\1\s*$/.exec(codeKeep.slice(args[0]?.start ?? open, (args[0]?.start ?? open) + (args[0]?.text.length ?? 0)));
  if (!event) return false;
  return new RegExp(`removeEventListener\\s*\\(\\s*(['"\`])${escapeRegExp(event[2])}\\1`).test(codeKeep);
}

/** True when the object the listener was added to is itself torn down in this file (`ad.destroy()`). */
function ownerIsDisposed(code, start, dot) {
  const owner = code.slice(start, dot).replace(/\s+/g, '');
  if (!/^[A-Za-z_$][\w$.]*$/.test(owner)) return false;
  const n = escapeRegExp(owner).replace(/\\\./g, '\\s*\\??\\.\\s*');
  return new RegExp(`(?<![\\w$.])${n}\\s*\\??\\.\\s*(?:destroy|dispose|close|terminate)\\s*\\(`).test(code);
}

function checkSubscriptions(file, context) {
  const { code } = file.scan;
  for (const match of code.matchAll(/\b(Keyboard|DeviceEventEmitter)\s*\.\s*removeAllListeners\s*\(/g)) {
    problem(context, file, match.index, 'subscription-released', `${match[1]}.removeAllListeners() also removes the listeners other modules registered on this shared emitter (navigation, keyboard libraries)`, 'Remove only your own: keep each subscription and call subscription.remove().');
  }
  const pattern = /(\??\.)\s*(add[A-Z]?[\w$]*Listener|subscribe)\s*\(|(?<![\w$.])(add[A-Z][\w$]*Listener|watch[A-Z][\w$]*)\s*\(/g;
  for (const match of code.matchAll(pattern)) {
    const name = match[2] ?? match[3];
    if (/Async$/.test(name) || (match[3] !== undefined && isDeclaration(code, match))) continue;
    const open = match.index + match[0].length - 1;
    const start = match[1] === undefined ? match.index : chainStart(code, match.index);
    const holder = holderOf(code, start);
    if (holder.kind === 'returned' || holder.kind === 'handed' || hasLifetimeMarker(file, match.index, context)) continue;
    if (holder.kind === 'dropped') {
      if (name === 'addEventListener' && eventTargetReleased(file, open)) continue;
      if (match[1] !== undefined && ownerIsDisposed(code, start, match.index)) continue;
      problem(context, file, match.index, 'subscription-released', `the handle ${name}() returns is dropped, so nothing can ever remove this listener`, 'Keep it and release it where the work ends: const subscription = X.addEventListener(...); return () => { subscription.remove(); } (an unsubscribe function: call it); an EventTarget listener: removeEventListener in the cleanup. Only a listener that lives as long as the app, created once by the composition root, may say so instead: // app-lifetime: <why> above it.');
    } else if (!isReleased(code, holder.name, RELEASE_CALLS)) {
      problem(context, file, match.index, 'subscription-released', `${holder.name} holds the ${name}() handle but is never removed, called, returned or handed over`, `Release it in the matching cleanup: ${holder.name}.remove() for a subscription, ${holder.name}() for an unsubscribe function (effect cleanup, the useSyncExternalStore subscribe's return, a service's stop).`);
    }
  }
}

// --- timer-cleared --------------------------------------------------------------------------------

function checkTimers(file, context) {
  const { code } = file.scan;
  const pattern = /(?<![\w$.])(?:(?:globalThis|global|window)\s*\.\s*)?(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/g;
  for (const match of code.matchAll(pattern)) {
    const timer = match[1];
    const clear = CLEAR_OF[timer];
    const holder = holderOf(code, match.index);
    const hasClear = new RegExp(`(?<![\\w$.])${clear}\\s*\\(`).test(code);
    if (holder.kind === 'returned' || hasLifetimeMarker(file, match.index, context)) continue;
    if (holder.kind === 'handed') {
      if (!hasClear) problem(context, file, match.index, 'timer-cleared', `${timer}() ids are collected but this file never calls ${clear}()`, `Clear every id where the work ends (cleanup, finally, cancel()): for (const id of ids) ${clear}(id);`);
      continue;
    }
    if (holder.kind === 'dropped') {
      problem(context, file, match.index, 'timer-cleared', `the id ${timer}() returns is dropped, so the timer cannot be cleared and fires after its owner is gone`, `Keep the id and pass it to ${clear}() in the cleanup or finally; for a pause, await delayOrAbort(ms, signal) (templates/src/services/async/delay-or-abort.ts).`);
      continue;
    }
    const n = escapeRegExp(holder.name).replace(/\\\./g, '\\s*\\??\\.\\s*');
    if (new RegExp(`(?<![\\w$.])${clear}\\s*\\(\\s*${n}\\b`).test(code)) continue;
    const isHanded = new RegExp(`\\breturn\\s+${n}\\s*[;})\\n]|=>\\s*${n}\\s*[;,)}\\n]|:\\s*${n}\\s*[,}]`).test(code);
    const isCollected = new RegExp(`[(,[]\\s*${n}\\s*[,)\\]]`).test(code.slice(match.index + match[0].length));
    if (isHanded || (isCollected && hasClear)) continue;
    problem(context, file, match.index, 'timer-cleared', `${holder.name} holds a ${timer}() id that is never passed to ${clear}()`, `Call ${clear}(${holder.name}) where the work ends: the effect cleanup, a finally block, or the owner's stop()/dispose().`);
  }
}

// --- focus-scoped-work ----------------------------------------------------------------------------

function checkFocusWork(file, context) {
  const { code } = file.scan;
  for (const effect of effectBlocks(code)) {
    if (effect.hook === 'useFocusEffect' || effect.hook === 'useInsertionEffect') continue;
    const what = /(?<![\w$.])setInterval\s*\(/.test(effect.inner)
      ? 'an interval'
      : /(?<![\w$])watch[A-Z][\w$]*Async\s*\(/.test(effect.inner)
        ? 'a watch*Async() subscription'
        : SENSORS.test(effect.inner)
          ? 'a sensor listener'
          : null;
    if (what === null) continue;
    problem(context, file, effect.index, 'focus-scoped-work', `${effect.hook} in a screen runs ${what}; stack and tab screens stay mounted when another screen covers them, so it keeps running unseen`, 'Run it in useFocusEffect (expo-router) so blur stops it, and pause it while the app is in the background (useIsAppActive from src/hooks).');
  }
}

run(main);
