// push-rules.mjs: the rules of check-push. Each takes the context built by check-push.mjs:
// { root, layout, sources, app (non-test sources), contract, authContract, appConfig, add(problem),
//   skip(entry) } and reports through add/skip. Zero dependencies.

import { join } from 'node:path';

import { lineOf, notYetCreated, walkRepo } from '../check-lib.mjs';
import {
  ADAPTER_APIS,
  apiUses,
  bracketBody,
  callIndexes,
  escapeRegExp,
  lineAtMatch,
  optionValue,
  readTextIfExists,
  stringItems,
} from './push-source.mjs';

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const IMPORTANCES = ['high', 'default', 'low'];
export const DEFAULT_FILES = {
  message: 'src/core/push/push-message.ts',
  channels: 'src/services/push/push-channels.ts',
};

function at(src, index) {
  return lineOf(src.text, Math.max(0, index));
}

// push-contract ----------------------------------------------------------------------------------
/** Returns a list of shape problems of contracts/push.json (empty when valid). */
export function contractShapeProblems(data) {
  const problems = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return ['the contract is not a JSON object'];
  if (!['expo', 'native'].includes(data.provider)) problems.push('"provider" must be "expo" or "native"');
  if (typeof data.requiresAccount !== 'boolean') problems.push('"requiresAccount" must be true or false');
  if (!Array.isArray(data.kinds) || data.kinds.length === 0 || !data.kinds.every((kind) => typeof kind === 'string' && KEBAB.test(kind))) {
    problems.push('"kinds" must be a non-empty list of kebab-case kinds');
  } else if (new Set(data.kinds).size !== data.kinds.length) problems.push('"kinds" lists a kind twice');
  const channels = Array.isArray(data.channels) ? data.channels : null;
  if (channels === null || channels.length === 0 || !channels.every((c) => typeof c?.id === 'string' && KEBAB.test(c.id) && IMPORTANCES.includes(c.importance))) {
    problems.push('"channels" must be a non-empty list of { "id": kebab-case, "importance": "high" | "default" | "low" }');
  } else {
    if (new Set(channels.map((c) => c.id)).size !== channels.length) problems.push('"channels" lists an id twice');
    if (!channels.some((c) => c.id === data.defaultChannel)) problems.push(`"defaultChannel" (${JSON.stringify(data.defaultChannel)}) is not one of "channels"`);
  }
  return problems;
}

export function checkContract(ctx) {
  const { contract, contractRel } = ctx;
  if (contract === null) {
    const user = ctx.tokenUsers[0];
    ctx.add({ file: user.src.rel, line: at(user.src, user.index), rule: 'push-contract', message: `the app requests push tokens (${user.api}) but ${contractRel} does not exist: the server has no written contract of kinds, channels and data`, fix: `Copy templates/contracts/push.json and push.schema.json to ${ctx.layout.contractsDir}/ and fill in this app's facts.` });
    return;
  }
  if (contract.error !== undefined) {
    ctx.add({ file: contract.rel, line: 1, rule: 'push-contract', message: `${contract.rel} is not valid JSON: ${contract.error}`, fix: 'Fix the JSON syntax.' });
    return;
  }
  for (const problem of contractShapeProblems(contract.data)) {
    ctx.add({ file: contract.rel, line: 1, rule: 'push-contract', message: problem, fix: 'Edit the contract to match push.schema.json.' });
  }
}

/** True when the contract parsed and has a valid shape (later rules read it). */
export function isUsableContract(contract) {
  return contract !== null && contract.error === undefined && contractShapeProblems(contract.data).length === 0;
}

// push-token -------------------------------------------------------------------------------------
export function checkTokenRequested(ctx) {
  if (ctx.tokenUsers.length > 0 || ctx.contract === null) return;
  ctx.add({ file: ctx.contract.rel, line: 1, rule: 'push-token', message: 'the push contract exists but no app code requests a push token (getExpoPushTokenAsync or getDevicePushTokenAsync)', fix: 'Copy templates/src/services/push/ (the adapter requests the token) or delete the contract if the app has no remote push.' });
}

