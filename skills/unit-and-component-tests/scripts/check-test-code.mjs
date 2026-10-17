#!/usr/bin/env node
// check-test-code.mjs: checks how the tests of an Expo app use React Native Testing Library 14, the
// root native-SDK mocks, fakes and imports: every async RNTL call awaited, components rendered through
// the render helper, queries used for what they prove, no style assertions or snapshots without a
// reason, no SDK imports in tests, no mocked stores, no fake timers in logic, no sleeps, no retries,
// no overwritten Platform.OS, no direct use of Expo Router's broken test API, no relative imports
// across source roots.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-test-code.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

import { createReporter, lineOf, maskComments, matchGlob, parseArgs, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { maskCode } from './lib/source-scan.mjs';
import { KNOWN_ROOT_MOCKS, loadContract, sourceRoots, testCandidates } from './lib/test-contract.mjs';

const SPEC = {
  name: 'check-test-code',
  summary: 'Checks every test file of the repo for the RNTL 14, mock, fake and determinism rules of the unit-and-component-tests skill.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The test-setup contract (default: rn-skills.config.json "testSetupContract", else contracts/test-setup.json; missing = the defaults)' },
    ignore: { type: 'string', multiple: true, value: 'glob', help: 'Skip matching paths (the contract key otherRunnerGlobs skips a folder another test runner owns for good)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Test files: every file Jest\'s defaults, jest-expo or Expo\'s unit-testing guide treat as a test, anywhere in the',
    'repo (*.test|spec.[jt]s(x), a test under __tests__/, *-test.[jt]s(x)), except folders another test runner owns',
    '(see check-test-setup --help, and the contract key otherRunnerGlobs); check-test-setup fails the ones no project',
    'runs, and any test inside the Expo Router routes folder (test-in-routes).',
    'Rules:',
    '  rntl-await                an RNTL call (render, renderHook, act, waitFor, waitForElementToBeRemoved, fireEvent,',
    '                            findBy*, user.press/type/... on a userEvent.setup() instance, also one assigned in',
    '                            beforeEach, a render- or router-helper function, and rerender or unmount on what a',
    '                            render, renderHook or render-helper call returned: view.unmount(), screen.rerender(),',
    '                            or the destructured { rerender, unmount }) is not awaited (RNTL 14 is async). An',
    '                            unmount() on any other object (a subscription) is not an RNTL call.',
    '                            Awaited means: await or return before the whole call chain',
    '                            (within(screen.getAllByRole(\'row\')[1]).findByText(...)); an arrow function\'s',
    '                            expression body (never a forEach callback; a map callback only when the array goes',
    '                            into an awaited Promise.all); an element of an awaited Promise.all/allSettled/race/any',
    '                            array; or await expect(<call>).resolves/.rejects. expect(<call>) alone asserts on the',
    '                            pending promise and always passes',
    '  render-with-providers     a component test under the source folder renders with RNTL render() instead of the',
    '                            render helper (renderWithProviders)',
    '  destructured-queries      queries destructured from render(); use screen.getByRole(...)',
    '  user-event-setup          userEvent.press(...) without userEvent.setup()',
    '  query-for-presence        expect(queryBy...(...)) asserts presence; use getBy* (queryBy* is only for absence)',
    '  get-for-absence           expect(getBy...(...)).not.toBeOnTheScreen(); getBy throws first, use queryBy*',
    '  waitfor-side-effect       a press or fireEvent inside a waitFor callback',
    '  render-hook-wrapper       RNTL renderHook(...) without a wrapper (use renderHookWithProviders or createProvidersWrapper)',
    '  style-assertion           toHaveStyle(...) outside the design-system folders (contract styleContractGlobs, default',
    '                            src/ui, src/theme, src/i18n) without "// allow-style-assertion: <reason>" above it or in the header',
    '  component-snapshot        toMatchSnapshot()/toMatchInlineSnapshot() outside *.golden.test.ts (no component snapshots)',
    '  react-test-renderer       a test imports react-test-renderer (deprecated since React 19; RNTL 14 renders through',
    '                            test-renderer): render through the render helper instead',
    '  vendor-sdk-import         a test imports a root-mocked native SDK (use jest.mock + a typed jest.requireMock)',
    '  require-mock-without-mock jest.requireMock("<m>") without jest.mock("<m>") in the same file (second instance, zero calls)',
    '  mocked-store              jest.mock(...) of a store module (seed through the render helper and call its own actions instead)',
    '  fake-timers-in-logic      jest.useFakeTimers() in a logic test (contract logicTestGlobs: core, data, stores, services,',
    '                            api, game rules); inject the clock',
    '  test-sleep                a sleep in a test (new Promise + setTimeout, sleep(), delay(), wait())',
    '  test-retries              jest.retryTimes(...) in a test file (a retry hides a flaky test)',
    '  platform-override         a test overwrites Platform.OS or mocks the Platform module (test Android behaviour in',
    '                            <unit>.android.test.ts(x), which the android project runs under jest-expo/android)',
    '  expo-router-testing       a test uses renderRouter or testRouter from expo-router/testing-library (a named,',
    '                            namespace or default import, require() or import(), a .renderRouter(...) or testRouter.x',
    '                            member call), or its matchers (toHavePathname, toHaveSegments, ...): with RNTL 14 they',
    '                            throw or leave fake timers on; use renderRouterWithProviders',
    '                            (test/render-router-with-providers.tsx) and its getters. Type-only imports are fine',
    '  cross-root-import         a relative import that leaves the test\'s root: src/, test/ or scripts/ (when multi-package,',
    '                            its workspace); import through @/, @test/ or the package name',
    '',
    'Reasoned opt-outs (a comment anywhere in the file, the reason at least 10 characters):',
    '  // no-providers: <why>          render-with-providers and render-hook-wrapper: the unit reads nothing from',
    '                                  context (props or injected dependencies only), or the test supplies the',
    '                                  provider under test itself (<I18nProvider><T /></I18nProvider>, a ThemeProvider',
    '                                  test) or proves the no-provider default (a hook\'s fallback outside its provider)',
    '  // allow-fake-timers: <why>     fake-timers-in-logic: the unit under test is itself a timer (a timeout helper)',
    '  // allow-style-assertion: <why> style-assertion: the style is the contract (line above, or file header)',
    'A render(...) or renderHook(...) that passes its own { wrapper } needs no marker, and neither does one whose',
    'promise is asserted to reject (await expect(renderHook(() => useX())).rejects.toThrow(...)): a test that proves a',
    'hook or component fails outside its provider renders without the providers on purpose.',
  ].join('\n'),
};

