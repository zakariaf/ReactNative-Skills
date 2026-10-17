// auth-rules.mjs: the rules of check-auth.mjs. Each rule receives the context built by the checker
// (layout, sources, contract, config) and reports through ctx.add({ file, line, rule, message, fix }).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  AUTH_PACKAGES,
  BARE_CREDENTIAL_PATTERN,
  LEAK_PATTERN,
  LOGGED_VALUE_PATTERN,
  PLAIN_STORAGE_PACKAGES,
  TOKEN_PATTERN,
  argCount,
  argText,
  callsOf,
  escapeRegExp,
  firstMatch,
  importsAny,
  importsOfPackage,
  lineAt,
  lineOfText,
  stepFactoryName,
} from './auth-source.mjs';

const ADAPTER_SUFFIX = '-adapter(?:\\.(?:ios|android|native|web))?\\.tsx?$';

function adapterPattern(servicesDir) {
  return new RegExp(`^${escapeRegExp(servicesDir)}/[^/]+/[^/]+${ADAPTER_SUFFIX}`);
}

/** The adapter's base path without a platform suffix: a .ios/.android pair counts as one adapter. */
function adapterBase(rel) {
  return rel.replace(/\.(?:ios|android|native|web)(?=\.tsx?$)/, '');
}

function isFake(rel) {
  return /(?:^|\/)fake-[^/]+$/.test(rel);
}

// vendor-import ----------------------------------------------------------------------------------
export function checkVendorImports(ctx) {
  const isAdapter = (rel) => adapterPattern(ctx.layout.servicesDir).test(rel);
  for (const pkg of AUTH_PACKAGES) {
    const adapters = new Map();
    for (const src of ctx.appFiles) {
      for (const hit of importsOfPackage(src, pkg)) {
        if (isAdapter(src.rel)) {
          if (!adapters.has(adapterBase(src.rel))) adapters.set(adapterBase(src.rel), { src, line: lineAt(src, hit.index) });
          continue;
        }
        ctx.add({
          file: src.rel,
          line: lineAt(src, hit.index),
          rule: 'vendor-import',
          message: `${pkg} imported outside its adapter: tokens and provider calls must stay behind one port`,
          fix: `Import ${pkg} only in ${ctx.layout.servicesDir}/<concern>/<library>-<concern>-adapter.ts and use the port elsewhere.`,
        });
      }
    }
    const [first, ...others] = [...adapters.values()];
    for (const other of others) {
      ctx.add({
        file: other.src.rel,
        line: other.line,
        rule: 'vendor-import',
        message: `a second adapter imports ${pkg} (${first.src.rel} is the first): two option sets read and wipe different items`,
        fix: `Keep one adapter for ${pkg}; other code uses its port.`,
      });
    }
  }
}

// secure-store-call ------------------------------------------------------------------------------
export function checkSecureStoreCalls(ctx) {
  for (const src of ctx.secureStoreImporters) {
    for (const call of callsOf(src, 'getItemAsync|setItemAsync|deleteItemAsync|getItem|setItem')) {
      const line = lineAt(src, call.start);
      if (call.name === 'getItem' || call.name === 'setItem') {
        ctx.add({
          file: src.rel,
          line,
          rule: 'secure-store-call',
          message: `SecureStore.${call.name}() blocks the JS thread (and the UI while a biometric prompt waits)`,
          fix: `Use ${call.name}Async with the adapter's options object.`,
        });
        continue;
      }
      const needed = call.name === 'setItemAsync' ? 3 : 2;
      if (argCount(src, call) < needed) {
        ctx.add({
          file: src.rel,
          line,
          rule: 'secure-store-call',
          message: `${call.name}() without the options object: an item written with other options is not found`,
          fix: 'Pass the one frozen SECURE_STORE_OPTIONS object to every getItemAsync/setItemAsync/deleteItemAsync call.',
        });
      }
    }
    const always = firstMatch(src, /\bALWAYS(?:_THIS_DEVICE_ONLY)?\b/, 'masked');
    if (always) {
      ctx.add({
        file: src.rel,
        line: always.line,
        rule: 'secure-store-call',
        message: 'keychainAccessible ALWAYS keeps tokens readable on a locked phone (deprecated by Expo)',
        fix: 'Use SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (background refresh works, no backup restore to another device).',
      });
    }
    const biometric = firstMatch(src, /\brequireAuthentication\s*:\s*true\b/);
    if (biometric && !/biometric-gate:\s*\S/.test(src.text)) {
      ctx.add({
        file: src.rel,
        line: biometric.line,
        rule: 'secure-store-call',
        message: 'requireAuthentication on session tokens: Android prompts on every read (the silent refresh too) and new biometrics make the item unreadable',
        fix: 'Keep tokens without requireAuthentication; gate a separate secret behind biometrics and say why in a "// biometric-gate: <why>" comment.',
      });
    }
  }
}

