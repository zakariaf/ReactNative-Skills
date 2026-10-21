#!/usr/bin/env node
// check-audio-haptics.mjs: checks how an Expo app wires sound effects and haptics: one pinned audio
// engine and one haptics library behind their ports, the one ambient AudioContext, Android audio
// focus, the config plugin, recorded files, the voice and haptic policies on iOS and Android, the UI
// feedback table, the lifecycle, and where sounds and pulses may fire.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-audio-haptics.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, parseJsonc, readWorkspaces, requireDir, resolveLayout, run, walkRepo } from './check-lib.mjs';
import { forEachExpoApp } from './lib/expo-apps.mjs';
import { LiteralError, findConstInitializer, parseObjectEntries } from './lib/ts-literal.mjs';

const SPEC = {
  name: 'check-audio-haptics',
  summary: 'Checks the sound-effect and haptics wiring of an Expo app (src/services/audio, haptics, feedback, the config plugin, call sites).',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The audio feedback contract (default: rn-skills.config.json "audioFeedbackContract", else contracts/audio-feedback.json; missing = the defaults)' },
    'src-dir': { type: 'string', value: 'dir', help: 'The source folder inside the app (default: from resolveLayout, src); a workspace repo checks each Expo app workspace from the root' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (paths are the resolved layout; defaults shown):',
    '  audio-file-missing       the audio, haptics and feedback services, their tests, the config plugin, the root mock',
    '                           and src/hooks/use-is-app-active.ts exist (each part only when it applies)',
    '  audio-pin                react-native-audio-api is pinned exactly to the verified version (contract audioApiVersion,',
    '                           default 0.13.6) wherever it is listed (a package\'s peerDependencies may say "*"); the app lists it',
    '  haptics-dependency       the app lists expo-haptics with the tilde range npx expo install writes, on expo\'s major',
    '  second-feedback-library  no react-native-haptic-feedback or react-native-sound next to the ports',
    '  vendor-import            only the audio adapter imports react-native-audio-api, only the haptics adapter imports',
    '                           expo-haptics, nothing imports a second feedback library, the feedback layer imports no media',
    '                           player (expo-audio, expo-av, react-native-track-player), and Vibration is never imported in',
    '                           the feedback layer or a view (elsewhere only with "// vibration-exempt: <reason>")',
    '  audio-context            exactly one `new AudioContext(` (in the adapter), after setAudioSessionOptions({ iosCategory: \'ambient\' })',
    '  audio-focus              observeAudioInterruptions runs only on iOS and never with a focus type (on Android it requests',
    '                           audio focus, which fades out and mutes the user\'s music)',
    '  file-audio               in the feedback layer and any file importing react-native-audio-api: no streaming or URL',
    '                           audio (createStreamer, http(s) audio URLs), decodeAudioData only in the adapter and only for',
    '                           bundled sounds; every recorded audio file in the repo is listed in the contract (bundledSounds',
    '                           for feedback, otherAudio for a notification sound or a feature\'s media); a bundledSounds file',
    '                           is WAV, MP3 or FLAC (with FFmpeg and the static libraries off the library decodes nothing else)',
    '  preview-ignored          the root .gitignore ignores reports/ (the WAV previews)',
    '  audio-plugin             the react-native-audio-api config plugin overrides all five defaults and app.config uses it',
    '  mic-string               the audio plugin adds no microphone purpose string unless the line cites ITMS-90683',
    '  music-default            DEFAULT_AUDIO_SETTINGS keeps music off; no activelyReclaimSession anywhere',
    '  voice-policy             MAX_VOICES = 8, DEFAULT_MIN_INTERVAL_MS = 30, squared channel gain, 50 ms gain ramps',
    '  haptic-throttle          MIN_HAPTIC_GAP_MS = 40',
    '  haptic-table             each HapticCue maps to its iOS expo-haptics call',
    '  haptic-android           each HapticCue maps to an AndroidHaptics constant played with performAndroidHapticsAsync;',
    '                           constants newer than minSdk 24 have a legacy table chosen by Platform.Version; an optional',
    '                           ANDROID_API_30_CUES table uses only constants API 30 has (Confirm, Reject, Gesture_*)',
    '  haptic-safety            the haptics adapter gates through shouldPulse, reports isPad and ends the call with .catch(() => undefined)',
    '  cue-in-sim               no sound or haptic calls inside src/games/*/sim/ or \'worklet\' modules',
    '  button-haptics           src/ui, feature screens and components fire only the selection haptic',
    '  view-feedback            src/ui, feature screens and components never play sounds or cues themselves (audio.play,',
    '                           playCue, playUiFeedback): the model or a track cue does (the press-feedback context is exempt)',
    '  ui-feedback              every moment of UI_FEEDBACK is played (playUiFeedback); a tap moment needs a press surface',
    '                           in src/ui that runs usePressFeedback; no audio.play(\'ui.…\') by hand outside the audio and',
    '                           feedback services',
    '  android-touch-sound      with a tap sound, every press surface that runs usePressFeedback sets android_disableSound,',
    '                           and the PressFeedbackProvider that plays \'tap\' carries playsSound (the canonical surface',
    '                           sets android_disableSound from it)',
    '  lifecycle-mount          useAudioLifecycle is called exactly once (in the root layout)',
    '  dispose-before-reload    code that reloads the JS bundle (reloadAppAsync, reloadAsync, DevSettings.reload) awaits',
    '                           audio.dispose() first; or awaits an injected beforeReload/onBeforeReload hook first and a',
    '                           caller of that function passes the audio dispose (through callers that only forward the',
    '                           hook, such as DirectionRestart and DirectionGate); or carries "// audio-dispose-exempt:',
    '                           <reason>" on the line or above',
    '  audio-mock               the root mock adds AudioManager.setAudioSessionOptions and observeAudioInterruptions',
    '',
    'The audio part applies when src/services/audio exists, a source file imports react-native-audio-api (or',
    'react-native-sound), or the app config lists its plugin; the haptics part when src/services/haptics exists or a',
    'source file imports expo-haptics, Vibration or react-native-haptic-feedback; the feedback folder when both apply.',
    'A part that does not apply prints one note line. NOT APPLICABLE when neither applies; exit 2 without a package.json.',
    '',
    'Example: node check-audio-haptics.mjs .',
  ].join('\n'),
};