const USER_METHODS = 'press|longPress|type|clear|paste|scrollTo';
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** A file-level opt-out: `// <marker>: <reason of at least 10 characters>` anywhere in the source. */
function hasMarker(source, marker) {
  const match = new RegExp(`//\\s*${marker}:\\s*(.+)$`, 'm').exec(source);
  return match !== null && match[1].trim().length >= 10;
}

/** Index just after the parenthesised group that starts at `open` (which must be "("), or -1. */
function closeParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function importedNames(code, from) {
  const names = new Set();
  for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!from(match[2])) continue;
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Index of the bracket that opens the one closing at `close` in literal-masked code, or -1. */
function openingBracket(masked, close) {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    const ch = masked[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the innermost bracket left open before `index` in literal-masked code, or -1. */
function enclosingOpen(masked, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = masked[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

const skipSpaceBack = (masked, index) => {
  let i = index;
  while (i > 0 && /\s/.test(masked[i - 1])) i -= 1;
  return i;
};

/**
 * Where the member chain that ends in the call at `index` starts: walks back over ".name", "?.name",
 * balanced (...) and [...] segments and the identifiers before them, so `within(row).findByText`
 * starts at `within` and `screen.getAllByRole('row')[0].props` at `screen`.
 */
function chainStart(masked, index) {
  let start = index;
  for (;;) {
    let j = skipSpaceBack(masked, start);
    if (masked[j - 1] !== '.') return start;
    j -= masked[j - 2] === '?' ? 2 : 1;
    j = skipSpaceBack(masked, j);
    while (masked[j - 1] === ')' || masked[j - 1] === ']') {
      const open = openingBracket(masked, j - 1);
      if (open === -1) return start;
      j = skipSpaceBack(masked, open);
    }
    let k = j;
    while (k > 0 && /[\w$]/.test(masked[k - 1])) k -= 1;
    start = k;
  }
}

/**
 * True when the promise of the call at `index` is waited for: await or return before its whole member
 * chain, the expression body of an arrow function (the caller awaits it), an element of an array given
 * to an awaited Promise.all/allSettled/race/any, or the argument of an awaited expect(...).resolves or
 * .rejects. `expect(call)` alone asserts on the pending promise, which always passes.
 */
function isAwaited(masked, index, depth = 0) {
  if (depth > 4) return false;
  const start = chainStart(masked, index);
  const before = masked.slice(Math.max(0, start - 80), start);
  if (/\b(?:await|return)\s*$/.test(before)) return true;
  if (/=>\s*$/.test(before)) return isArrowAwaited(masked, start - before.length + before.search(/=>\s*$/), depth);
  const expectCall = /\bexpect\s*\(\s*$/.exec(before);
  if (expectCall) {
    const expectIndex = start - before.length + expectCall.index;
    const close = closeParen(masked, masked.indexOf('(', expectIndex));
    return close !== -1 && /^\s*\.\s*(?:resolves|rejects)\b/.test(masked.slice(close)) && isAwaited(masked, expectIndex, depth + 1);
  }
  if (/[[,]\s*$/.test(before)) {
    const open = enclosingOpen(masked, start);
    if (open !== -1 && masked[open] === '[') return promiseAllAt(masked, open, depth);
  }
  return false;
}

/** The awaited Promise.all/allSettled/race/any call whose argument starts at `index`, or false. */
function promiseAllAt(masked, index, depth) {
  const head = masked.slice(Math.max(0, index - 60), index);
  const all = /\bPromise\s*\.\s*(?:all|allSettled|race|any)\s*\(\s*$/.exec(head);
  return all !== null && isAwaited(masked, index - head.length + all.index, depth + 1);
}

/**
 * An arrow function's expression body is returned to whoever calls the arrow, which usually awaits
 * it (a helper, act, a render callback). Not a forEach callback, whose results are dropped, and a map
 * callback only when the mapped array goes straight into an awaited Promise.all.
 */
function isArrowAwaited(masked, arrowAt, depth) {
  let params = skipSpaceBack(masked, arrowAt);
  if (masked[params - 1] === ')') params = openingBracket(masked, params - 1);
  else while (params > 0 && /[\w$]/.test(masked[params - 1])) params -= 1;
  if (params < 0) return true;
  const open = enclosingOpen(masked, params);
  if (open === -1 || masked[open] !== '(') return true;
  const callee = /\.\s*(forEach|map|flatMap)\s*$/.exec(masked.slice(Math.max(0, open - 30), open));
  if (callee === null) return true;
  if (callee[1] === 'forEach') return false;
  const method = open - masked.slice(Math.max(0, open - 30), open).length + callee.index + callee[0].indexOf(callee[1]);
  return promiseAllAt(masked, chainStart(masked, method), depth);
}

const RESULT_METHODS = ['rerender', 'unmount'];

/**
 * What a render call handed back, in this file: the names bound to a render, renderHook or
 * render-helper result (`const view = await render(...)`, `view = await renderWithProviders(...)` in a
 * beforeEach) and the local names of a destructured `{ rerender, unmount: unmountView }`. Only on
 * these are rerender() and unmount() RNTL calls; `sub.unmount()` on a subscription is not.
 */
function renderResultNames(masked, renderers) {
  const objects = new Set();
  const functions = new Set();
  if (renderers.length === 0) return { objects, functions };
  const call = `(?:await\\s+)?(?:${renderers.map(escapeRe).join('|')})\\s*(?:<[^>()]*>)?\\s*\\(`;
  for (const match of masked.matchAll(new RegExp(`(?:^|[^.\\w$])([A-Za-z_$][\\w$]*)\\s*(?::[^=;()]+)?=\\s*${call}`, 'gm'))) objects.add(match[1]);
  for (const match of masked.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${call}`, 'g'))) {
    for (const part of match[1].split(',')) {
      const [key, alias] = part.split(':').map((text) => text.trim().replace(/\s*=.*$/, ''));
      if (RESULT_METHODS.includes(key)) functions.add(alias || key);
    }
  }
  return { objects, functions };
}

function checkAwaits(code, masked, rel, helpers, report) {
  const rntl = importedNames(code, (source) => source === '@testing-library/react-native');
  const calls = [];
  for (const name of ['render', 'renderHook', 'act', 'waitFor', 'waitForElementToBeRemoved']) if (rntl.has(name)) calls.push(`(?<![\\w.$])${name}`);
  const renderers = ['render', 'renderHook'].filter((name) => rntl.has(name));
  for (const helper of helpers) {
    const helperNames = importedNames(code, helper.isModule);
    for (const name of helper.functions) {
      if (!helperNames.has(name) || name === 'createProvidersWrapper') continue;
      calls.push(`(?<![\\w.$])${escapeRe(name)}`);
      renderers.push(name);
    }
  }
  // rerender and unmount: on what a render call returned (or RNTL's screen), or destructured from it.
  const bound = renderResultNames(masked, renderers);
  if (rntl.has('screen')) bound.objects.add('screen');
  for (const name of bound.objects) calls.push(`(?<![\\w.$])${escapeRe(name)}\\s*\\.\\s*(?:${RESULT_METHODS.join('|')})`);
  for (const name of bound.functions) calls.push(`(?<![\\w.$])${escapeRe(name)}`);
  if (rntl.has('fireEvent')) calls.push('(?<![\\w.$])fireEvent(?:\\.\\w+)?');
  // A user-event instance: const user = userEvent.setup(), or let user; ... user = userEvent.setup() in a beforeEach.
  const users = new Set([...masked.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.]+(?:<[^>]*>)?\s*)?=\s*userEvent\s*\.\s*setup\s*\(/gm)].map((match) => match[1]));
  for (const user of users) calls.push(`(?<![\\w.$])${escapeRe(user)}\\s*\\.\\s*(?:${USER_METHODS})`);
  calls.push('(?<![\\w$])(?:screen\\.)?find(?:All)?By[A-Z]\\w*');
  const pattern = new RegExp(`(?:${calls.join('|')})\\s*(?:<[^>()]*>)?\\s*\\(`, 'g');
  for (const match of masked.matchAll(pattern)) {
    const head = masked.slice(Math.max(0, match.index - 20), match.index);
    if (/\b(function|async function)\s*$/.test(head) || /\bfunction\s+\w*$/.test(head)) continue;
    // A method definition or signature (unmount() { ... } in a fake, unmount(): Promise<void> in a type) is not a call.
    const close = closeParen(masked, match.index + match[0].length - 1);
    if (close !== -1 && /^\s*[{:]/.test(masked.slice(close))) continue;
    if (!isAwaited(masked, match.index)) {
      const name = match[0].replace(/\s*(<[^>()]*>)?\s*\($/, '').replace(/\s+/g, '');
      const inExpect = /\bexpect\s*\(\s*$/.test(masked.slice(Math.max(0, chainStart(masked, match.index) - 20), chainStart(masked, match.index)));
      report.problem({ file: rel, line: lineOf(code, match.index), rule: 'rntl-await', message: `${name}(...) is not awaited${inExpect ? ' (expect() receives the pending promise, so the assertion always passes)' : ''}`, fix: inExpect ? `Write expect(await ${name}(...)) or await expect(${name}(...)).resolves.<matcher>().` : `Write await ${name}(...) (RNTL 14 returns promises); an un-awaited call runs after the assertions.` });
    }
  }
  return { rntl };
}

/** True when the promise of the call at `index` goes into expect(...).rejects: the test proves the call fails. */
function expectedToReject(masked, index) {
  const start = chainStart(masked, index);
  const before = masked.slice(Math.max(0, start - 40), start);
  const expectCall = /\bexpect\s*\(\s*$/.exec(before);
  if (!expectCall) return false;
  const close = closeParen(masked, masked.indexOf('(', start - before.length + expectCall.index));
  return close !== -1 && /^\s*\.\s*rejects\b/.test(masked.slice(close));
}

/**
 * The render(...) or renderHook(...) calls of the file without the app's providers: no { wrapper } of
 * their own (a provider tree the test builds), and not a call the test expects to reject (proving
 * that a hook or component fails outside its provider).
 */
function plainRenders(code, masked, name) {
  return [...code.matchAll(new RegExp(`(?<![\\w.$])${name}\\s*(?:<[^>()]*>)?\\s*\\(`, 'g'))].filter((match) => {
    const open = match.index + match[0].length - 1;
    const close = closeParen(code, open);
    return close !== -1 && !/\bwrapper\b/.test(code.slice(open, close)) && !expectedToReject(masked, match.index);
  });
}

function checkRender(code, masked, source, rel, context, rntl, report) {
  const isComponentTest = rel.endsWith('.tsx') && context.sourceRoots.some((dir) => rel.startsWith(`${dir}/`));
  if (isComponentTest && rntl.has('render') && !hasMarker(source, 'no-providers') && plainRenders(code, masked, 'render').length > 0) {
    const at = code.search(/import\s+\{[^}]*\brender\b[^}]*\}\s*from\s*['"]@testing-library\/react-native['"]/);
    report.problem({ file: rel, line: lineOf(code, Math.max(at, 0)), rule: 'render-with-providers', message: 'renders with RNTL render() instead of renderWithProviders', fix: `Use await renderWithProviders(<X />, options) from @test/${basename(context.helpers[0].file).replace(/\.tsx?$/, '')}: the app's real providers, a catalog that throws on a missing message, seeded stores, only the services the test passes. Only if the component reads nothing from context (props only), or the test supplies the provider under test itself or proves the no-provider default, keep render() and add "// no-providers: <why>" to the file.` });
  }
  for (const match of code.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(\w+)\s*\(/g)) {
    if ((match[2] === 'render' || context.helpers.some((helper) => helper.functions.includes(match[2]))) && /\b(?:get|query|find)(?:All)?By\w+/.test(match[1])) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'destructured-queries', message: 'queries are destructured from the render result', fix: 'Query through screen (screen.getByRole(...)); destructure only stores, services, rerender or unmount.' });
  }
  for (const match of code.matchAll(new RegExp(`\\buserEvent\\.(?:${USER_METHODS})\\s*\\(`, 'g'))) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'user-event-setup', message: `${match[0].replace(/\s*\($/, '')}(...) is called without a setup() instance`, fix: 'const user = userEvent.setup(); then await user.press(...).' });
  }
}

function checkExpectations(code, masked, source, rel, report) {
  for (const match of code.matchAll(/\bexpect\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closeParen(code, open);
    if (close === -1) continue;
    const arg = code.slice(open + 1, close - 1).trim();
    const chain = code.slice(close, close + 40);
    const isQuery = /^(?:await\s+)?(?:screen\.)?queryBy\w+\s*\(/.test(arg);
    const isGet = /^(?:screen\.)?get(?:All)?By\w+\s*\(/.test(arg);
    const absence = /^\s*\.(?:not\s*\.\s*toBeOnTheScreen|toBeNull|toBeFalsy)\s*\(/.test(chain);
    if (isQuery && !absence) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'query-for-presence', message: `expect(${arg.split('(')[0]}(...)) asserts something other than absence`, fix: 'Use getBy* (or await findBy*) for presence; keep queryBy* for .not.toBeOnTheScreen().' });
    if (isGet && absence) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'get-for-absence', message: `expect(${arg.split('(')[0]}(...)) checks absence, but getBy* throws before the assertion`, fix: 'Use expect(screen.queryBy...(...)).not.toBeOnTheScreen().' });
  }
  for (const match of code.matchAll(/(?<![\w.$])waitFor\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closeParen(code, open);
    if (close !== -1 && /\.(?:press|longPress|type|clear|paste)\s*\(|\bfireEvent\b/.test(code.slice(open, close))) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'waitfor-side-effect', message: 'a press or fireEvent runs inside waitFor', fix: 'Do the action first (await user.press(...)), then wait with await screen.findBy...(...) or one assertion in waitFor.' });
  }
  const isPlainOnPurpose = hasMarker(source, 'no-providers');
  for (const match of isPlainOnPurpose ? [] : plainRenders(code, masked, 'renderHook')) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'render-hook-wrapper', message: 'renderHook(...) has no wrapper', fix: 'Use await renderHookWithProviders(() => useX(), options), or pass { wrapper } from createProvidersWrapper(options), so the hook sees the stores, services, catalog and theme. Only if the hook reads nothing from context (injected dependencies only), or the test supplies the provider under test itself or proves the hook\'s no-provider default, add "// no-providers: <why>" to the file.' });
  }
}

function checkStyle(code, source, rel, context, report) {
  if (context.styleContractGlobs.some((glob) => matchGlob(rel, glob))) return;
  const lines = source.split('\n');
  const reasoned = (text) => {
    const allow = /allow-style-assertion:\s*(.+)$/m.exec(text);
    return allow !== null && allow[1].trim().length >= 10;
  };
  if (reasoned(lines.slice(0, 15).join('\n'))) return;
  for (const match of code.matchAll(/\.toHaveStyle\s*\(/g)) {
    const line = lineOf(code, match.index);
    if (!reasoned(`${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`)) report.problem({ file: rel, line, rule: 'style-assertion', message: 'asserts a style', fix: 'Assert visible text, role or accessible name; looks are proven on device screenshots. Where the style itself is the contract (a direction that must not mirror, a progress fill width), add "// allow-style-assertion: <why>" on the line above or in the file header.' });
  }
}

function checkSnapshots(code, rel, report) {
  if (rel.endsWith('.golden.test.ts')) return;
  for (const match of code.matchAll(/\.(toMatchSnapshot|toMatchInlineSnapshot)\s*\(/g)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'component-snapshot', message: `${match[1]}() outside a golden test`, fix: 'Assert what the user sees (text, roles, accessible names, state). Readable data snapshots belong in a <unit>.golden.test.ts that changes only on purpose (golden-and-snapshot-tests).' });
}

function checkTestRenderer(code, rel, report) {
  const quoted = String.raw`['"]react-test-renderer(?:\/[^'"]*)?['"]`;
  for (const match of code.matchAll(new RegExp(String.raw`(?:\bfrom\s*${quoted}|(?<![\w.$])(?:require|import)\s*\(\s*${quoted}|^\s*import\s+${quoted})`, 'gm'))) {
    if (/^import\s+type\b/.test(code.slice(code.lastIndexOf('\n', match.index) + 1).trimStart())) continue;
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'react-test-renderer', message: 'the test imports react-test-renderer, which React 19 deprecates', fix: 'Render with await renderWithProviders(<X />) from the render helper (RNTL 14 renders through test-renderer) and assert roles, names and text; remove react-test-renderer from package.json, as Expo\'s unit-testing guide says.' });
  }
}