// push-adapter-only ------------------------------------------------------------------------------
export function checkAdapterOnly(ctx) {
  for (const src of ctx.app) {
    if (src.isAdapter) continue;
    for (const use of apiUses(src, ADAPTER_APIS)) {
      ctx.add({ file: src.rel, line: at(src, use.index), rule: 'push-adapter-only', message: `${use.api} from expo-notifications outside the push adapter: the token, the permission, the handler and taps belong to one file behind PushPort`, fix: `Call the PushPort (useServices().push) instead; only ${ctx.layout.servicesDir}/push/expo-notifications-push-adapter.ts imports these APIs.` });
    }
  }
}

// permission-in-context --------------------------------------------------------------------------
function isStartupFile(rel, layout) {
  return (
    (rel.startsWith(`${layout.routesDir}/`) && /\/_layout\.tsx?$/.test(rel)) ||
    rel.startsWith(`${layout.featuresDir}/root-navigator/`) ||
    rel === `${layout.servicesDir}/create-device-services.ts`
  );
}

function effectRanges(code) {
  const ranges = [];
  for (const name of ['useEffect', 'useLayoutEffect', 'useFocusEffect', 'useMountEffect']) {
    for (const index of callIndexes(code, name)) {
      const body = bracketBody(code, index);
      if (body !== null) ranges.push([body.start, body.end]);
    }
  }
  return ranges;
}

/**
 * The notification asks in a file: optInToPush(...), requestPermission(...) on a receiver whose name
 * says push (push.requestPermission, services.push.requestPermission), and expo-notifications'
 * requestPermissionsAsync (a named import or Namespace.requestPermissionsAsync). Other permission
 * asks (useCameraPermissions' requestPermission, MediaLibrary.requestPermissionsAsync) are not this
 * rule's business (references/checker-rules.md lists the limits).
 */
