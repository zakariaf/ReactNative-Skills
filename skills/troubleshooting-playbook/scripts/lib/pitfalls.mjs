// pitfalls.mjs: known failures that can be seen in the repo before they happen. Each rule names its
// catalogue id; check-catalogue.mjs proves every id exists. A rule returns findings
// [{ file, line, message }] from the repo context { root, layout, files, read(rel), globs }.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_SKILL_FOLDERS, lineOf, matchGlob, maskComments } from '../check-lib.mjs';

const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec|golden\.test|sim\.test|perf\.test)\.[cm]?[jt]sx?$/;
const RAW = /\.(json|ya?ml|plist)$/;
const CODE_EXTS = '{ts,tsx}';
const TOOL_EXTS = '{ts,mts,mjs,cjs,js,sh}';

/** The app folders: the repo root, or each workspace with its own layout (When multi-package). */
function apps(layout) {
  if (layout.workspaces.length === 0) return [{ dir: '', layout }];
  return [{ dir: '', layout }, ...layout.workspaces.map((workspace) => ({ dir: workspace.dir, layout: workspace.layout }))];
}

const prefix = (dir, rel) => (dir ? `${dir}/${rel}` : rel);

/** Glob lists built from resolveLayout, so a moved src/ or scripts/ folder is followed. */
export function layoutGlobs(layout) {
  const list = apps(layout);
  const each = (make) => [...new Set(list.flatMap(make))];
  return {
    code: each(({ dir, layout: l }) => [`${l.srcDir}/**/*.${CODE_EXTS}`, prefix(dir, `index.${CODE_EXTS}`)]),
    tooling: each(({ layout: l }) => [`${l.scriptsDir}/**/*.${TOOL_EXTS}`]),
    plists: each(({ layout: l }) => [`${l.scriptsDir}/**/*.plist`]),
    appConfig: each(({ dir }) => [prefix(dir, 'app.config.{ts,mts,js,mjs,cjs}')]),
    config: each(({ dir, layout: l }) => [prefix(dir, 'app.config.{ts,mts,js,mjs,cjs}'), `${l.configDir}/**/*.ts`, prefix(dir, 'plugins/**/*.{ts,js}')]),
    metro: each(({ dir }) => [prefix(dir, 'metro.config.{js,cjs}')]),
    packageJsons: each(({ dir }) => [prefix(dir, 'package.json')]),
    flows: each(({ layout: l }) => [`${l.e2eDir}/**/*.{yaml,yml}`]),
    testOnlyGate: each(({ layout: l }) => [`${l.srcDir}/test-only.ts`]),
    trackingAdapter: each(({ layout: l }) => [`${l.servicesDir}/consent/expo-tracking-consent-adapter.ts`]),
    contracts: each(({ layout: l }) => [l.contractsDir]),
    tests: each(({ dir, layout: l }) => [`${l.srcDir}/**/*.test.${CODE_EXTS}`, `${l.srcDir}/**/__tests__/**/*.${CODE_EXTS}`, `${l.testDir ?? prefix(dir, 'test')}/**/*.${CODE_EXTS}`]),
  };
}

function filesMatching(ctx, globs, { tests = true } = {}) {
  return ctx.files.filter((rel) => globs.some((glob) => matchGlob(rel, glob)) && (tests || !TEST_FILE.test(rel)));
}

/** Code with comments blanked (line numbers kept); data files as they are. */
function text(ctx, rel) {
  return RAW.test(rel) ? ctx.read(rel) : maskComments(ctx.read(rel));
}

/** One finding per line where `pattern` matches (every match in every file, so a second bad call is not hidden by the first). */
function grep(ctx, globs, pattern, message, { except = [], tests = true } = {}) {
  const findings = [];
  const every = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const rel of filesMatching(ctx, globs, { tests })) {
    if (except.includes(rel)) continue;
    const body = text(ctx, rel);
    const lines = new Set();
    for (const match of body.matchAll(every)) {
      const line = lineOf(body, match.index);
      if (!lines.has(line)) findings.push({ file: rel, line, message });
      lines.add(line);
    }
  }
  return findings;
}