function checkMocks(code, rel, context, report) {
  for (const sdk of context.vendorSdks) {
    const quoted = `['"]${escapeRe(sdk)}(?:\\/[^'"]*)?['"]`;
    const importRe = new RegExp(`(?:\\bfrom\\s*${quoted}|(?<![\\w.$])(?:require|import)\\s*\\(\\s*${quoted}|^\\s*import\\s+${quoted})`, 'gm');
    for (const match of code.matchAll(importRe)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'vendor-sdk-import', message: `the test imports ${sdk}`, fix: `Write jest.mock('${sdk}') and read it with jest.requireMock<Typed>('${sdk}'); only the adapter imports the SDK.` });
  }
  for (const match of code.matchAll(/\bjest\.requireMock\s*(?:<[^>()]*(?:<[^>()]*>)?[^>()]*>)?\s*\(\s*['"]([^'"]+)['"]/g)) {
    if (!new RegExp(`\\bjest\\.mock\\s*\\(\\s*['"]${escapeRe(match[1])}['"]`).test(code)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'require-mock-without-mock', message: `jest.requireMock('${match[1]}') without jest.mock('${match[1]}')`, fix: `Add jest.mock('${match[1]}'); at the top: without it requireMock returns a second instance and assertions see zero calls.` });
  }
  for (const match of code.matchAll(/\bjest\.mock\s*\(\s*['"]([^'"]+)['"]/g)) {
    const target = match[1];
    const isOwn = target.startsWith('.') || context.ownPrefixes.some((prefix) => target.startsWith(prefix));
    if (isOwn && /\/stores?\/|[-/]store(?:\.tsx?)?$/.test(target)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'mocked-store', message: `jest.mock('${target}') mocks a store`, fix: 'Seed state through renderWithProviders(<X />, { ...seed }) and change it through the store\'s own actions, e.g. await act(() => { stores.tasks.getState().setDone(2, true); }).' });
    if (/^react-native\/Libraries\/Utilities\/Platform/.test(target)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'platform-override', message: `jest.mock('${target}') replaces the Platform module`, fix: 'Test Android behaviour in <unit>.android.test.ts(x): the android project runs it under jest-expo/android with the real Platform.OS and .android files.' });
  }
}