// secure-keys ------------------------------------------------------------------------------------
function keysOf(src) {
  const start = src.code.search(/export\s+const\s+SECURE_KEYS\b/);
  const open = src.code.indexOf('{', start);
  const close = open === -1 ? -1 : src.code.indexOf('}', open);
  if (close === -1) return [];
  const body = src.code.slice(open, close);
  return [...body.matchAll(/:\s*(['"])([^'"]*)\1/g)].map((match) => ({ value: match[2], index: open + match.index }));
}

export function checkSecureKeys(ctx) {
  if (ctx.secureStoreImporters.length === 0) return;
  const owners = ctx.appFiles.filter((src) => /export\s+const\s+SECURE_KEYS\b/.test(src.code));
  const anchor = ctx.secureStoreImporters[0];
  if (owners.length === 0) {
    ctx.add({
      file: anchor.rel,
      line: 1,
      rule: 'secure-keys',
      message: 'no declared key list (export const SECURE_KEYS): a secret under an undeclared key survives sign-out and the fresh-install wipe',
      fix: `Declare every secure-store key in ${ctx.layout.servicesDir}/secure-storage/secure-key-names.ts and type the port's key parameter with it.`,
    });
    return;
  }
  const owner = owners[0];
  const seen = new Set();
  for (const key of keysOf(owner)) {
    const line = lineAt(owner, key.index);
    if (!/^[\w.-]+$/.test(key.value)) {
      ctx.add({ file: owner.rel, line, rule: 'secure-keys', message: `key "${key.value}" uses characters expo-secure-store rejects`, fix: 'Use only letters, digits, ".", "-" and "_" (expo-secure-store throws "Invalid key provided to SecureStore").' });
    }
    if (seen.has(key.value)) {
      ctx.add({ file: owner.rel, line, rule: 'secure-keys', message: `key "${key.value}" is declared twice`, fix: 'Give every secret its own key.' });
    }
    seen.add(key.value);
  }
  const wipes = ctx.appFiles.some((src) => src !== owner && !isFake(src.rel) && /\bALL_SECURE_KEYS\b|Object\.values\(\s*SECURE_KEYS\s*\)/.test(src.masked));
  if (!wipes) {
    ctx.add({
      file: owner.rel,
      line: lineOfText(owner.text, 'SECURE_KEYS'),
      rule: 'secure-keys',
      message: 'nothing removes every declared key: a sign-out that lists keys by hand forgets the next one added',
      fix: 'Wipe with a loop over ALL_SECURE_KEYS (Object.values(SECURE_KEYS)): in the session vault, or (secrets only) in the fresh-install wipe.',
    });
  }
}

// token-storage, token-in-state, token-in-log, token-in-url --------------------------------------
export function checkTokenLeaks(ctx) {
  for (const src of ctx.appFiles) {
    if (isFake(src.rel)) continue;
    if (importsAny(src, PLAIN_STORAGE_PACKAGES, { exact: true })) {
      const hit = firstMatch(src, TOKEN_PATTERN) ?? firstMatch(src, BARE_CREDENTIAL_PATTERN);
      if (hit) {
        ctx.add({ file: src.rel, line: hit.line, rule: 'token-storage', message: 'a credential next to plain storage (SQLite, kv-store, AsyncStorage, MMKV, files): it is not encrypted with a hardware-backed key and lands in backups', fix: 'Keep tokens and secrets only behind the SecureStoragePort (expo-secure-store).' });
      }
    }
    const isStore = src.rel.startsWith(`${ctx.layout.storesDir}/`) || importsOfPackage(src, 'zustand').length > 0;
    if (isStore) {
      const hit = firstMatch(src, TOKEN_PATTERN) ?? firstMatch(src, BARE_CREDENTIAL_PATTERN);
      if (hit) {
        ctx.add({ file: src.rel, line: hit.line, rule: 'token-in-state', message: 'a credential in a state store: devtools, persist middleware and crash breadcrumbs can read it', fix: 'Stores hold non-secret facts (account id, display name, status); the session manager keeps tokens in memory and the secure store.' });
      }
    }
    for (const call of callsOf(src, 'console\\.(?:log|info|warn|error|debug|trace)|record|captureException|captureMessage|addBreadcrumb|logEvent|track')) {
      if (LEAK_PATTERN.test(argText(src, call)) || LOGGED_VALUE_PATTERN.test(src.masked.slice(call.open + 1, call.close))) {
        ctx.add({ file: src.rel, line: lineAt(src, call.start), rule: 'token-in-log', message: 'a credential, Authorization header, PKCE verifier or nonce goes into a log, error report or analytics event', fix: 'Log the failure kind and the key name only, never the value.' });
      }
    }
    const url = firstMatch(src, /[?&#](?:access_token|id_token|refresh_token|token|code_verifier)=/);
    if (url) {
      ctx.add({ file: src.rel, line: url.line, rule: 'token-in-url', message: 'a credential in a URL: URLs reach server logs, browser history, referrers and analytics', fix: 'Send tokens in the Authorization header (sessionHeaders) and use the authorization-code flow, never a token in a query or fragment.' });
    }
  }
}

// fresh-install-wipe -----------------------------------------------------------------------------
export function checkFreshInstallWipe(ctx) {
  if (ctx.secureStoreImporters.length === 0) return;
  const wipes = ctx.appFiles.some(
    (src) => !isFake(src.rel) && /installMarker|InstallMarker/.test(src.masked) && /\.isPresent\s*\(/.test(src.masked) && /\bwipeSession\s*\(|\bALL_SECURE_KEYS\b/.test(src.masked),
  );
  if (!wipes) {
    const anchor = ctx.secureStoreImporters[0];
    ctx.add({
      file: anchor.rel,
      line: 1,
      rule: 'fresh-install-wipe',
      message: ctx.isSecretsOnly
        ? "nothing wipes the secure store on a fresh install: the iOS Keychain outlives an uninstall, so a reinstall finds the previous install's secrets"
        : 'nothing wipes the secure store on a fresh install: the iOS Keychain outlives an uninstall, so a reinstall restores the previous session',
      fix: ctx.isSecretsOnly
        ? 'At startup, before the first secret is read, check an install marker kept in the app sandbox (installMarker.isPresent()); when it is missing, delete every key of ALL_SECURE_KEYS, then write the marker.'
        : 'At restore, read an install marker kept in the app sandbox (kv-store); when it is missing, wipe every secure key, then write the marker.',
    });
  }
}

// single-flight-refresh --------------------------------------------------------------------------
/**
 * A hand-written refresh request: the grant's field or value, or a token endpoint in a string
 * ('/auth/refresh', '/oauth/token', '/refresh-token', or a path that is just '/refresh').
 */
const REFRESH_REQUEST = /\brefresh_token\b|['"`][^'"`\n]*\/(?:(?:auth|oauth2?|connect|identity|tokens?|sessions?)\/(?:refresh|token)|refresh[-_]?tokens?)(?=['"`?#])|['"`](?:\$\{[^}]*\})?\/refresh(?=['"`?#])/i;
/** A file that implements the session's TokenRefresher port is the refresher, not a second refresh. */
const IMPLEMENTS_REFRESHER = /:\s*TokenRefresher\b|\bsatisfies\s+TokenRefresher\b/;

/** The first place a file refreshes tokens itself, as { index, how }, or null. */
/** `function refreshX(refreshToken)`, a method `refresh(refreshToken) {` or signature `refresh(t: string): R;`. */
function isDefinition(src, call) {
  return /\bfunction\s*\*?\s*$/.test(src.masked.slice(Math.max(0, call.start - 20), call.start)) || /^\s*(?:\{|=>|:[^;{}=]*(?:[;{]|=>))/.test(src.masked.slice(call.close + 1, call.close + 200));
}

function refreshSite(src) {
  const call = callsOf(src, 'refresh\\w*').find((entry) => !isDefinition(src, entry) && /refresh_?token/i.test(argText(src, entry)));
  if (call) return { index: call.start, how: `${call.name}(<refresh token>)` };
  const request = REFRESH_REQUEST.exec(src.code);
  return request ? { index: request.index, how: 'a hand-written refresh request' } : null;
}

export function checkSingleFlightRefresh(ctx) {
  const isAdapter = (rel) => adapterPattern(ctx.layout.servicesDir).test(rel);
  const owners = [];
  for (const src of ctx.appFiles) {
    if (isAdapter(src.rel) || isFake(src.rel) || IMPLEMENTS_REFRESHER.test(src.masked)) continue;
    const site = refreshSite(src);
    if (site) owners.push({ src, line: lineAt(src, site.index), how: site.how });
  }
  const isShared = (src) => /\bsingleFlight\s*\([^)]*refresh|refresh\w*\s*\?\?=/i.test(src.masked);
  // The owner is the file that shares its refresh; any other refresh call site is a second one.
  const owner = owners.find((entry) => isShared(entry.src)) ?? owners[0];
  if (owner === undefined) return;
  for (const other of owners.filter((entry) => entry !== owner)) {
    ctx.add({ file: other.src.rel, line: other.line, rule: 'single-flight-refresh', message: `a second place refreshes tokens (${other.how}; ${owner.src.rel} owns the refresh): two refreshes race, and a rotating server revokes the session`, fix: 'Refresh only inside the session manager (an interceptor asks it: renewAfterUnauthorized() through sendWithSession); a server refresh endpoint lives in a TokenRefresher (an *-adapter file or one typed TokenRefresher).' });
  }
  if (!isShared(owner.src)) {
    ctx.add({ file: owner.src.rel, line: owner.line, rule: 'single-flight-refresh', message: `the refresh is not shared (${owner.how}): callers that need a token at the same time each start one`, fix: 'Keep one in-flight refresh promise and hand it to every caller until it settles: singleFlight(refreshing, run) or refreshing ??= run().' });
  }
}

// sign-out-steps ---------------------------------------------------------------------------------
export function checkSignOutSteps(ctx) {
  const { contract } = ctx;
  if (contract === null) return;
  const factory = contract.data.sessionFactory ?? 'createSessionManager';
  const callRe = new RegExp(`(?<![\\w$.])${escapeRegExp(factory)}\\s*\\(`);
  const definesRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escapeRegExp(factory)}\\b`);
  const compositions = ctx.appFiles.filter((src) => callRe.test(src.masked) && !definesRe.test(src.masked));
  if (compositions.length === 0) {
    ctx.add({ file: contract.rel, line: lineOfText(contract.text, '"signOutSteps"'), rule: 'sign-out-steps', message: `nothing calls ${factory}(...): the session is never created, so no step can run at sign-out`, fix: `Create the session once in the app root with ${factory}({ ..., signOutSteps: [...] }) and render <SessionProvider>.` });
    return;
  }
  const lists = [
    { key: 'signOutSteps', names: contract.data.signOutSteps, harm: "the next person would see this person's data" },
    { key: 'serverSignOutSteps', names: contract.data.serverSignOutSteps ?? [], harm: 'the server keeps what belongs to this session (a push registration sends the next person this person\'s notifications)' },
  ];
  for (const { key, names, harm } of lists) {
    for (const name of names) {
      const literal = new RegExp(`(['"])${escapeRegExp(name)}\\1`);
      const made = new RegExp(`\\b${stepFactoryName(name)}\\s*\\(`);
      const wired = compositions.some((src) => literal.test(src.code) || made.test(src.masked));
      if (!wired) {
        const src = compositions[0];
        ctx.add({ file: src.rel, line: lineAt(src, src.masked.search(callRe)), rule: 'sign-out-steps', message: `${key} step "${name}" (contracts) is not passed to ${factory}: ${harm}`, fix: `Add { name: '${name}', run } or ${stepFactoryName(name)}(...) to ${key} where the session is created.` });
      }
    }
  }
}

// protected-groups -------------------------------------------------------------------------------
/** Where an opening JSX tag ends: the first `>` outside braces (so guard={a => b} does not end it). */
function tagEndOf(masked, start) {
  let depth = 0;
  for (let i = start; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i;
  }
  return masked.length - 1;
}

/** Every <X.Protected> element with its body, open and close tags matched by depth (guards nest). */
function protectedRegions(src) {
  const regions = [];
  const open = [];
  for (const match of src.masked.matchAll(/<(\/?)([A-Z][\w$]*)\.Protected\b/g)) {
    const [, slash, name] = match;
    if (slash === '') {
      const tagEnd = tagEndOf(src.masked, match.index);
      if (src.masked[tagEnd - 1] !== '/') open.push({ start: match.index, name, tag: src.text.slice(match.index, tagEnd + 1) });
      continue;
    }
    const at = open.findLastIndex((entry) => entry.name === name);
    if (at === -1) continue;
    for (const entry of open.splice(at)) regions.push({ ...entry, end: match.index });
  }
  for (const entry of open) regions.push({ ...entry, end: src.masked.length });
  return regions;
}

export function checkProtectedGroups(ctx) {
  const { contract } = ctx;
  if (contract === null) return;
  const protectedNames = new Set();
  for (const src of ctx.appFiles.filter((file) => /\.[jt]sx$/.test(file.rel))) {
    for (const region of protectedRegions(src)) {
      const body = src.text.slice(region.start, region.end);
      for (const screen of body.matchAll(/<[A-Z][\w$]*\.Screen\b[^>]*?\bname=(?:\{\s*)?(['"])([^'"]+)\1/g)) protectedNames.add(screen[2]);
      if (/\bredirectTo\s*=/.test(region.tag) && ctx.expoMajor !== null && ctx.expoMajor < 58) {
        ctx.add({ file: src.rel, line: lineAt(src, region.start), rule: 'protected-groups', message: `.Protected redirectTo needs Expo SDK 58 (this app is on ${ctx.expoMajor}): the prop is ignored`, fix: 'On SDK 57, order the screens so the first available one is the sign-in route (the default redirect).' });
      }
    }
  }
  const routes = ctx.layout.routesDir;
  for (const group of contract.data.protectedGroups) {
    const line = lineOfText(contract.text, `"${group}"`);
    const hasLayout = ['tsx', 'ts', 'jsx', 'js'].some((ext) => existsSync(join(ctx.root, routes, group, `_layout.${ext}`)));
    if (!hasLayout) {
      ctx.add({ file: contract.rel, line, rule: 'protected-groups', message: `${routes}/${group}/_layout.tsx is missing: without its own layout "${group}" is not one route, so a guard on it protects none of its screens`, fix: `Add ${routes}/${group}/_layout.tsx (a Stack) and guard <Stack.Screen name="${group}" />.` });
    }
    if (!protectedNames.has(group)) {
      ctx.add({ file: contract.rel, line, rule: 'protected-groups', message: `"${group}" is not inside a <Stack.Protected guard={...}>: a deep link opens it while signed out`, fix: `Wrap <Stack.Screen name="${group}" /> in <Stack.Protected guard={isSignedIn}> in the navigator that holds it.` });
    }
  }
  for (const route of contract.data.signedOutRoutes) {
    if (!protectedNames.has(route)) {
      ctx.add({ file: contract.rel, line: lineOfText(contract.text, `"${route}"`), rule: 'protected-groups', message: `"${route}" is not inside a .Protected guard: a signed-in person can navigate back to it`, fix: `Wrap <Stack.Screen name="${route}" /> in <Stack.Protected guard={isSignedOut}>.` });
    }
  }
}

// oauth-pkce, oauth-ephemeral --------------------------------------------------------------------
export function checkOAuth(ctx) {
  const shared = typeof ctx.contract?.data.oauthSharedBrowserSession === 'string' && ctx.contract.data.oauthSharedBrowserSession.trim() !== '';
  for (const src of ctx.appFiles) {
    const pkceOff = firstMatch(src, /\busePKCE\s*:\s*false\b/);
    if (pkceOff) ctx.add({ file: src.rel, line: pkceOff.line, rule: 'oauth-pkce', message: 'PKCE switched off: an intercepted redirect code can be exchanged by another app', fix: 'Keep usePKCE (the default) with CodeChallengeMethod.S256.' });
    const implicit = firstMatch(src, /\bResponseType\.(?:Token|IdToken)\b|\bresponseType\s*:\s*['"](?:token|id_token)['"]/);
    if (implicit) ctx.add({ file: src.rel, line: implicit.line, rule: 'oauth-pkce', message: 'the implicit flow returns tokens in the redirect URL', fix: 'Use ResponseType.Code with PKCE and exchange the code (exchangeCodeAsync).' });
    const secret = firstMatch(src, /\bclientSecret\s*:|\bclient_secret\b/);
    if (secret) ctx.add({ file: src.rel, line: secret.line, rule: 'oauth-pkce', message: 'a client secret in the app: anyone with the binary can read it', fix: 'Register the app as a public client (PKCE, no secret); a confidential exchange happens on the app server.' });
    for (const call of callsOf(src, 'exchangeCodeAsync')) {
      if (!/\bcode_verifier\b|\bcodeVerifier\b/.test(argText(src, call))) {
        ctx.add({ file: src.rel, line: lineAt(src, call.start), rule: 'oauth-pkce', message: 'exchangeCodeAsync without the PKCE verifier: expo-auth-session does not add it, so the provider refuses the code', fix: 'Pass extraParams: { code_verifier: request.codeVerifier }.' });
      }
    }
    if (shared) continue;
    for (const call of callsOf(src, 'promptAsync')) {
      if (!/\bpreferEphemeralSession\s*:\s*true\b/.test(argText(src, call))) {
        ctx.add({ file: src.rel, line: lineAt(src, call.start), rule: 'oauth-ephemeral', message: 'promptAsync shares the system browser\'s cookies: after sign-out the provider signs the last person straight back in', fix: 'Pass { preferEphemeralSession: true }, or give the reason in contracts/auth.json oauthSharedBrowserSession.' });
      }
    }
  }
}

// apple-sign-in ----------------------------------------------------------------------------------
export function checkAppleSignIn(ctx) {
  const importers = ctx.appFiles.filter((src) => importsOfPackage(src, 'expo-apple-authentication').length > 0);
  if (importers.length === 0) return;
  const config = ctx.config;
  const configured = config !== null && (/\busesAppleSignIn['"]?\s*:\s*true\b/.test(config.code) || /['"]expo-apple-authentication['"]/.test(config.code));
  if (!configured) {
    ctx.add({ file: config?.rel ?? 'app.config.ts', line: 1, rule: 'apple-sign-in', message: 'Sign in with Apple is not configured: the build lacks the com.apple.developer.applesignin entitlement and the sheet fails', fix: "Set ios.usesAppleSignIn: true (or list 'expo-apple-authentication' in plugins) in the app config." });
  }
  for (const src of importers) {
    for (const call of callsOf(src, 'signInAsync')) {
      if (!/\bnonce\s*:/.test(argText(src, call))) {
        ctx.add({ file: src.rel, line: lineAt(src, call.start), rule: 'apple-sign-in', message: 'signInAsync without a nonce: a captured identity token can be replayed to the server', fix: 'Pass nonce: SHA-256 of a fresh random value and send the raw value to the server, which compares.' });
      }
    }
    if (!src.code.includes('ERR_REQUEST_CANCELED')) {
      ctx.add({ file: src.rel, line: lineAt(src, importsOfPackage(src, 'expo-apple-authentication')[0].index), rule: 'apple-sign-in', message: 'a closed Apple sheet (ERR_REQUEST_CANCELED) is not told apart: the person sees an error for cancelling', fix: "Map code 'ERR_REQUEST_CANCELED' to a silent cancelled result." });
    }
  }
}

// secure-store-plugin ----------------------------------------------------------------------------
export function checkSecureStorePlugin(ctx) {
  if (ctx.secureStoreImporters.length === 0) return;
  const custom = ctx.contract?.data.customAndroidBackupRules;
  if (typeof custom === 'string') {
    if (!existsSync(join(ctx.root, custom))) {
      ctx.add({ file: ctx.contract.rel, line: lineOfText(ctx.contract.text, '"customAndroidBackupRules"'), rule: 'secure-store-plugin', message: `customAndroidBackupRules names ${custom}, which does not exist`, fix: 'Point it at the backup rules file that excludes the SecureStore shared preferences, or set it to null and list the plugin.' });
    }
    return;
  }
  const config = ctx.config;
  const listed = config !== null && /['"]expo-secure-store['"]/.test(config.code);
  if (!listed) {
    ctx.add({ file: config?.rel ?? 'app.config.ts', line: 1, rule: 'secure-store-plugin', message: "the expo-secure-store config plugin is not listed: Android Auto Backup restores encrypted values the new device's Keystore cannot decrypt", fix: "Add 'expo-secure-store' to plugins (configureAndroidBackup defaults to true)." });
  } else if (/\bconfigureAndroidBackup['"]?\s*:\s*false\b/.test(config.code)) {
    ctx.add({ file: config.rel, line: lineOfText(config.text, 'configureAndroidBackup'), rule: 'secure-store-plugin', message: 'configureAndroidBackup: false without the app\'s own backup rules', fix: 'Remove the option, or name the rules file that excludes SecureStore in contracts/auth.json customAndroidBackupRules.' });
  }
}

// account-deletion -------------------------------------------------------------------------------
export function checkAccountDeletion(ctx) {
  const { contract } = ctx;
  if (contract === null || contract.data.createsAccounts !== true) return;
  const route = contract.data.accountDeletionRoute;
  if (typeof route !== 'string' || !existsSync(join(ctx.root, route))) {
    ctx.add({ file: contract.rel, line: lineOfText(contract.text, '"accountDeletionRoute"'), rule: 'account-deletion', message: `the app creates accounts but ${typeof route === 'string' ? route + ' does not exist' : 'names no account deletion route'}: App Store guideline 5.1.1(v) and Google Play require deletion inside the app`, fix: 'Build a route that deletes the account on the server, then signs out with reason account-deleted; name it in accountDeletionRoute.' });
  }
}