function dependencies(ctx, rel) {
  try {
    const pkg = JSON.parse(ctx.read(rel));
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

/** Every dependency of every package.json of the repo (root and workspaces), first declaration wins. */
function allDependencies(ctx) {
  const merged = {};
  for (const rel of filesMatching(ctx, ctx.globs.packageJsons)) {
    for (const [name, version] of Object.entries(dependencies(ctx, rel))) merged[name] ??= String(version);
  }
  return merged;
}

/** Findings for dependencies whose name matches and for which bad(version, allDeps) is true. */
function depRule(ctx, names, bad, message) {
  const findings = [];
  const everything = allDependencies(ctx);
  for (const rel of filesMatching(ctx, ctx.globs.packageJsons)) {
    const body = ctx.read(rel);
    for (const [name, version] of Object.entries(dependencies(ctx, rel))) {
      if (names.includes(name) && bad(String(version), everything)) findings.push({ file: rel, line: lineOf(body, Math.max(0, body.indexOf(`"${name}"`))), message: `${name}@${version}: ${message}` });
    }
  }
  return findings;
}

function readJsonFile(ctx, rel) {
  try {
    return JSON.parse(ctx.read(rel));
  } catch {
    return null;
  }
}

/** A contract value (contracts/<name>.json at the layout's contractsDir), or undefined. */
function contractValue(ctx, name, key) {
  for (const dir of ctx.globs.contracts) {
    const rel = `${dir}/${name}`;
    if (ctx.files.includes(rel)) return readJsonFile(ctx, rel)?.[key];
  }
  return undefined;
}

const major = (version) => Number(/(\d+)/.exec(version ?? '')?.[1] ?? 0);
const firstLine = (ctx, rel, pattern) => {
  const body = text(ctx, rel);
  const index = body.search(pattern);
  return index < 0 ? 1 : lineOf(body, index);
};

/** True when a folder below the root holds a SKILL.md within a few levels (an installed skill library). */
function holdsSkills(dir, depth = 3) {
  if (depth < 0 || !existsSync(dir)) return false;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  if (names.includes('SKILL.md')) return true;
  return names.some((name) => name !== 'node_modules' && statSync(join(dir, name), { throwIfNoEntry: false })?.isDirectory() && holdsSkills(join(dir, name), depth - 1));
}

/** The agent skill folders at the root that hold installed skills (skills/, .agents/, .claude/ ...). */
function skillFolders(ctx) {
  return AGENT_SKILL_FOLDERS.filter((folder) => holdsSkills(join(ctx.root, folder)));
}

/**
 * adb device commands (android-emulator-build's list): each needs -s <serial> before it. adb devices,
 * version, start-server, help and keygen name no device and are never flagged.
 */
const ADB_DEVICE_COMMANDS = ['shell', 'install', 'install-multiple', 'uninstall', 'push', 'pull', 'logcat', 'reverse', 'forward', 'emu', 'reboot', 'root', 'unroot', 'remount', 'wait-for-device', 'exec-out', 'bugreport', 'sideload', 'get-state', 'get-serialno', 'jdwp', 'sync', 'tcpip', 'usb'];
const ADB_COMMAND = `(?:-[ed]|${ADB_DEVICE_COMMANDS.join('|')})`;
// Text form (adb followed by a device command in a shell script or a command string) and array form
// (an execFileSync/spawn argument list for 'adb'): the first word after adb is -e, -d or a device command.
const ADB_UNNAMED = new RegExp(`\\badb\\s+${ADB_COMMAND}(?![\\w-])|['"\`]adb['"\`]\\s*,\\s*\\[\\s*['"\`]${ADB_COMMAND}['"\`]`);

export const PITFALLS = [
  // ---- build: Expo config, variants, Metro
  { id: 'build-metro-cache-variant', detect: (ctx) => filesMatching(ctx, ctx.globs.metro).filter((rel) => !/cacheVersion\s*=[^;\n]*(EXPO_PUBLIC_|publicEnvCacheVersion)/.test(maskComments(ctx.read(rel)))).map((rel) => ({ file: rel, line: 1, message: 'metro.config does not key cacheVersion on the EXPO_PUBLIC_* values: a production build can reuse development transforms and ship test-only code' })) },
  { id: 'build-config-missing-ts-extension', detect: (ctx) => grep(ctx, ctx.globs.appConfig, /\bfrom\s+['"]\.{1,2}\/(?:[^'"]*\/)?[^'"/.]+['"]/, 'a relative import without its file extension: Node type stripping cannot resolve it when Expo loads the config') },
  { id: 'build-imported-constant-gate', detect: (ctx) => grep(ctx, ctx.globs.code, /require\(\s*['"][^'"]*test-only-entry(?:\.tsx?)?['"]\s*\)/, 'requires the test-only entry outside the literal gate in src/test-only.ts: the production bundle keeps it', { except: filesMatching(ctx, ctx.globs.testOnlyGate), tests: false }) },
  { id: 'build-reload-during-bundle-eval', detect: (ctx) => grep(ctx, ctx.globs.code, /^(?:void\s+|await\s+)?reloadAppAsync\(/m, 'calls reloadAppAsync() at module scope: a Release app terminates (startSurface failed)', { tests: false }) },
  { id: 'build-edge-to-edge-option', detect: (ctx) => grep(ctx, ctx.globs.appConfig, /\bedgeToEdgeEnabled\b/, 'sets android.edgeToEdgeEnabled, which SDK 54+ ignores (edge-to-edge is mandatory on Android 16); remove it and pad with safe-area insets') },
  { id: 'build-metro-template-import', detect: (ctx) => grep(ctx, ctx.globs.code, /\bimport\(\s*`/, 'template-string dynamic import: Metro cannot bundle it') },
  // ---- devices: named, never shared
  { id: 'ios-wrong-xcode', detect: (ctx) => grep(ctx, ctx.globs.tooling, /xcode-select['"]?\s*,\s*\[?\s*['"]\s*(?:-s|--switch)\b|xcode-select\s+(?:-s|--switch)\b/, 'switches the machine-wide Xcode with xcode-select; select it per process with DEVELOPER_DIR') },
  { id: 'ios-other-sessions-simulators', detect: (ctx) => grep(ctx, ctx.globs.tooling, /['"](?:shutdown|erase|delete)['"]\s*,\s*['"](?:all|booted)['"]|simctl\s+(?:shutdown|erase|delete)\s+all\b|simctl\s+[\w-]+(?:\s+[\w-]+)?\s+booted\b/, 'targets all simulators or "booted": other sessions use them too; target your own simulator by UDID') },
  { id: 'android-adb-unnamed-device', detect: (ctx) => grep(ctx, ctx.globs.tooling, ADB_UNNAMED, 'runs an adb device command without -s <serial>: with two devices it fails, or it reaches another session\'s emulator; use adbArgs(serial, ...)') },
  // ---- dependencies
  { id: 'deps-eslint-10-crash', detect: (ctx) => depRule(ctx, ['eslint'], (v, all) => major(v) >= 10 && major(all['eslint-config-expo']) <= 57, 'eslint-config-expo 57 crashes on ESLint 10; pin 9.39.5') },
  { id: 'deps-typescript-7', detect: (ctx) => depRule(ctx, ['typescript'], (v, all) => major(v) >= 7 && major(all['typescript-eslint']) <= 8, 'TypeScript 7 has no compiler API yet; typescript-eslint 8 needs typescript below 6.1') },
  { id: 'deps-jest-30', detect: (ctx) => depRule(ctx, ['jest'], (v, all) => major(v) >= 30 && major(all['jest-expo']) <= 58, 'jest-expo 57/58 depend on Jest 29; stay on 29.7') },
  { id: 'deps-test-renderer-1-3', detect: (ctx) => depRule(ctx, ['test-renderer'], (v, all) => /^[~^]?1\.3/.test(v) && major(all.expo) <= 57, 'test-renderer 1.3 targets React 19.3; SDK 57 (React 19.2) needs 1.2.0') },
  { id: 'deps-expo-install-range', detect: (ctx) => depRule(ctx, ['react-native-audio-api', 'react-native-google-mobile-ads', 'expo-iap'], (v) => !/^\d+\.\d+\.\d+$/.test(v), "is not pinned exactly (a fast-moving package outside Expo's module map: write the exact version)") },
  { id: 'deps-knip-skills-folder', detect: (ctx) => {
    if (!ctx.files.includes('knip.json')) return [];
    const ignore = readJsonFile(ctx, 'knip.json')?.ignore;
    const globs = Array.isArray(ignore) ? ignore.map(String) : typeof ignore === 'string' ? [ignore] : [];
    return skillFolders(ctx).filter((folder) => !globs.some((glob) => glob === `${folder}/**` || glob === folder || glob === `${folder}/`)).map((folder) => ({ file: 'knip.json', line: 1, message: `knip.json does not ignore ${folder}/**, which holds installed skills: knip reads their templates and fixtures` }));
  } },
  // ---- i18n and direction
  { id: 'i18n-localization-rtl-flags', detect: (ctx) => {
    const deviceProfile = contractValue(ctx, 'rtl.json', 'directionSource') === 'device';
    return grep(ctx, ctx.globs.config, deviceProfile ? /\bforcesRTL\b/ : /\b(?:supportsRTL|forcesRTL)\b/, deviceProfile ? 'sets expo-localization forcesRTL, which overrides direction at every launch' : 'sets expo-localization supportsRTL/forcesRTL: the device language overrides the in-app direction at every launch');
  } },
  { id: 'i18n-force-rtl-reload', detect: (ctx) => filesMatching(ctx, ctx.globs.code, { tests: false }).filter((rel) => { const body = text(ctx, rel); return /\bforceRTL\s*\(/.test(body) && /\bUpdates\.reloadAsync\s*\(/.test(body); }).map((rel) => ({ file: rel, line: firstLine(ctx, rel, /\bUpdates\.reloadAsync\s*\(/), message: "reloads a direction change with expo-updates' reloadAsync, which rejects where updates are disabled; use reloadAppAsync from 'expo'" })) },
  { id: 'i18n-device-locale-format', detect: (ctx) => grep(ctx, ctx.globs.code, /\.toLocale(?:Date|Time)?String\(\s*\)/, "formats with toLocale*String() and no locale: the device language wins over the app's; format through react-intl", { tests: false }) },
  // ---- animation and canvas
  { id: 'animation-frame-clock-reset', detect: (ctx) => grep(ctx, ctx.globs.code, /\.timeSinceFirstFrame\b/, 'reads timeSinceFirstFrame, which resets when the frame callback restarts; use timestamp and a recorded start', { tests: false }) },
  { id: 'animation-shared-value-access', detect: (ctx) => sharedValueAccess(ctx) },
  { id: 'animation-runonjs-deprecated', detect: (ctx) => grep(ctx, ctx.globs.code, /(?<![.\w])runOnJS\b/, 'uses runOnJS (deprecated in Worklets 0.10); use scheduleOnRN', { tests: false }) },
  { id: 'animation-skia-mutable-path', detect: (ctx) => grep(ctx, ctx.globs.code, /\bSkia\.Path\.Make\(\s*\)/, 'builds a mutable SkPath (deprecated since Skia 2.6); use Skia.PathBuilder.Make()...build()', { tests: false }) },
  { id: 'animation-repeat-ignores-reduce-motion', detect: (ctx) => filesMatching(ctx, ctx.globs.code, { tests: false }).filter((rel) => { const body = text(ctx, rel); return /\bwithRepeat\s*\(/.test(body) && !/reduced?Motion/i.test(body); }).map((rel) => ({ file: rel, line: firstLine(ctx, rel, /\bwithRepeat\s*\(/), message: 'a repeating animation (withRepeat) that never reads reduce motion: it keeps moving for users who asked for less motion, and screenshots never settle' })) },
  // ---- state, async, dates
  { id: 'state-zustand-new-object', detect: (ctx) => newSelectorValues(ctx) },
  { id: 'state-abort-polyfill-missing-api', detect: (ctx) => grep(ctx, ctx.globs.code, /\.throwIfAborted\s*\(|\bsignal\.reason\b/, "uses AbortSignal.throwIfAborted or signal.reason, which React Native's abort-controller polyfill lacks (Jest passes, the device throws); check signal.aborted", { tests: false }) },
  { id: 'state-listener-signal-option', detect: (ctx) => grep(ctx, ctx.globs.code, /\baddEventListener\s*\([^)]*\{\s*[^}]*\bsignal\b/, "passes { signal } to addEventListener, which React Native's event-target-shim ignores; remove the listener in the cleanup", { tests: false }) },
  { id: 'state-countdown-utc', detect: (ctx) => grep(ctx, ctx.globs.code, /%\s*86_?400_?000\b/, 'epoch time modulo a day is UTC midnight, not local midnight; ask the clock port for the next local day', { tests: false }) },
  // ---- services
  // General-audience apps that show Google's ads ask for App Tracking Transparency first: the plugin
  // entry gives Info.plist its NSUserTrackingUsageDescription (without it the request crashes), and only
  // the consent adapter imports the package. A child-directed app (contracts/ads.json) has neither.
  { id: 'services-att-prompt-missing', detect: (ctx) => {
    if (contractValue(ctx, 'ads.json', 'audience') === 'child-directed') return [];
    const plugin = filesMatching(ctx, ctx.globs.appConfig).filter((rel) => { const body = text(ctx, rel); return /['"]react-native-google-mobile-ads['"]/.test(body) && !/['"]expo-tracking-transparency['"]/.test(body); }).map((rel) => ({ file: rel, line: firstLine(ctx, rel, /['"]react-native-google-mobile-ads['"]/), message: "lists Google's ads SDK but no ['expo-tracking-transparency', { userTrackingPermission }] plugin entry: Info.plist has no NSUserTrackingUsageDescription, so the tracking request crashes" }));
    const imports = grep(ctx, ctx.globs.code, /from\s+['"]expo-tracking-transparency['"]|require\(\s*['"]expo-tracking-transparency['"]\s*\)/, 'imports expo-tracking-transparency outside src/services/consent/expo-tracking-consent-adapter.ts: only the consent flow asks, after the consent form', { except: filesMatching(ctx, ctx.globs.trackingAdapter), tests: false });
    return [...plugin, ...imports];
  } },
  // ---- lint and tests
  { id: 'lint-jest-rules-spread', detect: (ctx) => grep(ctx, ['eslint.config.{js,mjs,cjs}'], /\.\.\.\s*[\w.]+\[\s*['"]flat\/recommended['"]\s*\]\s*,\s*\.\.\.\s*[\w.]+\[\s*['"]flat\/style['"]\s*\]/, 'spreads jest flat/recommended and flat/style into one object: every recommended rule is dropped; use extends') },
  { id: 'lint-complexity-switch', detect: (ctx) => grep(ctx, ['eslint.config.{js,mjs,cjs}'], /(?<![\w/-])['"]?complexity['"]?\s*:\s*\[\s*(?:['"]error['"]|2)\s*,\s*(?:\d+|\{(?![^}]*variant\s*:\s*['"]modified['"])[^}]*\})\s*\]/, "complexity without variant: 'modified' fails exhaustive switches") },
  // Jest runs the file's afterEach before React Testing Library's cleanup unmounts, so a store reset there
  // publishes to a mounted subscriber outside act(): every run logs the act() warning although all calls are awaited.
  { id: 'testing-store-reset-after-each', detect: (ctx) => grep(ctx, ctx.globs.tests, /\bafterEach\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{(?:(?!\}\);)[\s\S])*?)?(?:[\w.]*\.setState\(|\breset\w*Store\()/, 'resets a store in afterEach, before React Testing Library unmounts: the update reaches a mounted subscriber outside act(); reset it in beforeEach') },
  { id: 'testing-babel-config-missing', detect: (ctx) => (Object.keys(dependencies(ctx, 'package.json')).includes('jest-expo') && !['babel.config.js', 'babel.config.cjs'].some((name) => existsSync(join(ctx.root, name))) ? [{ file: 'package.json', line: 1, message: 'jest-expo is installed but babel.config.js is missing: every suite fails with a Flow syntax error' }] : []) },
  { id: 'testing-skia-global-env', detect: (ctx) => filesMatching(ctx, ['jest.config.{js,cjs,mjs,ts}']).filter((rel) => { const body = maskComments(ctx.read(rel)); return /testEnvironment\s*:\s*['"]@shopify\/react-native-skia\/jestEnv/.test(body) && !/\bprojects\s*:/.test(body); }).map((rel) => ({ file: rel, line: 1, message: "Skia's jestEnv is the global test environment; split unit and golden projects" })) },
  { id: 'testing-coverage-missing-dir', detect: (ctx) => coverageKeys(ctx) },
  { id: 'testing-snap-platform-path', detect: (ctx) => snapPlatformGated(ctx) },
  { id: 'testing-duplicate-manual-mock', detect: (ctx) => {
    const configs = filesMatching(ctx, ['jest.config.{js,cjs,mjs,ts}']);
    if (configs.length === 0) return [];
    const body = ctx.read(configs[0]);
    return skillFolders(ctx).filter((folder) => !new RegExp(`\\b${folder.replace(/^\./, '')}\\b`).test(body)).map((folder) => ({ file: configs[0], line: 1, message: `the Jest config does not ignore ${folder}/: Jest indexes the installed skills' __mocks__ (duplicate manual mock)` }));
  } },
  // ---- e2e
  { id: 'e2e-maestro-ai-commands', detect: (ctx) => grep(ctx, ctx.globs.flows, /\b(assertWithAI|assertNoDefectsWithAI|extractTextWithAI)\b/, 'uploads screenshots to a third-party service (banned in flows)') },
  { id: 'e2e-maestro-airplane', detect: (ctx) => filesMatching(ctx, ctx.globs.flows).filter((rel) => { const body = ctx.read(rel); return /\bsetAirplaneMode\b/.test(body) && !/platform:\s*Android\b/.test(body); }).map((rel) => ({ file: rel, line: firstLine(ctx, rel, /\bsetAirplaneMode\b/), message: 'setAirplaneMode does nothing on the iOS simulator; fake offline through the connectivity port, or keep the command in an Android-only flow' })) },
  { id: 'e2e-maestro-tags-flag', detect: (ctx) => [...grep(ctx, ctx.globs.tooling, /(?<![\w-])--tags\b/, 'passes --tags, which Maestro 2.10 rejects; use --include-tags / --exclude-tags'), ...grep(ctx, ctx.globs.packageJsons, /maestro[^"\n]*(?<![\w-])--tags\b/, 'passes --tags, which Maestro 2.10 rejects; use --include-tags / --exclude-tags')] },
  // ---- release (local lane)
  { id: 'release-app-store-method', detect: (ctx) => grep(ctx, ctx.globs.plists, /<key>method<\/key>\s*<string>app-store<\/string>/, 'ExportOptions method app-store is deprecated; use app-store-connect') },
  { id: 'release-manage-version-default', detect: (ctx) => filesMatching(ctx, ctx.globs.plists).filter((rel) => /export-?options/i.test(rel) && !/<key>manageAppVersionAndBuildNumber<\/key>\s*<false\s*\/>/.test(ctx.read(rel))).map((rel) => ({ file: rel, line: 1, message: 'manageAppVersionAndBuildNumber is not false: Xcode would rewrite the version and build numbers' })) },
  { id: 'release-secrets-printed', detect: (ctx) => grep(ctx, ctx.globs.tooling, /console\.(?:log|info|warn|error)\([^;]*\b(token|jwt|privateKeyPem|authorization)\b/i, 'prints a token, JWT, key or Authorization header') },
  // ---- gates
  { id: 'gates-commit-msg-enobufs', detect: (ctx) => filesMatching(ctx, ctx.globs.tooling).filter((rel) => /(^|\/)check-commit-message\.[cm]?[jt]s$/.test(rel) && /\bspawnSync\s*\(/.test(ctx.read(rel)) && !/\bmaxBuffer\b/.test(ctx.read(rel))).map((rel) => ({ file: rel, line: 1, message: 'spawnSync without maxBuffer: a large staged diff fails the hook with ENOBUFS' })) },
];

const SELECTOR_START = /\buse\w*Store\(\s*\(?\s*\w*\s*\)?\s*=>\s*/g;
const NEW_ARRAY_CALL = /^(?:[\w$.?]+\.(?:filter|map|flatMap|slice|concat|toSorted|toReversed|toSpliced)|Object\.(?:keys|values|entries)|Array\.from)\s*\(/;
const CHAINED_ARRAY_CALL = /^\s*\??\.\s*(?:filter|map|flatMap|slice|concat|toSorted|toReversed|toSpliced)\s*\(/;

/** The index just after the bracket that closes the one at `open` (strings and comments are not skipped). */
function closingAfter(body, open) {
  let depth = 0;
  for (let index = open; index < body.length; index += 1) {
    const char = body[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/**
 * A selector passed straight to a store hook that returns a new object or array on every call:
 * `useStore((s) => ({ ... }))`, `(s) => [ ... ]`, or `(s) => s.items.filter(...)` / `.map(...)` /
 * `Object.values(...)` (also chained). A result read further (`.length`, `[0]`, `.join(...)`) is a
 * stable value and is not flagged; a selector wrapped in useShallow never starts with the arrow.
 */
function newSelectorValues(ctx) {
  const findings = [];
  const message = 'a store selector returns a new object or array on every call (Maximum update depth exceeded); wrap it in useShallow, or select the stored value and derive outside the hook';
  for (const rel of filesMatching(ctx, ctx.globs.code, { tests: false })) {
    const body = text(ctx, rel);
    for (const start of body.matchAll(SELECTOR_START)) {
      const at = start.index + start[0].length;
      const rest = body.slice(at, at + 400);
      let isNew = /^(?:\(\s*\{|\[)/.test(rest);
      const call = NEW_ARRAY_CALL.exec(rest);
      if (!isNew && call) {
        let end = closingAfter(body, at + call[0].length - 1);
        while (end > 0) {
          const chained = CHAINED_ARRAY_CALL.exec(body.slice(end, end + 200));
          if (!chained) break;
          end = closingAfter(body, end + chained[0].length - 1);
        }
        isNew = end > 0 && !/^\s*(?:\??\.|\[|\?\?|\|\||&&|[+\-*/%<>=!])/.test(body.slice(end, end + 20));
      }
      if (isNew) findings.push({ file: rel, line: lineOf(body, start.index), message });
    }
  }
  return findings;
}

/** `const x = useSharedValue(...)` followed by `x.value`: use x.get() / x.set() under the React Compiler. */
function sharedValueAccess(ctx) {
  const findings = [];
  for (const rel of filesMatching(ctx, ctx.globs.code, { tests: false })) {
    const body = maskComments(ctx.read(rel));
    for (const declared of body.matchAll(/const\s+(\w+)\s*=\s*useSharedValue\b/g)) {
      const use = new RegExp(`\\b${declared[1]}\\.value\\b`).exec(body);
      if (use) {
        findings.push({ file: rel, line: lineOf(body, use.index), message: `${declared[1]}.value: use ${declared[1]}.get() / .set() (compiler-safe)` });
        break;
      }
    }
  }
  return findings;
}

/** Static coverageThreshold keys such as './src/data/': { ... } that point at missing folders. */
function coverageKeys(ctx) {
  const findings = [];
  for (const rel of filesMatching(ctx, ['jest.config.{js,cjs,mjs,ts}'])) {
    const body = maskComments(ctx.read(rel));
    if (/\bglobSync\b|\bexistsSync\b/.test(body)) continue; // keys are filtered by what exists
    for (const key of body.matchAll(/['"](\.\/[^'"*{}]+)['"]\s*:\s*\{/g)) {
      if (!existsSync(join(ctx.root, key[1]))) findings.push({ file: rel, line: lineOf(body, key.index), message: `coverageThreshold key ${key[1]} matches no files yet: Jest exits 1 ("Coverage data ... was not found")` });
    }
  }
  return findings;
}

/** quality-gates.json gates golden snapshots but not the *.snap.<platform> files the jest-expo platform presets write. */
function snapPlatformGated(ctx) {
  if (!ctx.files.includes('quality-gates.json')) return [];
  const config = filesMatching(ctx, ['jest.config.{js,cjs,mjs,ts}'])[0];
  if (!config) return [];
  const body = maskComments(ctx.read(config));
  const gates = readJsonFile(ctx, 'quality-gates.json');
  if (!gates) return [{ file: 'quality-gates.json', line: 1, message: 'is not valid JSON' }];
  const paths = (Array.isArray(gates.gatedPaths) ? gates.gatedPaths : []).map(String);
  const findings = [];
  for (const platform of ['ios', 'android']) {
    const uses = new RegExp(`jest-expo/(?:${platform}|universal)\\b`).test(body);
    if (uses && !paths.some((glob) => glob.includes(`.snap.${platform}`))) findings.push({ file: 'quality-gates.json', line: 1, message: `gatedPaths has no **/*.golden.test.ts.snap.${platform} entry although the Jest config uses the ${platform} preset: golden updates pass without a Gate-Change trailer` });
  }
  return findings;
}