const VERIFIED_AUDIO_API = '0.13.6';
const CUES = ['selection', 'light', 'medium', 'heavy', 'success', 'warning', 'error'];
const IOS_TABLE = {
  selection: 'selectionAsync()',
  light: 'impactAsync(ImpactFeedbackStyle.Light)',
  medium: 'impactAsync(ImpactFeedbackStyle.Medium)',
  heavy: 'impactAsync(ImpactFeedbackStyle.Heavy)',
  success: 'notificationAsync(NotificationFeedbackType.Success)',
  warning: 'notificationAsync(NotificationFeedbackType.Warning)',
  error: 'notificationAsync(NotificationFeedbackType.Error)',
};
/** AndroidHaptics constants every API level from minSdk 24 has (expo-haptics 57.0.3 falls back to these only). */
const ANDROID_ALL_LEVELS = new Set(['Clock_Tick', 'Context_Click', 'Keyboard_Tap', 'Long_Press', 'Virtual_Key']);
/** AndroidHaptics constants that exist from API 30 (HapticFeedbackConstants CONFIRM, REJECT, GESTURE_START/END). */
const ANDROID_API_30_LEVELS = new Set([...ANDROID_ALL_LEVELS, 'Confirm', 'Reject', 'Gesture_Start', 'Gesture_End']);
const PLUGIN_OPTIONS = [
  ['iosBackgroundMode', /["']?\biosBackgroundMode["']?\s*:\s*false\b/],
  ['androidPermissions', /["']?\bandroidPermissions["']?\s*:\s*\[\s*\]/],
  ['androidForegroundService', /["']?\bandroidForegroundService["']?\s*:\s*false\b/],
  ['disableFFmpeg', /["']?\bdisableFFmpeg["']?\s*:\s*true\b/],
  ['disableStaticExternalLibs', /["']?\bdisableStaticExternalLibs["']?\s*:\s*true\b/],
];
const SECOND_LIBRARIES = { 'react-native-haptic-feedback': 'expo-haptics behind HapticsPort', 'react-native-sound': 'react-native-audio-api behind AudioPort' };
const MEDIA_PLAYERS = ['expo-audio', 'expo-av', 'react-native-track-player'];
const AUDIO_FILE = /\.(mp3|wav|m4a|aac|caf|ogg|oga|flac|aif|aiff|opus)$/i;
/** What react-native-audio-api 0.13.6 decodes with FFmpeg and the static libraries disabled (miniaudio's own decoders). */
const BUNDLED_DECODABLE = /\.(wav|mp3|flac)$/i;
const WORKLET_DIRECTIVE = /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]worklet['"];/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const RELOAD_CALL = /\b(reloadAppAsync|reloadAsync|DevSettings\s*\.\s*reload)\s*\(/g;
const DISPOSE_CALL = /\baudio\s*\??\.\s*dispose\s*\(\s*\)/;
const DISPOSE_REF = /\baudio\s*\??\.\s*dispose\b/;
/** The reload seam: `await beforeReload()` / `await deps.onBeforeReload?.()` before the reload call. */
const BEFORE_RELOAD_CALL = /\bawait\s+(?:[\w$]+\s*\??\.\s*)*(?:beforeReload|onBeforeReload)\s*(?:\?\.)?\s*\(/g;
const EXEMPT_MARKER = /audio-dispose-exempt:\s*\S.{8,}/;
const VIBRATION_IMPORT = /import\s*\{[^}]*\bVibration\b[^}]*\}\s*from\s*['"]react-native['"]/g;
const VIBRATION_EXEMPT = /vibration-exempt:\s*\S.{8,}/;
const AUDIO_API_IMPORT = /\bfrom\s+['"]react-native-audio-api(?:\/[^'"]*)?['"]|\brequire\(\s*['"]react-native-audio-api(?:\/[^'"]*)?['"]/;
const OTHER_AUDIO_PURPOSES = new Set(['notification', 'media']);
const SKILL = 'audio-and-haptics-feedback';

function readRel(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Value imports of a module (type-only imports are erased and always fine): source indexes. */
function valueImportsOf(source, pattern) {
  const re = new RegExp(`^[ \\t]*(import|export)\\s+(?!type\\b)[^;]*?from\\s+['"](${pattern})['"]|\\brequire\\(\\s*['"](${pattern})['"]`, 'gm');
  return [...source.matchAll(re)].map((match) => match.index);
}

/** The index of the bracket that closes the one at `open` (strings and comments already masked). */
function matchingBracket(source, open) {
  const pairs = { '[': ']', '{': '}', '(': ')' };
  const stack = [];
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = source.indexOf(ch, i + 1);
      i = end === -1 ? source.length : end;
    } else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack.at(-1) && (stack.pop(), stack.length === 0)) return i;
  }
  return source.length - 1;
}

/** The text between a call's opening parenthesis (at `from`) and its matching closing one. */
function callArguments(source, from) {
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')' && (depth -= 1) === 0) return source.slice(from, i);
  }
  return '';
}

function loadContract(root, layout, given) {
  const configured = layout.config?.audioFeedbackContract;
  const rel = given ?? configured ?? `${layout.contractsDir}/audio-feedback.json`;
  const text = readRel(root, rel);
  if (text === null) {
    if (given !== undefined || configured !== undefined) fail(`contract ${rel} does not exist`, 'Copy templates/contracts/audio-feedback.json there, or drop the option.');
    return { rel, audioApiVersion: VERIFIED_AUDIO_API, bundledSounds: [], otherAudio: [], exists: false };
  }
  let data;
  try {
    data = parseJsonc(text);
  } catch (error) {
    fail(`contract ${rel} is not valid JSON: ${error.message}`, 'Fix the JSON (templates/contracts/audio-feedback.schema.json describes it).');
  }
  const bad = (what) => fail(`contract ${rel}: ${what}`, 'Follow templates/contracts/audio-feedback.schema.json.');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) bad('is not an object');
  const known = new Set(['$schema', '$comment', 'audioApiVersion', 'bundledSounds', 'otherAudio']);
  for (const key of Object.keys(data)) if (!known.has(key)) bad(`unknown key "${key}"`);
  if (data.audioApiVersion !== undefined && !(typeof data.audioApiVersion === 'string' && /^\d+\.\d+\.\d+$/.test(data.audioApiVersion))) bad('audioApiVersion must be an exact version such as "0.13.6"');
  const listOf = (key) => {
    const list = data[key] ?? [];
    if (!Array.isArray(list)) bad(`${key} must be a list`);
    list.forEach((entry, index) => {
      for (const field of ['file', 'license', 'source']) {
        if (typeof entry?.[field] !== 'string' || entry[field].trim().length < 2) bad(`${key}[${index}].${field} is missing (every recorded audio file records its file, licence and source)`);
      }
      if (!AUDIO_FILE.test(entry.file) || entry.file.startsWith('/') || entry.file.includes('..')) bad(`${key}[${index}].file must be a repo-relative audio file`);
      if (key === 'otherAudio' && !OTHER_AUDIO_PURPOSES.has(entry.purpose)) bad(`otherAudio[${index}].purpose must be "notification" or "media"`);
    });
    return list;
  };
  return { rel, audioApiVersion: data.audioApiVersion ?? VERIFIED_AUDIO_API, bundledSounds: listOf('bundledSounds'), otherAudio: listOf('otherAudio'), exists: true };
}

/** Every path this checker reads, from the resolved layout. */
function pathsOf(layout) {
  const audio = `${layout.servicesDir}/audio`;
  const haptics = `${layout.servicesDir}/haptics`;
  const feedback = `${layout.servicesDir}/feedback`;
  return {
    audio,
    haptics,
    feedback,
    adapter: `${audio}/audio-api-audio-adapter.ts`,
    hapticsAdapter: `${haptics}/expo-haptics-adapter.ts`,
    mock: `${layout.mocksDir}/react-native-audio-api.ts`,
    uiFeedback: `${feedback}/ui-feedback.ts`,
    pressContext: `${layout.uiDir}/press-feedback-context.tsx`,
    lifecycle: `${audio}/use-audio-lifecycle.ts`,
    plugin: `${layout.configDir}/audio-plugin.ts`,
    rootLayout: `${layout.routesDir}/_layout.tsx`,
    games: `${layout.srcDir}/games`,
  };
}

function requiredFiles(layout, P, parts) {
  const withTest = (base) => [`${base}.ts`, `${base}.test.ts`];
  const audio = [
    `${P.audio}/audio-port.ts`, ...withTest(`${P.audio}/admit-voice`), ...withTest(`${P.audio}/audio-api-audio-adapter`),
    `${P.audio}/audio-api-audio-adapter.android.test.ts`, ...withTest(`${P.audio}/fake-audio`), ...withTest(`${P.audio}/use-audio-lifecycle`), ...withTest(`${P.audio}/compose-sound-bank`),
    ...withTest(`${P.audio}/synth/synthesize-recipe`), ...withTest(`${P.audio}/synth/recipe-problems`), `${P.audio}/synth/ui-sounds.ts`,
    ...withTest(`${layout.configDir}/audio-plugin`), P.mock, ...withTest(`${layout.srcDir}/hooks/use-is-app-active`),
  ];
  const haptics = [
    `${P.haptics}/haptics-port.ts`, ...withTest(`${P.haptics}/should-pulse`), ...withTest(`${P.haptics}/expo-haptics-adapter`),
    `${P.haptics}/expo-haptics-adapter.android.test.ts`, ...withTest(`${P.haptics}/fake-haptics`),
  ];
  const feedback = [...withTest(`${P.feedback}/play-cue`), ...withTest(`${P.feedback}/ui-feedback`)];
  return [...(parts.audio ? audio : []), ...(parts.haptics ? haptics : []), ...(parts.audio && parts.haptics ? feedback : [])];
}

/** The template path a required file is copied from (templates use the default layout). */
function templateOf(layout, rel) {
  for (const key of ['servicesDir', 'configDir', 'uiDir', 'mocksDir', 'srcDir']) {
    if (rel.startsWith(`${layout[key]}/`)) return `templates/${{ servicesDir: 'src/services', configDir: 'src/config', uiDir: 'src/ui', mocksDir: '__mocks__', srcDir: 'src' }[key]}/${rel.slice(layout[key].length + 1)}`;
  }
  return `templates/${rel}`;
}

function checkFiles(root, layout, P, parts, report) {
  for (const rel of requiredFiles(layout, P, parts)) {
    if (existsSync(join(root, rel))) continue;
    const owner = rel.includes('/hooks/use-is-app-active') ? ' (react-components-and-hooks owns this shared hook; the skill ships a synced copy)' : '';
    report.problem({ file: rel, line: 0, rule: 'audio-file-missing', message: 'required audio/haptics file is missing', fix: `Copy ${templateOf(layout, rel)} from the ${SKILL} skill (tests included)${owner}.` });
  }
}

/** Every manifest that may list the native modules, and whether it must (the app, or each Expo app workspace). */
function manifestsOf(root) {
  const workspaces = readWorkspaces(root);
  const rootPkg = JSON.parse(readRel(root, 'package.json') ?? '{}');
  const list = [{ rel: 'package.json', mustList: workspaces.length === 0 || Boolean(rootPkg.dependencies?.expo) }];
  for (const ws of workspaces) list.push({ rel: `${ws.dir}/package.json`, mustList: Boolean(ws.manifest?.dependencies?.expo) });
  return list.filter((entry) => existsSync(join(root, entry.rel)));
}

function checkPackages(root, contract, parts, report, manifests = manifestsOf(root)) {
  const expected = contract.audioApiVersion;
  for (const { rel, mustList } of manifests) {
    const text = readRel(root, rel);
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      report.problem({ file: rel, line: 1, rule: 'audio-pin', message: 'package.json is not valid JSON', fix: 'Fix the JSON.' });
      continue;
    }
    const lineOfKey = (key) => lineOf(text, Math.max(0, text.indexOf(`"${key}"`)));
    const listed = { ...pkg.peerDependencies, ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, instead] of Object.entries(SECOND_LIBRARIES)) {
      if (listed[name] !== undefined) report.problem({ file: rel, line: lineOfKey(name), rule: 'second-feedback-library', message: `${name} is installed next to the feedback ports`, fix: `Remove it: ${instead} is the one engine; two libraries fight over the session and the tests.` });
    }
    // A shared package lists the native module as peerDependencies "*"; the app pins it.
    const peers = Object.fromEntries(Object.entries(pkg.peerDependencies ?? {}).filter(([, range]) => range !== '*'));
    const deps = { ...peers, ...pkg.dependencies, ...pkg.devDependencies };
    const audio = deps['react-native-audio-api'];
    if (parts.audio && audio !== undefined && audio !== expected) {
      const exact = /^\d+\.\d+\.\d+$/.test(audio);
      report.problem({
        file: rel, line: lineOfKey('react-native-audio-api'), rule: 'audio-pin',
        message: exact ? `react-native-audio-api is ${audio}, but the verified version is ${expected}` : `react-native-audio-api is "${audio}", not an exact pin of ${expected}`,
        fix: exact ? `Go through "Before any bump" (references/audio-engine.md), then record the version as audioApiVersion in ${contract.rel}.` : `npm install --save-exact react-native-audio-api@${expected} (pre-1.0: minors break APIs).`,
      });
    }
    if (parts.audio && mustList && audio === undefined) {
      report.problem({ file: rel, line: 1, rule: 'audio-pin', message: 'the app does not list react-native-audio-api', fix: `npm install --save-exact react-native-audio-api@${expected} in the app (native modules autolink per app).` });
    }
    const haptics = deps['expo-haptics'];
    if (!parts.haptics || !mustList) continue;
    const expoMajor = /(\d+)\./.exec(pkg.dependencies?.expo ?? '')?.[1];
    const match = /^~(\d+)\.\d+\.\d+$/.exec(haptics ?? '');
    if (haptics === undefined) report.problem({ file: rel, line: 1, rule: 'haptics-dependency', message: 'the app does not list expo-haptics', fix: 'Run npx expo install expo-haptics in the app.' });
    else if (match === null || (expoMajor !== undefined && match[1] !== expoMajor)) report.problem({ file: rel, line: lineOfKey('expo-haptics'), rule: 'haptics-dependency', message: `expo-haptics is "${haptics}", not the tilde range of the app's Expo SDK${expoMajor ? ` (~${expoMajor}.x.y)` : ''}`, fix: 'Run npx expo install expo-haptics (it writes the SDK\'s ~ range; keep it).' });
  }
}

function checkImports(ctx, report) {
  const { files, P, contract } = ctx;
  let contexts = 0;
  for (const { rel, source, isTest } of files) {
    const inLayer = [P.audio, P.haptics, P.feedback].some((dir) => rel.startsWith(`${dir}/`));
    if (rel !== P.adapter && rel !== P.mock) {
      for (const index of valueImportsOf(source, 'react-native-audio-api(?:/[^\'"]*)?')) report.problem({ file: rel, line: lineOf(source, index), rule: 'vendor-import', message: 'imports react-native-audio-api outside the audio adapter', fix: 'Use AudioPort (useServices().audio); tests use createFakeAudio(), or jest.mock + jest.requireMock in the adapter test.' });
    }
    if (rel !== P.hapticsAdapter) {
      for (const index of valueImportsOf(source, 'expo-haptics')) report.problem({ file: rel, line: lineOf(source, index), rule: 'vendor-import', message: 'imports expo-haptics outside the haptics adapter', fix: 'Use HapticsPort (useServices().haptics); tests use createFakeHaptics(), or jest.mock + jest.requireMock in the adapter test.' });
    }
    for (const { index, isAllowed, strict } of vibrationImports(ctx, rel, source)) {
      if (isAllowed) continue;
      report.problem({ file: rel, line: lineOf(source, index), rule: 'vendor-import', message: strict ? 'the feedback layer or a view imports Vibration from react-native' : 'imports Vibration from react-native without a reason', fix: strict ? 'Pulse only through HapticsPort cues (selection, light, medium, heavy, success, warning, error).' : 'Feedback pulses go through HapticsPort cues; a long pattern that is not feedback (an alarm, a timer) says why on the import line or above: // vibration-exempt: <reason>.' });
    }
    for (const name of Object.keys(SECOND_LIBRARIES)) {
      for (const index of valueImportsOf(source, name)) report.problem({ file: rel, line: lineOf(source, index), rule: 'vendor-import', message: `imports ${name}`, fix: `Use ${SECOND_LIBRARIES[name]}.` });
    }
    if (inLayer) {
      for (const name of MEDIA_PLAYERS) {
        for (const index of valueImportsOf(source, `${name}(?:/[^'"]*)?`)) report.problem({ file: rel, line: lineOf(source, index), rule: 'vendor-import', message: `the feedback layer imports the media player ${name}`, fix: 'Feedback sounds go through react-native-audio-api only; media playback (podcasts, video) is a separate feature with its own session.' });
      }
    }
    for (const match of source.matchAll(/\bnew\s+AudioContext\s*\(/g)) {
      contexts += 1;
      if (rel !== P.adapter) report.problem({ file: rel, line: lineOf(source, match.index), rule: 'audio-context', message: 'creates an AudioContext outside the adapter', fix: 'The app has exactly one AudioContext, inside audio-api-audio-adapter.ts.' });
    }
    if (rel !== P.mock && !rel.startsWith(`${ctx.layout.mocksDir}/`)) {
      for (const match of source.matchAll(/\bactivelyReclaimSession\b/g)) report.problem({ file: rel, line: lineOf(source, match.index), rule: 'music-default', message: 'uses activelyReclaimSession', fix: 'Never: it stops the engine when other audio plays. Music stays off by default instead.' });
    }
    if (isTest) continue;
    if (inLayer || AUDIO_API_IMPORT.test(source)) checkFileAudio(rel, source, P, contract, report);
    checkFocus(rel, source, report);
  }
  return contexts;
}

/**
 * Vibration imports of a file. Never allowed in the feedback layer or a view (`strict`); elsewhere
 * allowed with a vibration-exempt reason on the import line or the line above.
 */
function vibrationImports(ctx, rel, source) {
  const file = ctx.files.find((entry) => entry.rel === rel);
  const lines = (file?.raw ?? source).split('\n');
  const { P, layout } = ctx;
  const strict = [P.audio, P.haptics, P.feedback].some((dir) => rel.startsWith(`${dir}/`)) || isViewFile(layout, rel);
  return [...source.matchAll(VIBRATION_IMPORT)].map((match) => {
    const line = lineOf(source, match.index);
    const exempt = VIBRATION_EXEMPT.test(lines[line - 1] ?? '') || VIBRATION_EXEMPT.test(lines[line - 2] ?? '');
    return { index: match.index, strict, isAllowed: exempt && !strict };
  });
}

/** A presentational file: src/ui, or a feature's screen or components. */
function isViewFile(layout, rel) {
  return rel.startsWith(`${layout.uiDir}/`) || (rel.startsWith(`${layout.featuresDir}/`) && (/\/components\//.test(rel) || /-screen\.tsx$/.test(rel)));
}

/** Feedback-layer code and files that import the audio engine: no streams, no URLs, no stray decoding. */
function checkFileAudio(rel, source, P, contract, report) {
  for (const match of source.matchAll(/\b(decodeAudioData|decodePCMInBase64|createStreamer)\b/g)) {
    const allowed = match[1] !== 'createStreamer' && rel === P.adapter && contract.bundledSounds.length > 0;
    if (allowed) continue;
    const why = match[1] === 'createStreamer' ? 'streams audio (network or file stream)' : rel === P.adapter ? 'decodes audio files, but the contract lists no bundled sounds' : 'decodes audio outside the audio adapter';
    report.problem({ file: rel, line: lineOf(source, match.index), rule: 'file-audio', message: `uses ${match[1]}: ${why}`, fix: 'Sounds are synthesized SoundRecipes; recorded sounds are bundled assets listed in contracts/audio-feedback.json and decoded only by the adapter.' });
  }
  for (const match of source.matchAll(/['"`]https?:\/\/[^'"`\s]+\.(mp3|wav|m4a|aac|caf|ogg|oga|flac|aif|aiff|opus)\b/gi)) {
    report.problem({ file: rel, line: lineOf(source, match.index), rule: 'file-audio', message: 'names a network audio file', fix: 'Feedback sounds never come from the network: synthesize a recipe or bundle the file as a listed asset.' });
  }
}

function checkFocus(rel, source, report) {
  const lines = source.split('\n');
  for (const match of source.matchAll(/\bobserveAudioInterruptions\s*\(/g)) {
    const line = lineOf(source, match.index);
    const args = callArguments(source, match.index + match[0].length).trim();
    const guard = /Platform\s*\.\s*OS\s*===\s*['"]ios['"]|Platform\s*\.\s*OS\s*!==\s*['"]android['"]/;
    if (/^['"`]/.test(args)) report.problem({ file: rel, line, rule: 'audio-focus', message: `observeAudioInterruptions(${args}) requests Android audio focus`, fix: 'Feedback never takes audio focus: call observeAudioInterruptions(true) on iOS only.' });
    else if (args !== 'false' && !guard.test(lines[line - 1] ?? '') && !guard.test(lines[line - 2] ?? '')) report.problem({ file: rel, line, rule: 'audio-focus', message: 'observeAudioInterruptions runs on Android, where it requests AUDIOFOCUS_GAIN and mutes the user\'s music', fix: "Guard it: if (Platform.OS === 'ios') AudioManager.observeAudioInterruptions(true);" });
  }
}

function checkAdapter(root, P, contexts, report) {
  const raw = readRel(root, P.adapter);
  if (raw === null) return;
  const source = maskComments(raw);
  const ctxIndex = source.search(/\bnew\s+AudioContext\s*\(/);
  const sessionIndex = source.search(/\bsetAudioSessionOptions\s*\(/);
  const ctxLine = ctxIndex === -1 ? 1 : lineOf(source, ctxIndex);
  if (contexts !== 1 || ctxIndex === -1) report.problem({ file: P.adapter, line: ctxLine, rule: 'audio-context', message: `found ${contexts} \`new AudioContext(\` in the app, expected exactly 1 (in the adapter)`, fix: 'Create the one context in createGraph() of the adapter and nowhere else.' });
  if (sessionIndex === -1 || (ctxIndex !== -1 && sessionIndex > ctxIndex) || !/iosCategory\s*:\s*['"]ambient['"]/.test(source)) {
    report.problem({ file: P.adapter, line: ctxLine, rule: 'audio-context', message: "the ambient session (setAudioSessionOptions({ iosCategory: 'ambient', ... })) is not set before the context is created", fix: "Call AudioManager.setAudioSessionOptions({ iosCategory: 'ambient', iosMode: 'default', iosOptions: [] }) first: ambient respects the silent switch and mixes with the user's music." });
  }
  if (!(/\bRAMP_S\s*=\s*0\.05\b/.test(source) && /linearRampToValueAtTime/.test(source))) report.problem({ file: P.adapter, line: 1, rule: 'voice-policy', message: 'gain changes do not ramp over 50 ms (RAMP_S = 0.05 with linearRampToValueAtTime)', fix: 'Keep rampTo(): an instant gain jump clicks.' });
}

function expectPattern(root, rel, pattern, problem, report) {
  const raw = readRel(root, rel);
  if (raw !== null && !pattern.test(maskComments(raw))) report.problem({ file: rel, line: 1, ...problem });
}

function checkPolicies(root, P, parts, report) {
  if (parts.audio) {
    expectPattern(root, `${P.audio}/audio-port.ts`, /\bmusic\s*:\s*\{\s*isOn\s*:\s*false\b/, { rule: 'music-default', message: 'DEFAULT_AUDIO_SETTINGS does not keep music off', fix: "Set music: { isOn: false, volume: 0.6 }: the app never plays over the user's own music unless they turn it on." }, report);
    const admit = `${P.audio}/admit-voice.ts`;
    expectPattern(root, admit, /\bMAX_VOICES\s*=\s*8\b/, { rule: 'voice-policy', message: 'MAX_VOICES is not 8', fix: 'Keep at most 8 overlapping voices so bursts never pile up.' }, report);
    expectPattern(root, admit, /\bDEFAULT_MIN_INTERVAL_MS\s*=\s*30\b/, { rule: 'voice-policy', message: 'DEFAULT_MIN_INTERVAL_MS is not 30', fix: 'The same sound restarts at most once per 30 ms (or its minIntervalMs).' }, report);
    expectPattern(root, admit, /setting\.volume\s*\*\s*setting\.volume/, { rule: 'voice-policy', message: 'channelGain does not square the slider', fix: 'Return setting.isOn ? setting.volume * setting.volume : 0 (a squared slider sounds even).' }, report);
    const mock = readRel(root, P.mock);
    if (mock !== null && !(/\bsetAudioSessionOptions\b/.test(maskComments(mock)) && /\bobserveAudioInterruptions\b/.test(maskComments(mock)))) report.problem({ file: P.mock, line: 1, rule: 'audio-mock', message: 'the root mock does not add AudioManager.setAudioSessionOptions and observeAudioInterruptions', fix: `Copy templates/__mocks__/react-native-audio-api.ts: the library mock (${VERIFIED_AUDIO_API}) lacks both, so the adapter test fails with "is not a function".` });
  }
  if (parts.haptics) expectPattern(root, `${P.haptics}/should-pulse.ts`, /\bMIN_HAPTIC_GAP_MS\s*=\s*40\b/, { rule: 'haptic-throttle', message: 'MIN_HAPTIC_GAP_MS is not 40', fix: 'Keep 40 ms: closer pulses feel like a mushy buzz.' }, report);
}

/** `const NAME = { cue: AndroidHaptics.X, ... }` → { cue: { value, line } }, or null when absent. */
function androidTable(source, name) {
  const start = findConstInitializer(source, name);
  if (start === -1) return null;
  const end = source.indexOf('}', start);
  const table = {};
  for (const match of source.slice(start, end).matchAll(/(\w+)\s*:\s*AndroidHaptics\.(\w+)/g)) table[match[1]] = { value: match[2], line: lineOf(source, start + match.index) };
  return table;
}

function checkHaptics(root, P, report) {
  const raw = readRel(root, P.hapticsAdapter);
  if (raw === null) return;
  const source = maskComments(raw);
  const rel = P.hapticsAdapter;
  const found = {};
  for (const match of source.matchAll(/case\s+['"](\w+)['"]\s*:\s*return\s+([^;]+);/g)) found[match[1]] = { call: match[2].replace(/\s+/g, ''), line: lineOf(source, match.index) };
  for (const cue of CUES) {
    const got = found[cue];
    if (got === undefined) report.problem({ file: rel, line: 1, rule: 'haptic-table', message: `cue '${cue}' has no iOS call`, fix: `case '${cue}': return ${IOS_TABLE[cue]};` });
    else if (got.call !== IOS_TABLE[cue]) report.problem({ file: rel, line: got.line, rule: 'haptic-table', message: `cue '${cue}' calls ${got.call}, expected ${IOS_TABLE[cue]}`, fix: 'Follow the cue table (references/haptics.md).' });
  }
  checkAndroidHaptics(rel, source, report);
  const safety = [
    [/\bshouldPulse\s*\(/, 'does not gate pulses through shouldPulse (the preference and the 40 ms throttle)'],
    [/\bisPad\b/, 'does not report isSupported = false on iPad'],
    [/\.catch\(\s*\(\)\s*=>\s*undefined\s*\)/, 'does not end the native call with .catch(() => undefined)'],
  ];
  for (const [pattern, message] of safety) {
    if (!pattern.test(source)) report.problem({ file: rel, line: 1, rule: 'haptic-safety', message, fix: 'Copy templates/src/services/haptics/expo-haptics-adapter.ts.' });
  }
}

function checkAndroidHaptics(rel, source, report) {
  const primary = androidTable(source, 'ANDROID_CUES');
  const legacy = androidTable(source, 'ANDROID_LEGACY_CUES');
  const problem = (line, message, fix) => report.problem({ file: rel, line, rule: 'haptic-android', message, fix });
  if (primary === null) return problem(1, 'no ANDROID_CUES table', 'Map every cue to an AndroidHaptics constant and play it with performAndroidHapticsAsync (no VIBRATE use; follows the system touch-feedback setting).');
  if (!/\bperformAndroidHapticsAsync\s*\(/.test(source)) problem(1, 'Android cues are not played with performAndroidHapticsAsync', 'Route Android through performAndroidHapticsAsync(androidHapticFor(cue, apiLevel)); impactAsync uses the Vibrator, which Expo advises against.');
  for (const cue of CUES) if (primary[cue] === undefined) problem(1, `cue '${cue}' has no Android constant in ANDROID_CUES`, `Add ${cue}: AndroidHaptics.<Constant> (references/haptics.md).`);
  const newer = CUES.filter((cue) => primary[cue] !== undefined && !ANDROID_ALL_LEVELS.has(primary[cue].value));
  if (newer.length === 0) return undefined;
  if (legacy === null || !/\bPlatform\s*\.\s*Version\b|\bapiLevel\b/.test(source)) return problem(primary[newer[0]].line, `ANDROID_CUES uses ${newer.map((cue) => primary[cue].value).join(', ')}, newer than minSdk 24, without a legacy table chosen by the API level`, 'Add ANDROID_LEGACY_CUES with constants every level has (Clock_Tick, Context_Click, Keyboard_Tap, Long_Press, Virtual_Key) and pick it below ANDROID_CUES_API from Platform.Version: expo-haptics rejects a newer constant.');
  for (const cue of CUES) {
    const entry = legacy[cue];
    if (entry === undefined) problem(1, `cue '${cue}' has no constant in ANDROID_LEGACY_CUES`, 'Give every cue a legacy constant.');
    else if (!ANDROID_ALL_LEVELS.has(entry.value)) problem(entry.line, `ANDROID_LEGACY_CUES maps '${cue}' to ${entry.value}, which older Android levels lack`, 'Use one of Clock_Tick, Context_Click, Keyboard_Tap, Long_Press, Virtual_Key.');
  }
  const mid = androidTable(source, 'ANDROID_API_30_CUES');
  for (const cue of mid === null ? [] : CUES) {
    const entry = mid[cue];
    if (entry === undefined) problem(1, `cue '${cue}' has no constant in ANDROID_API_30_CUES`, 'Give every cue a constant in the API 30 table.');
    else if (!ANDROID_API_30_LEVELS.has(entry.value)) problem(entry.line, `ANDROID_API_30_CUES maps '${cue}' to ${entry.value}, which API 30 to 33 lack`, 'Use a constant API 30 has: Confirm, Reject, Gesture_Start, Gesture_End, or one every level has (Clock_Tick, Context_Click, Keyboard_Tap, Long_Press, Virtual_Key).');
  }
  return undefined;
}

function configFiles(root, layout) {
  const files = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json'].filter((rel) => existsSync(join(root, rel)));
  const configDir = join(root, layout.configDir);
  const extra = existsSync(configDir) ? walkRepo(configDir, { include: ['*.ts'] }).filter((rel) => !TEST_FILE.test(rel)).map((rel) => `${layout.configDir}/${rel}`) : [];
  return [...files, ...extra];
}

function checkConfig(root, layout, P, parts, report) {
  const files = configFiles(root, layout);
  let defining = null;
  let hasEntry = false;
  for (const rel of files) {
    const source = maskComments(readRel(root, rel));
    for (const match of source.matchAll(/['"]react-native-audio-api['"]/g)) {
      const before = source.slice(0, match.index).trimEnd();
      if (/\bfrom\s*$|\brequire\(\s*$|import\(\s*$/.test(before)) continue;
      hasEntry = true;
      const line = lineOf(source, match.index);
      if (!before.endsWith('[')) {
        report.problem({ file: rel, line, rule: 'audio-plugin', message: 'the react-native-audio-api plugin is listed without options, so every default applies', fix: 'List AUDIO_API_PLUGIN from src/config/audio-plugin.ts (no background audio, no Android permissions, no downloads).' });
        continue;
      }
      const entry = source.slice(before.length - 1, matchingBracket(source, before.length - 1) + 1);
      for (const [name, pattern] of PLUGIN_OPTIONS) {
        if (!pattern.test(entry)) report.problem({ file: rel, line, rule: 'audio-plugin', message: `the react-native-audio-api plugin does not set ${name} to its safe value`, fix: 'Use AUDIO_API_PLUGIN from templates/src/config/audio-plugin.ts.' });
      }
      if (/\bexport\s+const\s+AUDIO_API_PLUGIN\b/.test(source)) defining = rel;
    }
    checkMicString(rel, readRel(root, rel), report);
  }
  if (!parts.audio) return;
  if (!hasEntry) {
    report.problem({ file: existsSync(join(root, P.plugin)) ? P.plugin : 'app.config.ts', line: 0, rule: 'audio-plugin', message: 'no react-native-audio-api config plugin entry in the app config', fix: 'Copy templates/src/config/audio-plugin.ts and add AUDIO_API_PLUGIN to the plugins of app.config.ts: without it every default applies (background audio, Android foreground-service permissions, build-time downloads).' });
    return;
  }
  if (defining !== null) {
    const used = files.some((rel) => rel !== defining && /\bAUDIO_API_PLUGIN\b/.test(maskComments(readRel(root, rel))));
    const source = maskComments(readRel(root, defining));
    if (!used) report.problem({ file: defining, line: lineOf(source, source.search(/\bexport\s+const\s+AUDIO_API_PLUGIN\b/)), rule: 'audio-plugin', message: 'AUDIO_API_PLUGIN is defined but app.config does not use it', fix: "Import it in app.config.ts (import { AUDIO_API_PLUGIN } from './src/config/audio-plugin.ts';) and list it in plugins." });
  }
}

function checkMicString(rel, raw, report) {
  const lines = raw.split('\n');
  maskComments(raw).split('\n').forEach((code, index) => {
    if (!/\biosMicrophonePermission\b/.test(code)) return;
    if (/ITMS-90683/.test(lines[index] ?? '') || /ITMS-90683/.test(lines[index - 1] ?? '')) return;
    report.problem({ file: rel, line: index + 1, rule: 'mic-string', message: 'the audio plugin adds a microphone purpose string up front', fix: 'Remove it: feedback never records. Only if an App Store upload reports ITMS-90683, set iosMicrophonePermission with a comment naming ITMS-90683 (localise it).' });
  });
}

function checkAssets(root, layout, contract, parts, report, repo = { root, report }) {
  const listed = new Set([...contract.bundledSounds, ...contract.otherAudio].map((entry) => entry.file));
  for (const rel of walkRepo(root, { ignore: ['reports/**', `${layout.testDir}/**`, 'coverage/**'] })) {
    if (AUDIO_FILE.test(rel) && !listed.has(rel)) report.problem({ file: rel, line: 0, rule: 'file-audio', message: 'ships a recorded audio file the contract does not list', fix: `List it in ${contract.rel} with its licence and source: otherAudio (purpose "notification" or "media") for a notification sound or a feature's media, bundledSounds for a feedback sound the adapter decodes. For feedback, a synthesized SoundRecipe needs no file at all.` });
  }
  for (const entry of contract.bundledSounds) {
    if (!BUNDLED_DECODABLE.test(entry.file)) report.problem({ file: contract.rel, line: 0, rule: 'file-audio', message: `bundled sound ${entry.file} is in a format the adapter cannot decode`, fix: 'Convert it to WAV (PCM), MP3 or FLAC, 48 kHz mono. With disableFFmpeg and disableStaticExternalLibs (the audio-plugin rule) react-native-audio-api 0.13.6 decodes only what miniaudio reads: CAF, M4A/AAC and OGG/Opus would stay silent and only log a decode error.' });
  }
  for (const entry of [...contract.bundledSounds, ...contract.otherAudio]) {
    if (!existsSync(join(root, entry.file))) report.problem({ file: contract.rel, line: 0, rule: 'file-audio', message: `listed audio file ${entry.file} does not exist`, fix: 'Add the file or remove the entry.' });
  }
  if (!parts.audio) return;
  // In a workspace repo the repo root's .gitignore counts too: git applies it to the app folder.
  const ignores = [readRel(root, '.gitignore'), repo.root === root ? null : readRel(repo.root, '.gitignore')];
  if (!ignores.some((ignore) => ignore !== null && /^\/?reports(\/(\*\*\/?|sfx\/?)?)?\s*$/m.test(ignore))) repo.report.problem({ file: '.gitignore', line: 0, rule: 'preview-ignored', message: 'the root .gitignore does not ignore reports/ (the WAV previews)', fix: 'Add the line reports/ to the root .gitignore.' });
}

function checkCallSites(ctx, report) {
  const { files, P, layout, parts } = ctx;
  const seams = [];
  let mounts = 0;
  for (const { rel, raw, source, isTest } of files) {
    if (isTest || !rel.startsWith(`${layout.srcDir}/`)) continue;
    const isSim = new RegExp(`^${P.games}/[^/]+/sim/`).test(rel) || WORKLET_DIRECTIVE.test(raw);
    if (isSim) {
      for (const match of source.matchAll(/\b(?:(haptics|audio)\s*\.\s*(play|startMusic)|(playCue|playUiFeedback))\s*\(/g)) report.problem({ file: rel, line: lineOf(source, match.index), rule: 'cue-in-sim', message: `calls ${match[3] ?? `${match[1]}.${match[2]}`} inside a sim or 'worklet' module`, fix: 'Emit an event; the host drains events once per frame on JS and plays sounds and haptics from them (never per tick).' });
    }
    if (isViewFile(layout, rel)) {
      for (const match of source.matchAll(/\bhaptics\s*\??\.\s*play\s*\(\s*['"](\w+)['"]/g)) {
        if (match[1] !== 'selection') report.problem({ file: rel, line: lineOf(source, match.index), rule: 'button-haptics', message: `a view fires the '${match[1]}' haptic`, fix: "Buttons use no haptics; switches and pickers use 'selection'. Event feedback comes from the model's cue table." });
      }
      if (rel !== P.pressContext) {
        for (const match of source.matchAll(/\b(?:audio\s*\??\.\s*(play|startMusic)|(playCue|playUiFeedback))\s*\(/g)) report.problem({ file: rel, line: lineOf(source, match.index), rule: 'view-feedback', message: `a view plays feedback itself (${match[2] ?? `audio.${match[1]}`})`, fix: "Play it from the feature's model hook (playCue with the cue table, playUiFeedback for a UI moment) or a canvas track cue; a view's press only runs usePressFeedback through the press surface." });
      }
    }
    if (rel !== P.lifecycle) mounts += [...source.matchAll(/\buseAudioLifecycle\s*\(/g)].length;
    if (parts.audio) seams.push(...checkReload(rel, raw, source, report));
  }
  if (parts.audio && mounts !== 1) report.problem({ file: P.rootLayout, line: 0, rule: 'lifecycle-mount', message: `useAudioLifecycle is called ${mounts} times, expected once`, fix: 'Call useAudioLifecycle({ audio, isInterrupted, reportError }) once, in the root layout.' });
  checkReloadSeams(ctx, seams, report);
}

/** The name of the function a call sits in (a function declaration or a const arrow), or null. */
function enclosingFunctionName(source, index) {
  let name = null;
  for (const match of source.slice(0, index).matchAll(/\bfunction\s+([\w$]+)|\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/g)) name = match[1] ?? match[2];
  return name;
}

/**
 * A reload behind the seam (`await beforeReload()` first) is fine when some caller of that function
 * passes the audio dispose: rtl-and-direction's restartForDirection cannot reach the services itself.
 */
function checkReloadSeams(ctx, seams, report) {
  const srcFiles = ctx.files.filter((file) => !file.isTest && file.rel.startsWith(`${ctx.layout.srcDir}/`));
  const callers = srcFiles.filter((file) => DISPOSE_REF.test(file.source));
  /** A call of the function or a JSX use of the component, not its declaration. */
  const usesName = (file, name) => {
    const escaped = name.replace(/\$/g, '\\$');
    return new RegExp(`(?<!function\\s+)\\b${escaped}\\s*\\(|<${escaped}\\b`).test(file.source);
  };
  /**
   * Is some caller passing the dispose to `name`? A caller that only forwards its own beforeReload
   * (rtl-and-direction's DirectionRestart, then DirectionGate) hands the question to its own callers.
   */
  const isDisposed = (name, hook, seen) => {
    if (seen.has(name)) return false;
    seen.add(name);
    if (callers.some((file) => usesName(file, name))) return true;
    const forwarders = srcFiles.filter((file) => usesName(file, name) && new RegExp(`\\b${hook}\\b`).test(file.source));
    return forwarders.some((file) => [...file.source.matchAll(/\bexport\s+(?:async\s+)?function\s+([\w$]+)|\bexport\s+const\s+([\w$]+)/g)].some((m) => isDisposed(m[1] ?? m[2], hook, seen)));
  };
  for (const seam of seams) {
    if (seam.fn === null) {
      if (callers.some((file) => file.rel !== seam.rel && /\b(?:beforeReload|onBeforeReload)\b/.test(file.source))) continue;
    } else if (isDisposed(seam.fn, seam.hook, new Set())) continue;
    report.problem({ file: seam.rel, line: seam.line, rule: 'dispose-before-reload', message: `${seam.fn ?? 'this function'} awaits ${seam.hook}() before reloading, but no caller passes the audio dispose`, fix: `Pass () => services.audio.dispose() as ${seam.hook} where ${seam.fn ?? 'it'} is called (the model that has the services), so the native engine closes before the bundle reloads.` });
  }
}

/** Reports reloads without a dispose; returns the reloads that await the injected seam instead. */
function checkReload(rel, raw, source, report) {
  if (/function\s+(reloadAppAsync|reloadAsync)\b/.test(source)) return [];
  const lines = raw.split('\n');
  const seams = [];
  for (const match of source.matchAll(RELOAD_CALL)) {
    const line = lineOf(source, match.index);
    if (EXEMPT_MARKER.test(lines[line - 1] ?? '') || EXEMPT_MARKER.test(lines[line - 2] ?? '')) continue;
    const dispose = source.search(DISPOSE_CALL);
    if (dispose !== -1 && dispose < match.index) continue;
    const hook = [...source.slice(0, match.index).matchAll(BEFORE_RELOAD_CALL)].at(-1);
    if (hook !== undefined) {
      seams.push({ rel, line, fn: enclosingFunctionName(source, match.index), hook: /onBeforeReload/.test(hook[0]) ? 'onBeforeReload' : 'beforeReload' });
      continue;
    }
    report.problem({ file: rel, line, rule: 'dispose-before-reload', message: 'reloads the JS bundle without awaiting audio.dispose() first', fix: 'await services.audio.dispose() before the reload, so the native engine closes first; a function that cannot reach the services takes a beforeReload hook, awaits it before the reload, and its caller passes () => services.audio.dispose(); code outside every provider says why with "// audio-dispose-exempt: <reason>".' });
  }
  return seams;
}

/** UI_FEEDBACK's top-level keys from the app's ui-feedback.ts, or null when it cannot be read. */
function uiFeedbackKinds(source) {
  const start = findConstInitializer(source, 'UI_FEEDBACK');
  if (start === -1) return null;
  try {
    return parseObjectEntries(source, start).map((entry) => entry.key);
  } catch (error) {
    if (error instanceof LiteralError) return null;
    throw error;
  }
}

function checkUiFeedback(ctx, report) {
  const { root, files, P, layout } = ctx;
  const raw = readRel(root, P.uiFeedback);
  if (raw === null) return;
  const kinds = uiFeedbackKinds(maskComments(raw));
  if (kinds === null) {
    report.problem({ file: P.uiFeedback, line: 1, rule: 'ui-feedback', message: 'no literal `const UI_FEEDBACK = { ... }` table', fix: 'Keep UI_FEEDBACK as one object literal of { sound, haptic } rows (templates/src/services/feedback/ui-feedback.ts).' });
    return;
  }
  const played = new Set();
  const pressSurfaces = [];
  const providers = [];
  for (const { rel, source, isTest } of files) {
    if (isTest || rel === P.uiFeedback) continue;
    for (const match of source.matchAll(/\bplayUiFeedback\s*\(/g)) {
      for (const kind of callArguments(source, match.index + match[0].length).matchAll(/['"]([\w-]+)['"]/g)) played.add(kind[1]);
    }
    const isFeedbackLayer = [P.audio, P.feedback].some((dir) => rel.startsWith(`${dir}/`));
    if (!isFeedbackLayer && rel.startsWith(`${layout.srcDir}/`)) {
      for (const match of source.matchAll(/\baudio\s*\??\.\s*play\s*\(\s*['"`](ui\.[\w.-]+)['"`]/g)) report.problem({ file: rel, line: lineOf(source, match.index), rule: 'ui-feedback', message: `plays the UI sound '${match[1]}' by hand`, fix: 'Call playUiFeedback(services, \'<kind>\') instead: the UI_FEEDBACK row plays the sound and its pulse together, and the checker sees the moment as played.' });
    }
    const press = source.search(/\busePressFeedback\s*\(/);
    if (press !== -1 && rel !== P.pressContext && rel.startsWith(`${layout.uiDir}/`)) pressSurfaces.push({ rel, source, line: lineOf(source, press) });
    if (rel !== P.pressContext && rel.startsWith(`${layout.srcDir}/`)) {
      for (const match of source.matchAll(/<PressFeedbackProvider\b/g)) providers.push({ rel, line: lineOf(source, match.index), tag: openingTag(source, match.index + match[0].length) });
    }
  }
  for (const kind of kinds) {
    if (!played.has(kind)) report.problem({ file: P.uiFeedback, line: 0, rule: 'ui-feedback', message: `the app never plays its '${kind}' moment`, fix: `Call playUiFeedback(services, '${kind}') where it happens (a switch handler, a save that succeeded or failed; the root PressFeedbackProvider for tap).` });
  }
  if (!kinds.includes('tap')) return;
  if (!existsSync(join(root, P.pressContext))) report.problem({ file: P.pressContext, line: 0, rule: 'ui-feedback', message: 'UI_FEEDBACK has a tap moment but the press-feedback context is missing', fix: 'Copy templates/src/ui/press-feedback-context.tsx (design-system-structure owns it).' });
  if (pressSurfaces.length === 0) report.problem({ file: P.pressContext, line: 0, rule: 'ui-feedback', message: 'UI_FEEDBACK has a tap moment but no press surface in src/ui runs usePressFeedback(), so presses are silent', fix: 'Call const onPressFeedback = usePressFeedback(); in the press surface and run it in onPress (a switch plays its toggle moment instead).' });
  for (const surface of pressSurfaces) {
    if (!/\bandroid_disableSound\b/.test(surface.source)) report.problem({ file: surface.rel, line: surface.line, rule: 'android-touch-sound', message: 'the press surface plays the app\'s tap sound but leaves Android\'s system click on', fix: 'Pass android_disableSound={usePressFeedbackPlaysSound()} to the Pressable (the canonical PressableSurface does): with touch sounds enabled, Android would play its click and the tap sound together.' });
  }
  // The canonical surface sets android_disableSound from the provider's playsSound, so a provider that
  // plays 'tap' without it leaves the system click on even though the surface names the prop.
  const fixProvider = "Render <PressFeedbackProvider playsSound onPress={() => { playUiFeedback(services, 'tap'); }}>: playsSound makes the press surfaces pass android_disableSound.";
  const tapProviders = providers.filter((provider) => /\bplayUiFeedback\s*\([^)]*['"]tap['"]/.test(provider.tag));
  for (const provider of tapProviders) {
    if (!hasTrueAttribute(provider.tag, 'playsSound')) report.problem({ file: provider.rel, line: provider.line, rule: 'android-touch-sound', message: "the PressFeedbackProvider plays 'tap' without playsSound, so Android plays its system click with the tap sound", fix: fixProvider });
  }
  // A provider whose onPress is a named function: the surface reading the provider still needs playsSound somewhere.
  if (tapProviders.length > 0 || providers.length === 0 || providers.some((provider) => hasTrueAttribute(provider.tag, 'playsSound'))) return;
  for (const surface of pressSurfaces.filter((entry) => /\busePressFeedbackPlaysSound\s*\(/.test(entry.source))) {
    report.problem({ file: surface.rel, line: surface.line, rule: 'android-touch-sound', message: "android_disableSound follows usePressFeedbackPlaysSound(), but no PressFeedbackProvider passes playsSound, so Android's system click plays with the tap sound", fix: fixProvider });
  }
}

/** The text of a JSX opening tag from just after its name to its closing `>` (braces skipped). */
function openingTag(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/** Whether a JSX opening tag sets a boolean attribute to true (`name`, `name={true}`). */
function hasTrueAttribute(tag, name) {
  let masked = tag;
  for (let previous = ''; previous !== masked; ) {
    previous = masked;
    masked = masked.replace(/\{[^{}]*\}/g, (block) => (/^\{\s*true\s*\}$/.test(block) ? '{true}' : '(…)'));
  }
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*\\{true\\})?(?=\\s|/|$)`).test(masked);
}

/** Which parts of the checker apply, from repo facts. */
function partsOf(root, layout, P, files) {
  const nonTest = files.filter((file) => !file.isTest && file.rel.startsWith(`${layout.srcDir}/`));
  const imports = (pattern) => nonTest.some((file) => valueImportsOf(file.source, pattern).length > 0);
  const configMentions = configFiles(root, layout).some((rel) => /['"]react-native-audio-api['"]/.test(maskComments(readRel(root, rel))));
  return {
    audio: existsSync(join(root, P.audio)) || imports("react-native-audio-api(?:/[^'\"]*)?") || imports('react-native-sound') || configMentions,
    haptics: existsSync(join(root, P.haptics)) || imports('expo-haptics') || imports('react-native-haptic-feedback') || nonTest.some((file) => vibrationImports({ files, P, layout }, file.rel, file.source).some((entry) => !entry.isAllowed)),
  };
}

/** One Expo app: its own folder is the root its source, contract, config and manifest are read from. */
function checkApp(root, options, report, repo) {
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json, so it is not an app repo root`, 'Run from the app repo root, or pass it as the first argument.');
  // --src-dir is inside the app folder; the repo-root spelling of a workspace (apps/mobile/src) still works.
  const given = options['src-dir'];
  const srcDir = given !== undefined && repo.dir !== '.' && given.startsWith(`${repo.dir}/`) ? given.slice(repo.dir.length + 1) : given;
  const layout = resolveLayout(root, { srcDir });
  const P = pathsOf(layout);
  const contract = loadContract(root, layout, options.contract);
  const files = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'] })
    .filter((rel) => rel.startsWith(`${layout.srcDir}/`) || rel.startsWith(`${layout.mocksDir}/`))
    .map((rel) => {
      const raw = readFileSync(join(root, rel), 'utf8');
      return { rel, raw, source: maskComments(raw), isTest: TEST_FILE.test(rel) };
    });
  const parts = partsOf(root, layout, P, files);
  if (!parts.audio && !parts.haptics) return { notApplicable: `no source file imports react-native-audio-api, expo-haptics or Vibration, and ${P.audio} and ${P.haptics} do not exist` };
  if (!parts.audio) report.note(`audio rules not applicable: no source file imports react-native-audio-api, no audio plugin, no ${P.audio}`);
  if (!parts.haptics) report.note(`haptics rules not applicable: no source file imports expo-haptics or Vibration, no ${P.haptics}`);
  const ctx = { root, layout, P, contract, files, parts };
  checkFiles(root, layout, P, parts, report);
  checkPackages(root, contract, parts, report);
  const contexts = checkImports(ctx, report);
  if (parts.audio) checkAdapter(root, P, contexts, report);
  checkPolicies(root, P, parts, report);
  if (parts.haptics) checkHaptics(root, P, report);
  checkConfig(root, layout, P, parts, report);
  checkAssets(root, layout, contract, parts, report, repo);
  checkCallSites(ctx, report);
  checkUiFeedback(ctx, report);
  repo.apps.push({ contract, parts });
  return { checked: files.length };
}

/**
 * In a workspace repo run from its root, the workspaces that are no app (a shared feedback package)
 * still keep the native module's pin: their manifests are checked once, from the root.
 */
function checkPackageManifests(root, appDirs, repo, report) {
  const app = repo.apps.find((entry) => entry.parts.audio) ?? repo.apps[0];
  if (app === undefined || appDirs.includes('.')) return;
  const manifests = readWorkspaces(root)
    .filter((workspace) => !appDirs.includes(workspace.dir))
    .map((workspace) => ({ rel: `${workspace.dir}/package.json`, mustList: false }));
  checkPackages(root, app.contract, app.parts, report, manifests);
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json, so it is not an app repo root`, 'Run from the app repo root, or pass it as the first argument.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const repo = { root, report, apps: [] };
  const appDirs = [];
  const result = await forEachExpoApp(root, report, (appRoot, appReport, dir) => {
    appDirs.push(dir);
    return checkApp(appRoot, options, appReport, { ...repo, dir });
  });
  checkPackageManifests(root, appDirs, repo, report);
  if (result.notApplicable !== null) return report.notApplicable(result.notApplicable);
  return report.finish({ checked: result.checked, unit: 'source files' });
});