function checkTiming(code, source, rel, context, report) {
  if (context.logicTestGlobs.some((glob) => matchGlob(rel, glob)) && !hasMarker(source, 'allow-fake-timers')) {
    for (const match of code.matchAll(/\bjest\.useFakeTimers\s*\(/g)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'fake-timers-in-logic', message: 'fake timers in a logic test', fix: 'Inject ClockPort (createFakeClock) or pass timestamps; fake timers are only for UI timers inside components.' });
  }
  const sleeps = /new\s+Promise\s*(?:<[^>()]*>)?\s*\(\s*\(?\s*\w*\s*\)?\s*=>\s*\{?\s*(?:setTimeout|setInterval)\s*\(|\bawait\s+(?:sleep|delay|wait)\s*\(/g;
  for (const match of code.matchAll(sleeps)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'test-sleep', message: 'the test sleeps', fix: 'Wait for a result instead: await screen.findBy...(...), or await flushMicrotasks() (@test/flush-microtasks) for settled promises.' });
  for (const match of code.matchAll(/\bjest\.retryTimes\s*\(/g)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'test-retries', message: 'the test file retries failing tests', fix: 'Remove jest.retryTimes; rerun the failure with npx jest --ci --randomize --seed=<n> -i <file> and fix the cause.' });
  const platformWrite = /\bPlatform\.OS\s*=(?!=)|Object\.defineProperty\s*\(\s*Platform\s*,\s*['"]OS['"]|jest\.replaceProperty\s*\(\s*Platform\s*,\s*['"]OS['"]|jest\.spyOn\s*\(\s*Platform\s*,\s*['"]OS['"]/g;
  for (const match of code.matchAll(platformWrite)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'platform-override', message: 'the test overwrites Platform.OS', fix: 'Move the Android case to <unit>.android.test.ts(x): the android project runs it under jest-expo/android (real Platform.OS, .android files); an overwritten Platform.OS leaks into later tests and skips .android file resolution.' });
}

const ROUTER_MATCHERS = ['toHavePathname', 'toHavePathnameWithParams', 'toHaveSegments', 'toHaveSearchParams', 'toHaveRouterState'];

/**
 * Expo Router's own test API, used directly. Verified 2026-10-03 with expo-router 57.0.24 and RNTL
 * 14.0.1: renderRouter returns RNTL's render promise with the route getters attached to the promise
 * (so `await renderRouter(...)` hands back a result without them) and switches on fake timers that
 * outlive the test; its matchers and testRouter throw "screen.getPathname is not a function". Expo's
 * SDK 57 testing guide still shows `expect(screen).toHavePathname(...)`.
 */
function checkRouterTesting(code, rel, context, report) {
  const helper = `@test/${basename(context.helpers[1].file).replace(/\.tsx?$/, '')}`;
  const fix = `Use await renderRouterWithProviders(routes, { initialUrl }) from ${helper}: it awaits the first commit, restores real timers and returns getPathname(), getSegments() and getSearchParams(); navigate with await act(() => { router.push(...) }).`;
  const module = String.raw`['"]expo-router\/testing-library['"]`;
  const flagged = new Set();
  const flag = (index, message) => {
    const line = lineOf(code, index);
    if (flagged.has(`${line}:${message}`)) return;
    flagged.add(`${line}:${message}`);
    report.problem({ file: rel, line, rule: 'expo-router-testing', message, fix });
  };
  const named = importedNames(code, (source) => source === 'expo-router/testing-library');
  for (const name of named) {
    if (name !== 'renderRouter' && name !== 'testRouter') continue;
    const at = code.search(new RegExp(`import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*${module}`));
    flag(Math.max(at, 0), `imports ${name} from expo-router/testing-library`);
  }
  // A namespace or default import reaches renderRouter and testRouter as members (a type-only import is fine).
  for (const match of code.matchAll(new RegExp(String.raw`\bimport\s+(?!type\b)((?:\*\s*as\s+[\w$]+)|[\w$]+)\s*(?:,\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+)\s*)?from\s*${module}`, 'g'))) {
    flag(match.index, `imports expo-router/testing-library as ${match[1].replace(/\s+/g, ' ')}`);
  }
  for (const match of code.matchAll(new RegExp(String.raw`(?<![\w.$])(require|import)\s*\(\s*${module}`, 'g'))) {
    flag(match.index, `loads expo-router/testing-library with ${match[1]}()`);
  }
  for (const match of code.matchAll(/\.\s*renderRouter\s*\(/g)) flag(match.index, 'calls renderRouter(...) as a member of expo-router/testing-library');
  if (!named.has('testRouter')) {
    for (const match of code.matchAll(/\btestRouter\s*\.\s*[\w$]+\s*\(/g)) flag(match.index, 'calls testRouter from expo-router/testing-library');
  }
  for (const match of code.matchAll(new RegExp(`\\.(${ROUTER_MATCHERS.join('|')})\\s*\\(`, 'g'))) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'expo-router-testing', message: `${match[1]}() is Expo Router's matcher, which throws with RNTL 14`, fix: `Assert on the getters instead: expect(view.getPathname()).toBe('/tasks/7') with view from renderRouterWithProviders (${helper}).` });
  }
}

/** The root a file belongs to: a workspace folder (multi-package), else src/, test/ or scripts/. */
function rootOf(rel, roots) {
  return roots.filter((dir) => rel === dir || rel.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}

function checkImports(code, rel, context, report) {
  const own = rootOf(rel, context.importRoots);
  if (own === null) return;
  for (const match of code.matchAll(/(?:\bfrom\s*|(?<![\w.$])(?:import|require|jest\.mock|jest\.requireActual)\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g)) {
    const target = posix.normalize(posix.join(posix.dirname(rel), match[1]));
    if (rootOf(target, context.importRoots) === own) continue;
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'cross-root-import', message: `imports ${match[1]} (${target}) across ${context.mode === 'monorepo' ? 'workspaces' : 'source roots'} by a relative path`, fix: context.mode === 'monorepo' ? 'Import by package name (@<org>/<package>/...); jest.config.js maps it to the source, so Stryker mutates the file the test runs.' : 'Import through the path aliases (@/... for src/, @test/... for test/); jest.config.js maps both to <rootDir>.' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const layout = resolveLayout(root);
  const contract = loadContract(layout, options.contract);
  const report = createReporter({ name: SPEC.name, json: options.json });
  const rootMocks = existsSync(join(root, layout.mocksDir)) ? walkRepo(root, { include: [`${layout.mocksDir}/**`] }).filter((rel) => /\.(ts|tsx|js)$/.test(rel)).map((rel) => rel.slice(layout.mocksDir.length + 1).replace(/\.(ts|tsx|js)$/, '')) : [];
  const helperOf = ({ file, functions }) => {
    const base = basename(file).replace(/\.tsx?$/, '');
    return { file, functions, isModule: (source) => source.replace(/\.tsx?$/, '').split('/').pop() === base };
  };
  const context = {
    mode: layout.mode,
    sourceRoots: sourceRoots(layout),
    importRoots: layout.mode === 'monorepo' ? [...layout.workspaces.map((workspace) => workspace.dir), layout.testDir, layout.scriptsDir] : [layout.srcDir, layout.testDir, layout.scriptsDir],
    styleContractGlobs: contract.styleContractGlobs,
    logicTestGlobs: contract.logicTestGlobs,
    vendorSdks: [...new Set([...KNOWN_ROOT_MOCKS, ...contract.rootMocks, ...rootMocks])].sort(),
    ownPrefixes: [...layout.aliases.map(({ pattern }) => pattern.replace(/\*$/, '')), ...layout.workspaces.filter((workspace) => workspace.name).map((workspace) => `${workspace.name}/`)],
    helpers: [helperOf(contract.renderHelper), helperOf(contract.routerHelper)],
  };
  const files = testCandidates(root, layout, { ignore: [...contract.otherRunnerGlobs, ...(options.ignore ?? [])] });
  for (const rel of files) {
    const source = readFileSync(join(root, rel), 'utf8');
    const code = maskComments(source);
    const masked = maskCode(source);
    const { rntl } = checkAwaits(code, masked, rel, context.helpers, report);
    checkRender(code, masked, source, rel, context, rntl, report);
    checkExpectations(code, masked, source, rel, report);
    checkStyle(code, source, rel, context, report);
    checkSnapshots(code, rel, report);
    checkTestRenderer(code, rel, report);
    checkMocks(code, rel, context, report);
    checkTiming(code, source, rel, context, report);
    checkRouterTesting(code, rel, context, report);
    checkImports(code, rel, context, report);
  }
  return report.finish({ checked: files.length, unit: 'test files' });
});