function askIndexes(src) {
  const { code } = src;
  const found = callIndexes(code, 'optInToPush').map((index) => ({ name: 'optInToPush', index }));
  const pushReceiver = /(?<![\w$])[\w$]*push[\w$]*\s*\.\s*requestPermission\s*\(/gi;
  for (const match of code.matchAll(pushReceiver)) found.push({ name: 'requestPermission', index: match.index });
  const sdkCall = /^(?:[\w$]+\s*\.\s*)?requestPermissionsAsync\s*\(/;
  for (const use of apiUses(src, ['requestPermissionsAsync'])) {
    if (sdkCall.test(code.slice(use.index, use.index + 80))) found.push({ name: 'requestPermissionsAsync', index: use.index });
  }
  return found;
}

export function checkPermissionInContext(ctx) {
  for (const src of ctx.app) {
    if (src.isAdapter) continue;
    const asks = askIndexes(src);
    if (asks.length === 0) continue;
    const startup = isStartupFile(src.rel, ctx.layout);
    const effects = effectRanges(src.code);
    for (const ask of asks) {
      const inEffect = effects.some(([start, end]) => ask.index > start && ask.index < end);
      if (!startup && !inEffect) continue;
      const where = startup ? 'in a startup file' : 'inside an effect (on mount)';
      ctx.add({ file: src.rel, line: at(src, ask.index), rule: 'permission-in-context', message: `${ask.name}(...) ${where}: the notification prompt appears before the person knows why, and iOS never shows it again after a refusal`, fix: 'Ask only from a person\'s action that explains the benefit (optInToPush from an onPress); at launch only read the permission and sync.' });
    }
  }
}

// expo-project-id --------------------------------------------------------------------------------
export function checkProjectId(ctx) {
  if (ctx.contract?.data?.provider !== 'expo') return;
  for (const src of ctx.app) {
    for (const use of apiUses(src, ['getExpoPushTokenAsync'])) {
      const body = bracketBody(src.code, use.index);
      if (body === null || !/\bprojectId\b/.test(body.text)) {
        ctx.add({ file: src.rel, line: at(src, use.index), rule: 'expo-project-id', message: 'getExpoPushTokenAsync without an explicit projectId: outside EAS Build it throws ERR_NOTIFICATIONS_NO_EXPERIENCE_ID, and a guessed id issues tokens for another project', fix: 'Pass { projectId } from readEasProjectId() (Constants.easConfig?.projectId, else extra.eas.projectId).' });
      }
    }
  }
  const config = ctx.appConfig;
  if (config === null) return;
  if (!/\bprojectId\b/.test(config.code)) {
    ctx.add({ file: config.rel, line: 1, rule: 'expo-project-id', message: 'the app config sets no extra.eas.projectId: a build made outside EAS has no project id, so it gets no Expo push token', fix: 'Add extra: { eas: { projectId: \'<the id eas init prints>\' } } to the app config.' });
  }
}

// token-rotation ---------------------------------------------------------------------------------
export function checkTokenRotation(ctx) {
  const fetches = ctx.tokenUsers.filter((use) => use.api !== 'addPushTokenListener');
  if (fetches.length === 0) return;
  if (ctx.tokenUsers.some((use) => use.api === 'addPushTokenListener')) return;
  const first = fetches[0];
  ctx.add({ file: first.src.rel, line: at(first.src, first.index), rule: 'token-rotation', message: 'a push token is fetched but never watched: APNs and FCM rotate tokens while the app runs, and the server keeps sending to the dead one', fix: 'Subscribe with addPushTokenListener in the adapter (PushPort.onTokenChange) and re-register the new token (createPushRegistration().start()).' });
}

// channel-setup / channel-contract ---------------------------------------------------------------
export function checkChannelSetup(ctx) {
  if (ctx.tokenUsers.length === 0) return;
  const creates = ctx.app.some((src) => apiUses(src, ['setNotificationChannelAsync']).length > 0);
  if (creates) return;
  const first = ctx.tokenUsers[0];
  ctx.add({ file: first.src.rel, line: at(first.src, first.index), rule: 'channel-setup', message: 'push is built but no code creates an Android notification channel: Android issues no push token before a channel exists (an app targeting 12L or lower shows no prompt either), and a push naming a missing channel is not shown', fix: 'Create the channels with setNotificationChannelAsync in the adapter (PushPort.syncChannels) before asking and at every launch.' });
}

function channelsInCode(text) {
  const decl = /PUSH_CHANNELS\b[^=]*=\s*\[/.exec(text);
  if (decl === null) return null;
  const body = bracketBody(text, decl.index + decl[0].length - 1, '[');
  return [...body.text.matchAll(/\{[^{}]*\}/g)].map((match) => ({
    id: /\bid\s*:\s*['"]([^'"]+)['"]/.exec(match[0])?.[1] ?? null,
    importance: /\bimportance\s*:\s*['"]([^'"]+)['"]/.exec(match[0])?.[1] ?? null,
  }));
}

export function checkChannelContract(ctx) {
  const rel = ctx.contract.data.files?.channels ?? DEFAULT_FILES.channels;
  const text = readTextIfExists(join(ctx.root, rel));
  if (text === null) {
    ctx.add({ file: ctx.contract.rel, line: lineAtMatch(ctx.contract.text, '"channels"'), rule: 'channel-contract', message: `${rel} (the channels file) does not exist`, fix: 'Copy templates/src/services/push/push-channels.ts, or point files.channels at the file that declares PUSH_CHANNELS.' });
    return;
  }
  const inCode = channelsInCode(text);
  const expected = ctx.contract.data.channels;
  const same = inCode !== null && inCode.length === expected.length && expected.every((c, i) => inCode[i].id === c.id && inCode[i].importance === c.importance);
  if (!same) {
    const found = inCode === null ? 'no PUSH_CHANNELS table' : JSON.stringify(inCode);
    ctx.add({ file: rel, line: lineAtMatch(text, /PUSH_CHANNELS\b[^=]*=/), rule: 'channel-contract', message: `PUSH_CHANNELS (${found}) differs from the contract's channels (${JSON.stringify(expected)}): the server would name a channel the device never created, and Android drops that push`, fix: 'Make the ids, order and importance equal; a channel\'s importance is fixed once created, so a new behaviour gets a new id.' });
  }
}

// kinds-contract ---------------------------------------------------------------------------------
export function checkKindsContract(ctx) {
  const rel = ctx.contract.data.files?.message ?? DEFAULT_FILES.message;
  const text = readTextIfExists(join(ctx.root, rel));
  if (text === null) {
    ctx.add({ file: ctx.contract.rel, line: lineAtMatch(ctx.contract.text, '"kinds"'), rule: 'kinds-contract', message: `${rel} (the push message schema) does not exist`, fix: 'Copy templates/src/core/push/push-message.ts, or point files.message at the file that declares PUSH_KINDS.' });
    return;
  }
  const decl = /PUSH_KINDS\b[^=]*=\s*\[/.exec(text);
  const kinds = decl === null ? null : stringItems(bracketBody(text, decl.index + decl[0].length - 1, '[').text);
  const expected = ctx.contract.data.kinds;
  const same = kinds !== null && kinds.length === expected.length && expected.every((kind) => kinds.includes(kind));
  if (!same) {
    ctx.add({ file: rel, line: lineAtMatch(text, /PUSH_KINDS\b[^=]*=/), rule: 'kinds-contract', message: `PUSH_KINDS (${kinds === null ? 'missing' : JSON.stringify(kinds)}) differs from the contract's kinds (${JSON.stringify(expected)})`, fix: 'Add the kind to both, with its schema branch in the message file and its destination in push-destination.ts.' });
  }
  if (!/\bsafeParse\s*\(|\bv\.parse\s*\(|\bparse\s*\(/.test(maskTypes(text))) {
    ctx.add({ file: rel, line: 1, rule: 'kinds-contract', message: 'the push message file never parses the data: an unchecked payload reaches navigation', fix: 'Parse with a valibot schema (v.safeParse) and return null for anything else (parsePushData).' });
  }
}

function maskTypes(text) {
  return text.replace(/\/\/[^\n]*/g, '');
}

// payload-parse / payload-navigation -------------------------------------------------------------
export function checkPayload(ctx) {
  const navigation = /(?:router\s*\.\s*(?:push|replace|navigate|dismissTo)|Linking\s*\.\s*openURL|WebBrowser\s*\.\s*openBrowserAsync)\s*\(/g;
  const fromPayload = /\bdata\s*(?:\?\.|\.)\s*(?:url|href|link|route|path|screen|deep[lL]ink)\b|\bcontent\s*(?:\?\.|\.)\s*data\b/;
  for (const src of ctx.app) {
    if (!src.isAdapter) {
      for (const match of src.code.matchAll(/\b(?:request|notification)\s*(?:\?\.|\.)\s*content\s*(?:\?\.|\.)\s*data\b/g)) {
        ctx.add({ file: src.rel, line: at(src, match.index), rule: 'payload-parse', message: 'notification content.data read outside the push adapter: the payload is untrusted input from anyone who holds a token', fix: 'Read PushResponse.data from the port and pass it through parsePushData before acting on it.' });
      }
    }
    for (const match of src.code.matchAll(navigation)) {
      const body = bracketBody(src.code, match.index);
      if (body !== null && fromPayload.test(body.text)) {
        ctx.add({ file: src.rel, line: at(src, match.index), rule: 'payload-navigation', message: 'navigation to a route or URL taken from a notification payload: a forged push could open any screen or site', fix: 'Map the parsed kind and id to a destination (destinationFor) and the destination to a typed route.' });
      }
    }
  }
}

// tap-handling -----------------------------------------------------------------------------------
export function checkTapHandling(ctx) {
  const has = (apis) => ctx.app.some((src) => apiUses(src, apis).length > 0);
  const missing = [];
  if (!has(['getLastNotificationResponse', 'useLastNotificationResponse'])) missing.push('the tap that launched the app (getLastNotificationResponse)');
  if (!has(['addNotificationResponseReceivedListener'])) missing.push('taps while the app runs (addNotificationResponseReceivedListener)');
  if (!has(['clearLastNotificationResponse'])) missing.push('clearing a handled launch tap (clearLastNotificationResponse)');
  if (missing.length === 0) return;
  const first = ctx.tokenUsers[0];
  ctx.add({ file: first.src.rel, line: at(first.src, first.index), rule: 'tap-handling', message: `notification taps are not fully handled; missing: ${missing.join('; ')}`, fix: 'Use the template adapter (lastResponse, clearLastResponse, onResponse) and startPushTapRouting.' });
}

// foreground-handler / deprecated-api ------------------------------------------------------------
export function checkForegroundHandler(ctx) {
  // The handler in the file that requests push tokens (the push adapter) is the one to keep, so a
  // second one elsewhere (local-notifications' adapter, a feature) is reported, whatever the paths' order.
  // local-notifications' contract: when push is adopted, the composition root passes
  // createExpoLocalNotificationsAdapter({ ..., installForegroundHandler: false }); the copied local
  // adapter keeps its guarded call site, which then never runs, so it does not count (the same
  // exemption check-reminder-code applies).
  const tokenFiles = new Set(ctx.tokenUsers.map((user) => user.src.rel));
  const localDir = `${ctx.layout.servicesDir}/local-notifications/`;
  const handedOver = ctx.app.some((src) => !src.rel.startsWith(localDir) && /\binstallForegroundHandler\s*:\s*false\b/.test(src.code));
  const counts = (src) => !(handedOver && src.isAdapter && src.rel.startsWith(localDir));
  const calls = ctx.app
    .filter(counts)
    .flatMap((src) => apiUses(src, ['setNotificationHandler']).map((use) => ({ src, index: use.index })))
    .sort((a, b) => Number(tokenFiles.has(b.src.rel)) - Number(tokenFiles.has(a.src.rel)));
  if (calls.length === 0) {
    const first = ctx.tokenUsers[0];
    ctx.add({ file: first.src.rel, line: at(first.src, first.index), rule: 'foreground-handler', message: 'no setNotificationHandler: a notification that arrives while the app is open is not shown at all', fix: 'Install one handler in the push adapter (the template does) that answers from foregroundPresentation.' });
  }
  for (const extra of calls.slice(1)) {
    ctx.add({ file: extra.src.rel, line: at(extra.src, extra.index), rule: 'foreground-handler', message: `a second setNotificationHandler (the first is in ${calls[0].src.rel}): expo-notifications keeps one handler, so whichever runs last silently decides for every notification`, fix: `Remove this one and keep the handler in ${calls[0].src.rel}, with one policy for remote pushes and local notifications (foregroundPresentation); with local-notifications adopted, pass installForegroundHandler: false to createExpoLocalNotificationsAdapter in the composition root and leave the copied adapter unedited.` });
  }
}

export function checkDeprecated(ctx) {
  const deprecated = [
    [/\bshouldShowAlert\b/g, 'shouldShowAlert', 'shouldShowBanner and shouldShowList'],
    [/\bgetLastNotificationResponseAsync\b/g, 'getLastNotificationResponseAsync', 'getLastNotificationResponse()'],
    [/\bclearLastNotificationResponseAsync\b/g, 'clearLastNotificationResponseAsync', 'clearLastNotificationResponse()'],
  ];
  for (const src of ctx.app) {
    for (const [re, name, instead] of deprecated) {
      for (const match of src.code.matchAll(re)) {
        ctx.add({ file: src.rel, line: at(src, match.index), rule: 'deprecated-api', message: `${name} is deprecated in expo-notifications 57`, fix: `Use ${instead}.` });
      }
    }
  }
}

// plugin-config / fcm-config ---------------------------------------------------------------------
function pluginOptions(config) {
  const entry = /\[\s*(['"])expo-notifications\1\s*,\s*\{/.exec(config.code);
  if (entry !== null) {
    const body = bracketBody(config.code, entry.index + entry[0].length - 1, '{');
    return { listed: true, options: body.text, index: entry.index };
  }
  const bare = /(['"])expo-notifications\1/.exec(config.code);
  return { listed: bare !== null, options: null, index: bare?.index ?? 0 };
}

export function checkPluginConfig(ctx) {
  const config = ctx.appConfig;
  if (config === null) return;
  const plugin = pluginOptions(config);
  const line = lineOf(config.text, plugin.index);
  const fix = "List ['expo-notifications', { mode, icon, defaultChannel }] in plugins (examples/app.config.ts).";
  if (!plugin.listed || plugin.options === null) {
    ctx.add({ file: config.rel, line, rule: 'plugin-config', message: plugin.listed ? 'the expo-notifications plugin has no options: no Android icon (a grey square), no default channel, the development APNs environment in every build' : 'the expo-notifications plugin is not listed in the app config', fix });
    return;
  }
  const wanted = ctx.contract.data.defaultChannel;
  const channel = optionValue(plugin.options, 'defaultChannel', config.code);
  if (channel.value !== wanted) {
    ctx.add({ file: config.rel, line, rule: 'plugin-config', message: `the plugin's defaultChannel is ${channel.present ? JSON.stringify(channel.value ?? 'not a literal') : 'missing'}, the contract's is "${wanted}": a push without channelId lands in a channel the app does not manage`, fix: `Set defaultChannel: '${wanted}'.` });
  }
  for (const [key, why] of [['icon', 'Android draws the app icon as a white square in the status bar'], ['mode', 'the generated entitlements state the development APNs environment for every variant, so the config does not say which APNs each build ships to (distribution export re-signs with the profile\'s entitlement; the config should still state it)']]) {
    if (!optionValue(plugin.options, key, config.code).present) {
      ctx.add({ file: config.rel, line, rule: 'plugin-config', message: `the plugin sets no ${key}: ${why}`, fix });
    }
  }
}

export function checkFcmConfig(ctx) {
  const config = ctx.appConfig;
  if (config === null) return;
  if (/\bgoogleServicesFile\b/.test(config.code)) return;
  ctx.add({ file: config.rel, line: 1, rule: 'fcm-config', message: 'android.googleServicesFile is not set: without Firebase Cloud Messaging the Android build issues no push token, with the Expo push service too', fix: "Set android.googleServicesFile ('./google-services.json', public identifiers, safe to commit) and upload the FCM V1 service account key with eas credentials (a person does this)." });
}

// sign-out-unregister ----------------------------------------------------------------------------
export function checkSignOut(ctx) {
  if (ctx.contract.data.requiresAccount !== true) return;
  const rel = `${ctx.layout.contractsDir}/auth.json`;
  const auth = ctx.authContract;
  if (auth === null) {
    const reason = notYetCreated(ctx.root, { file: rel, owner: 'auth-and-secure-storage' });
    ctx.skip({ file: rel, rule: 'sign-out-unregister', message: reason ?? 'not yet created (auth-and-secure-storage creates it)' });
    return;
  }
  const steps = auth.data?.serverSignOutSteps;
  if (Array.isArray(steps) && steps.includes('push-registration')) return;
  ctx.add({ file: auth.rel, line: lineAtMatch(auth.text, '"serverSignOutSteps"'), rule: 'sign-out-unregister', message: 'serverSignOutSteps does not list push-registration: after sign-out the server keeps sending this person\'s notifications to a phone the next person uses', fix: 'Add "push-registration" to serverSignOutSteps and pass pushRegistrationStep(services.pushRegistration) where the session is created.' });
}

// push-wiring ------------------------------------------------------------------------------------
const ENTRY_POINTS = [
  ['createPushRegistration', 'the registration is never created, so the server never learns the token'],
  ['usePushSync', 'the registration is never synced at launch, foreground or account change'],
  ['usePushTaps', 'taps on notifications open the app but never the screen they are about'],
  ['createPushKit', 'the push root kit is never registered (createRootKits), so nothing syncs the registration or routes a tap'],
];

export function checkWiring(ctx) {
  for (const [name, harm] of ENTRY_POINTS) {
    const defined = new RegExp(`export\\s+function\\s+${escapeRegExp(name)}\\b`);
    const home = ctx.app.find((src) => defined.test(src.code));
    if (home === undefined) continue;
    const used = ctx.app.some((src) => src !== home && callIndexes(src.code, name).length > 0);
    if (!used) {
      ctx.add({ file: home.rel, line: lineAtMatch(home.code, defined), rule: 'push-wiring', message: `${name} is defined but nothing calls it: ${harm}`, fix: 'Wire it as the examples show: the push parts in create-app-push.ts (or the registry), the kit registered in src/services/create-root-kits.ts (examples/create-root-kits.ts); the kit\'s effects call usePushSync and usePushTaps.' });
    }
  }
}

/**
 * push-wiring: a literal `requiresAccount: true|false` passed to createPushRegistration equals the
 * contract's. A value that is not a literal (a variable, a config read) is not followed (checker-rules.md).
 */
export function checkRequiresAccount(ctx) {
  const wanted = ctx.contract.data.requiresAccount;
  for (const src of ctx.app) {
    for (const index of callIndexes(src.code, 'createPushRegistration')) {
      const body = bracketBody(src.code, index, '(');
      const literal = body === null ? null : /\brequiresAccount\s*:\s*(true|false)\b/.exec(body.text);
      if (literal === null || (literal[1] === 'true') === wanted) continue;
      ctx.add({ file: src.rel, line: at(src, body.start + 1 + literal.index), rule: 'push-wiring', message: `createPushRegistration gets requiresAccount: ${literal[1]}, but ${ctx.contract.rel} says ${wanted}: ${wanted ? 'the app registers signed-out devices the server refuses or cannot tie to an account' : 'the app waits for a sign-in the server does not need, so signed-out devices never get pushes'}`, fix: `Pass requiresAccount: ${wanted}, or change the contract (and tell the server) if the app's decision changed.` });
    }
  }
}

// client-send ------------------------------------------------------------------------------------
const SENDERS = [
  [/exp\.host\/--\/api\/v2\/push\/send/, 'the Expo push send endpoint'],
  [/api\.expo\.dev\/v2\/push\/send/, 'the Expo push send endpoint'],
  [/fcm\.googleapis\.com/, 'the FCM send API'],
  [/api(?:\.sandbox)?\.push\.apple\.com/, 'the APNs API'],
  [/from\s+['"]expo-server-sdk['"]/, 'expo-server-sdk'],
];

export function checkClientSend(ctx) {
  for (const src of ctx.app) {
    for (const [re, what] of SENDERS) {
      const index = src.code.search(re);
      if (index >= 0) {
        ctx.add({ file: src.rel, line: at(src, index), rule: 'client-send', message: `app code reaches ${what}: sending pushes needs the server's access token or keys, which a shipped app gives to everyone`, fix: 'Send from the server only; the app registers its token through the ApiClient and nothing more.' });
      }
    }
  }
}

// push-credentials -------------------------------------------------------------------------------
const PUBLIC_TOKEN = /\bEXPO_PUBLIC_[A-Z0-9_]*(?:EXPO_ACCESS|PUSH)[A-Z0-9_]*(?:TOKEN|KEY|SECRET)\b/;

export function checkCredentials(ctx) {
  const files = walkRepo(ctx.root, { include: ['*.json', '*.p8', '*.p12', '*.ts', '*.tsx', '*.js', '*.mjs', '*.env', '.env*', '*.yml', '*.yaml'] });
  for (const rel of files) {
    const name = rel.split('/').at(-1);
    if (/\.(p8|p12)$/.test(name)) {
      ctx.add({ file: rel, line: 1, rule: 'push-credentials', message: `${name} is a signing or APNs key file inside the repo`, fix: 'Delete it from the repo (and its history), revoke it in the Apple Developer account, and let EAS hold the key (eas credentials); a person does this.' });
      continue;
    }
    const text = readTextIfExists(join(ctx.root, rel));
    if (text === null) continue;
    if (name.endsWith('.json') && /"type"\s*:\s*"service_account"/.test(text) && /"private_key"\s*:/.test(text)) {
      ctx.add({ file: rel, line: lineAtMatch(text, '"private_key"'), rule: 'push-credentials', message: 'a Google service account key (FCM V1 sender credential) is committed', fix: 'Delete it, rotate the key in Google Cloud, and upload the new one with eas credentials only (a person does this).' });
      continue;
    }
    const index = text.search(PUBLIC_TOKEN);
    if (index >= 0) {
      ctx.add({ file: rel, line: lineOf(text, index), rule: 'push-credentials', message: 'a push access token or key in an EXPO_PUBLIC_ variable: every EXPO_PUBLIC_ value is compiled into the app for anyone to read', fix: 'Keep the Expo access token on the server (enhanced push security); the app needs no push secret.' });
    }
  }
}
