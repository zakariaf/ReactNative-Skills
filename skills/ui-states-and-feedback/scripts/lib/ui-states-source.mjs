// ui-states-source.mjs: the source rules of check-ui-states (one function per rule), over app source
// files that are not tests. Each rule reads the masked copy (comments and literal contents blanked)
// to find code, and the original text at the same positions to read a literal.
import { findCalls, findClosing, findJsxTags, makeLineOf, maskCode } from './source-scan.mjs';

/** A loading flag kept in its own useState: `const [isLoading, setIsLoading] = useState(...)`. */
const LOADING_NAME = /^(?:is)?(?:loading|fetching|pending)$/i;
/** An error kept in its own useState next to it. */
const ERROR_NAME = /^(?:error|err|errorMessage|errorText|failure|loadError|hasError|isError|isFailed|failed)$/i;
const STATE_PAIR = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\]\s*=\s*(?:React\s*\.\s*)?useState\b/g;
const QUERY_IMPORT = /from\s*['"]@tanstack\/react-query['"]/;
/** A call that reads server state: useQuery, useSuspenseQuery, useInfiniteQuery, useQueries, useTasksQuery. */
export const QUERY_HOOK = /\buse[A-Z]?\w*Quer(?:y|ies)\s*\(/;
/** A member chain after the data name: `?.pages.flatMap((page) => page.items)` (one level of nested parens). */
const DATA_CHAIN = String.raw`(?:\s*\??\.\s*[A-Za-z_$][\w$]*(?:\s*\((?:[^()]|\([^()]*\))*\))?)*`;
const DEFAULT_TO_EMPTY = String.raw`\s*(?:\?\?|\|\|)\s*\[\s*\]`;
/** `data ?? []`, `query.data || []`, `pages.data?.pages.flatMap(...) ?? []`. */
const EMPTY_DEFAULT = new RegExp(String.raw`(?:\.\s*data|(?<![\w$.])data)${DATA_CHAIN}${DEFAULT_TO_EMPTY}`, 'g');
/** A name bound to query data by renaming: `const { data: notes } = useNotesQuery(...)`. */
const DATA_RENAME = /\{[^{}]*?(?<![\w$.])data\s*:\s*([A-Za-z_$][\w$]*)\s*[,}][^{}]*?\}?\s*=\s*use[A-Z]?\w*Quer(?:y|ies)\s*\(/g;
/** The `const X =` (or let) whose value starts right before an index: `const notes = query`. */
const ASSIGNED_TO = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*\(?\s*[\w$.?\s]*$/;
/**
 * The destructuring forms: `const { data = [] } = useQuery(...)` and `const { data: tasks = [] } =
 * useTasksQuery(...)`. useSuspenseQuery always has data, so its default decides nothing.
 */
const EMPTY_DESTRUCTURE = /\{[^{}]*?(?<![\w$.])data\s*(?::\s*[A-Za-z_$][\w$]*\s*)?=\s*\[\s*\][^{}]*\}\s*=\s*(?!useSuspense)use[A-Z]?\w*Query\s*\(/g;
/** A file that derives one screen state from the query (listScreenStateOf, taskListStateOf). */
const STATE_DERIVED = /\b[a-z]\w*StateOf\s*\(/;
const STATE_CALL = '[a-z][\\w$]*StateOf';
const ANNOUNCE = /\b(?:useAnnounce|announce)\s*\(/;
const DELAY_USE = /\buseDelayedVisibility\s*\(|<DelayedPlaceholder\b/;
const REFRESH_FLAG = /\b(?:isFetching|isRefetching)\b|fetchStatus\s*===?\s*['"]fetching['"]/;
const NEGATED_OUTCOME = /(!==?)\s*(['"])(cancelled|dismissed)\2|(['"])(cancelled|dismissed)\4\s*(!==?)/g;
const GUARD_ON_OUTCOME = /\bif\s*\(\s*[A-Za-z_$][\w$.]*\s*===?\s*(['"])(cancelled|dismissed)\1\s*\)\s*\{?\s*return\b/g;
const CHAIN = '(?:[A-Za-z_$][\\w$]*\\s*\\??\\.\\s*)*';
/** A button that says nothing: "OK", "Yes", "Sure". */
const VAGUE_LABEL = /^(?:ok|okay|yes|sure)$/;
/** A shared key ("common.confirm", "shared.title"): it cannot name this action's consequence. */
const SHARED_LABEL = /^(?:common|shared|general|global)\.[\w-]+$/;
/** A shared button key that names no verb; a shared verb ("common.delete") already says what happens. */
const SHARED_VAGUE_LABEL = /^(?:common|shared|general|global)\.(?:ok|okay|yes|sure|confirm|continue|done|proceed|accept)$/;
const VAGUE_TITLE = /(?:^|-)(?:are-you-sure|sure|warning|attention)$/;

/** Reads one source file into the shape every rule takes. */
export function sourceFile(rel, source) {
  const masked = maskCode(source);
  return {
    rel,
    source,
    masked,
    lineOf: makeLineOf(source),
    isTsx: rel.endsWith('.tsx'),
    readsQuery: QUERY_IMPORT.test(source) || QUERY_HOOK.test(masked),
    callsQuery: QUERY_HOOK.test(masked),
    announces: ANNOUNCE.test(masked),
  };
}


/** True when the character at `index` is code (not inside a comment or a string). */
function isCode(file, index) {
  return file.masked[index] === file.source[index] && !/\s/.test(file.source[index]);
}

/** True when `rel` lies inside the repo folder `dir` ('.' or '' is the whole repo). */
export function under(rel, dir) {
  return dir === '.' || dir === '' || rel.startsWith(`${dir}/`);
}

/**
 * The folder a file belongs to for the per-feature rules: `<featuresDir>/<feature>` for anything in
 * a feature (its components/ included), else the file's own folder.
 */
export function featureRootOf(rel, layout) {
  if (under(rel, layout.featuresDir) && layout.featuresDir !== '.' && layout.featuresDir !== '') {
    const rest = rel.slice(layout.featuresDir.length + 1);
    if (rest.includes('/')) return `${layout.featuresDir}/${rest.split('/')[0]}`;
  }
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '.' : rel.slice(0, slash);
}

/** Facts across files that a per-file rule needs: the feature folders where something announces. */
export function projectFacts(files, layout) {
  return { announcingRoots: new Set(files.filter((file) => file.announces).map((file) => featureRootOf(file.rel, layout))) };
}

/** state-flags: a loading flag and an error in two useStates of one file. */
export function checkStateFlags(file, report) {
  const loading = [];
  const errors = [];
  for (const match of file.masked.matchAll(STATE_PAIR)) {
    if (LOADING_NAME.test(match[1])) loading.push(match);
    else if (ERROR_NAME.test(match[1])) errors.push(match);
  }
  if (loading.length === 0 || errors.length === 0) return;
  report.problem({
    file: file.rel,
    line: file.lineOf(errors[0].index),
    rule: 'state-flags',
    message: `"${loading[0][1]}" and "${errors[0][1]}" are separate useStates, so loading and failed (or empty and loading) can be true at once`,
    fix: 'Keep one state union (loading | offline | failed | empty | filtered-empty | ready) and derive it once, as listScreenStateOf does.',
  });
}

/** The names that hold query data in a file: `data`, plus every `{ data: X }` taken from a use…Query( call. */
function dataNames(file) {
  const names = new Set();
  for (const match of file.masked.matchAll(DATA_RENAME)) names.add(match[1]);
  return [...names];
}

/** True when the state call passes `name` as its items (`items: name`, or the shorthand `items`). */
function passesAsItems(file, calls, name) {
  return calls.some((call) => {
    const text = file.masked.slice(call.open + 1, call.close);
    if (new RegExp(String.raw`(?<![\w$.])items\s*:\s*${name.replace(/\$/g, '\\$')}(?![\w$])`).test(text)) return true;
    return name === 'items' && /(?:^|[{,])\s*items\s*(?=[,}])/.test(text);
  });
}

/** empty-default: query data defaulted to [] turns "not loaded" and "failed" into "empty". */
export function checkEmptyDefault(file, report) {
  if (!file.readsQuery) return;
  const flag = (index) =>
    report.problem({
      file: file.rel,
      line: file.lineOf(index),
      rule: 'empty-default',
      message: 'query data defaulted to [] shows "No items yet" while the first load runs or after it failed',
      fix: 'Keep undefined until the first load succeeds and let the state function choose loading, offline or failed.',
    });
  // A destructuring default changes the data itself, so it counts with or without a state function.
  for (const match of file.masked.matchAll(EMPTY_DESTRUCTURE)) flag(match.index + match[0].search(/(?<![\w$.])data\b/));
  // `?? []` passed into the state function decides the state, directly or through a const it is
  // assigned to (`const notes = query.data ?? []; listScreenStateOf({ items: notes })`). Elsewhere,
  // with the state derived from the query, a [] left for a count or a sort decides nothing.
  const calls = findCalls(file.masked, STATE_CALL);
  const inCall = (index) => calls.some((call) => index > call.open && index < call.close);
  const derives = STATE_DERIVED.test(file.masked);
  const passedOn = (index) => {
    const lineStart = file.masked.lastIndexOf('\n', index) + 1;
    const target = ASSIGNED_TO.exec(file.masked.slice(lineStart, index));
    return target !== null && passesAsItems(file, calls, target[1]);
  };
  const defaults = [...file.masked.matchAll(EMPTY_DEFAULT)].map((match) => match.index);
  for (const name of dataNames(file)) {
    const renamed = new RegExp(String.raw`(?<![\w$.])${name.replace(/\$/g, '\\$')}${DATA_CHAIN}${DEFAULT_TO_EMPTY}`, 'g');
    for (const match of file.masked.matchAll(renamed)) defaults.push(match.index);
  }
  for (const index of [...new Set(defaults)].sort((a, b) => a - b)) {
    if (!derives || inCall(index) || passedOn(index)) flag(index);
  }
}

/** bare-spinner: an ActivityIndicator on a screen, shown at once on every load. */
export function checkBareSpinner(file, report, layout) {
  if (!file.isTsx || DELAY_USE.test(file.source)) return;
  if (!under(file.rel, layout.featuresDir) && !under(file.rel, layout.routesDir)) return;
  for (const tag of findJsxTags(file.source, file.masked)) {
    if (tag.name !== 'ActivityIndicator') continue;
    report.problem({
      file: file.rel,
      line: file.lineOf(tag.start),
      rule: 'bare-spinner',
      message: 'a spinner shown the moment a load starts flashes on every fast load',
      fix: 'Render the loading state through DelayedPlaceholder with a placeholder shaped like the content (a busy control keeps its own indicator in src/ui).',
    });
  }
}

/**
 * The innermost function around `index`, when it is an argument of a call (`useEffect(() => { … })`,
 * `items.map(function (item) { … })`): walking back from its body's `{`, an unmatched `(` comes first.
 */
function isCallbackAt(masked, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const char = masked[i];
    if (char === '}' || char === ')' || char === ']') depth += 1;
    else if (char === '{' || char === '(' || char === '[') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      if (char !== '{') return false;
      // An enclosing block: a function body when `=>` or a `function` head comes right before it.
      const before = masked.slice(Math.max(0, i - 300), i);
      if (!/=>\s*$/.test(before) && !/\bfunction\b[^{};]*$/.test(before)) continue;
      return startsAsArgument(masked, i);
    }
  }
  return false;
}

/**
 * True when the function whose body opens at `brace` is passed straight into a call (`useEffect(() =>`)
 * or a JSX attribute (`onPress={() =>`): walking back over its head, the first unmatched bracket is a
 * call's `(` or an attribute's `={`.
 */
function startsAsArgument(masked, brace) {
  let depth = 0;
  for (let i = brace - 1; i >= 0; i -= 1) {
    const char = masked[i];
    if (char === ')' || char === ']' || char === '}') depth += 1;
    else if (char === '(' || char === '[' || char === '{') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const before = masked.slice(Math.max(0, i - 40), i);
      return (char === '(' && /[\w$)\]]\s*$/.test(before)) || (char === '{' && /=\s*$/.test(before));
    } else if (depth === 0 && char === ';') return false;
  }
  return false;
}

/** refresh-blanks: an early return on isFetching replaces loaded content with a placeholder. */
export function checkRefreshBlanks(file, report) {
  for (const match of file.masked.matchAll(/\bif\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(file.masked, open);
    if (close === -1) continue;
    if (!REFRESH_FLAG.test(file.source.slice(open + 1, close))) continue;
    const after = /^\s*\{?\s*return\b\s*(.?)/.exec(file.masked.slice(close + 1, close + 60));
    if (after === null) continue;
    // A bare `return;` renders nothing: a load-more guard or an effect that waits for the refresh.
    if (after[1] === ';' || after[1] === '}' || after[1] === '') continue;
    // Inside a callback (a handler, an effect, a renderItem) only a returned element or null renders.
    const rendersHere = /^\s*\{?\s*return\s*(?:<|\(\s*<|null\b)/.test(file.masked.slice(close + 1, close + 60));
    if (!rendersHere && isCallbackAt(file.masked, match.index)) continue;
    report.problem({
      file: file.rel,
      line: file.lineOf(match.index),
      rule: 'refresh-blanks',
      message: 'a refresh (isFetching) returns early, so the list the person was reading disappears and loses its place',
      fix: 'Decide placeholders from "nothing loaded yet" (data === undefined); keep content during a refresh with a quiet isRefreshing indicator.',
    });
  }
}

/** native-alert: Alert.alert / Alert.prompt, outside the feedback ladder. */
export function checkNativeAlert(file, report) {
  for (const call of findCalls(file.masked, 'Alert\\s*\\.\\s*(?:alert|prompt)')) {
    report.problem({
      file: file.rel,
      line: file.lineOf(call.start),
      rule: 'native-alert',
      message: 'Alert.alert reports or asks outside the ladder: Android ignores the button styles and shows "OK" untranslated without buttons, its back press resolves no outcome, and no test can press it',
      fix: 'Report a result with useFeedback().notify(...); ask a decision with useFeedback().confirm(...) and run the action only on "confirmed".',
    });
  }
}

/** confirm-outcome: code that runs the action on anything other than 'confirmed'. */
export function checkConfirmOutcome(file, report) {
  const flag = (index, message) =>
    report.problem({
      file: file.rel,
      line: file.lineOf(index),
      rule: 'confirm-outcome',
      message,
      fix: "Run the action only when the outcome === 'confirmed'; return on every other outcome (if (outcome !== 'confirmed') return;).",
    });
  for (const match of file.source.matchAll(NEGATED_OUTCOME)) {
    const operator = match[1] === undefined ? match.index + match[0].lastIndexOf(match[6]) : match.index;
    if (!isCode(file, operator)) continue;
    const outcome = match[3] ?? match[5];
    flag(match.index, `a comparison !== '${outcome}' treats the other non-confirmed outcome as a yes`);
  }
  for (const match of file.source.matchAll(GUARD_ON_OUTCOME)) {
    if (!isCode(file, match.index)) continue;
    flag(match.index, `returning only on '${match[2]}' lets the other non-confirmed outcome (Android back, a newer question) run the action`);
  }
}

/** The confirm({ ... }) calls of a file with their literal parts. */
export function confirmCalls(file) {
  return findCalls(file.masked, `${CHAIN}confirm`).map((call) => {
    const text = file.source.slice(call.open + 1, call.close);
    // A literal value, or the literal key a t(...) call receives: { value, isKey }.
    const read = (key) => {
      const match = new RegExp(`\\b${key}\\s*:\\s*(t\\(\\s*)?(['"])([^'"]+)\\2`).exec(text);
      return match === null ? null : { value: match[3], isKey: match[1] !== undefined };
    };
    return { line: file.lineOf(call.start), testID: read('testID'), title: read('title'), confirmLabel: read('confirmLabel') };
  });
}

function lastSegment(key) {
  return key.split('.').pop() ?? key;
}

/** confirm-vague: a confirmation whose title or button says nothing about the consequence. */
export function checkConfirmVague(file, report) {
  for (const call of confirmCalls(file)) {
    const label = call.confirmLabel?.isKey ? call.confirmLabel.value : null;
    const title = call.title?.isKey ? call.title.value : null;
    const vague = [];
    if (label !== null && (VAGUE_LABEL.test(lastSegment(label)) || SHARED_VAGUE_LABEL.test(label))) vague.push(`confirmLabel "${label}"`);
    if (title !== null && (VAGUE_TITLE.test(lastSegment(title)) || SHARED_LABEL.test(title))) vague.push(`title "${title}"`);
    if (vague.length === 0) continue;
    report.problem({
      file: file.rel,
      line: call.line,
      rule: 'confirm-vague',
      message: `${vague.join(' and ')} names no consequence ("Are you sure?" / "OK" is tapped through without reading)`,
      fix: 'Title the consequence with its count ("Delete 3 done tasks?") and label the button with the verb ("Delete tasks").',
    });
  }
}

/** offline-notice: a lasting condition (offline) shown in a notice that times out. */
export function checkOfflineNotice(file, report) {
  for (const call of findCalls(file.masked, `${CHAIN}notify`)) {
    const text = file.source.slice(call.open + 1, call.close);
    if (!/\bt\(\s*(['"])[^'"]*offline[^'"]*\1/.test(text)) continue;
    report.problem({
      file: file.rel,
      line: file.lineOf(call.start),
      rule: 'offline-notice',
      message: 'being offline lasts, but a notice leaves after a few seconds while the condition is still true',
      fix: 'Show offline in the OfflineBanner (from useReachability(services.connectivity)) and as the list notice, never as a notice.',
    });
  }
}

/** busy-overlay: a Modal that holds a spinner blocks the whole app for an in-flight action. */
export function checkBusyOverlay(file, report) {
  if (!file.isTsx) return;
  for (const tag of findJsxTags(file.source, file.masked)) {
    if (tag.name !== 'Modal' || tag.selfClosing) continue;
    const close = file.masked.indexOf('</Modal>', tag.end);
    const inner = file.masked.slice(tag.end, close === -1 ? undefined : close);
    if (!/<(?:ActivityIndicator|BusyIndicator)\b/.test(inner)) continue;
    report.problem({
      file: file.rel,
      line: file.lineOf(tag.start),
      rule: 'busy-overlay',
      message: 'a modal spinner over the whole app for one action reads as a frozen app and blocks everything else',
      fix: 'Show the busy state on the control that started the work (useBusyAction + the button\'s isBusy); keep the rest usable.',
    });
  }
}

/**
 * announce-ios: a live region or a Toast on a screen without an announcement for VoiceOver. A view
 * is pure, so the announcement may live in any file of the same feature folder (its model hook).
 */
export function checkAnnounceIos(file, report, layout, project) {
  if (!file.isTsx) return;
  if (!under(file.rel, layout.featuresDir) && !under(file.rel, `${layout.uiDir}/feedback`)) return;
  if (file.announces || project?.announcingRoots.has(featureRootOf(file.rel, layout))) return;
  const live = /\baccessibilityLiveRegion\s*=/.exec(file.masked);
  const toast = findJsxTags(file.source, file.masked).find((tag) => tag.name === 'Toast');
  const index = live?.index ?? toast?.start;
  if (index === undefined) return;
  report.problem({
    file: file.rel,
    line: file.lineOf(index),
    rule: 'announce-ios',
    message: 'TalkBack reads a live region when it appears, VoiceOver never does: iOS users miss this message',
    fix: 'Announce the text once per change with useAnnounce() on iOS (the live region covers Android), in this file or in the feature\'s model hook.',
  });
}

export const SOURCE_RULES = [
  checkStateFlags,
  checkEmptyDefault,
  checkBareSpinner,
  checkRefreshBlanks,
  checkNativeAlert,
  checkConfirmOutcome,
  checkConfirmVague,
  checkOfflineNotice,
  checkBusyOverlay,
  checkAnnounceIos,
];
