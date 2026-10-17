#!/usr/bin/env node
// check-auth.mjs: checks an Expo app's sign-in and secret storage against the auth-and-secure-storage
// rules: expo-secure-store, expo-auth-session and expo-apple-authentication only behind their adapters,
// one secure-store options object and a closed key list, no credential in plain storage, state stores,
// logs or URLs, a fresh-install wipe, one shared refresh, every sign-out step wired, protected route
// groups with their own layouts, OAuth with PKCE in an ephemeral session, Sign in with Apple with a
// nonce, Android backup rules for the secure store, and in-app account deletion.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-auth.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, resolveLayout, run, UsageError, walkRepo } from './check-lib.mjs';
import { AUTH_PACKAGES, importsOfPackage, lineOfText, loadSources, readAppConfig } from './lib/auth-source.mjs';
import {
  checkAccountDeletion,
  checkAppleSignIn,
  checkFreshInstallWipe,
  checkOAuth,
  checkProtectedGroups,
  checkSecureKeys,
  checkSecureStoreCalls,
  checkSecureStorePlugin,
  checkSignOutSteps,
  checkSingleFlightRefresh,
  checkTokenLeaks,
  checkVendorImports,
} from './lib/auth-rules.mjs';

const SPEC = {
  name: 'check-auth',
  summary: "Checks an Expo app's sign-in, session and secret storage against the auth-and-secure-storage rules.",
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The auth contract (default: rn-skills.config.json authContract, else <contractsDir>/auth.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (app code = files under srcDir and the routes folder; tests and test/ excluded):',
    '  vendor-import          expo-secure-store, expo-auth-session or expo-apple-authentication imported outside',
    '                         <servicesDir>/<concern>/*-adapter.ts, or by a second adapter',
    '  secure-store-call      in the secure-store adapter: sync getItem/setItem, an async call without the options',
    '                         object, ALWAYS accessibility, requireAuthentication: true without "// biometric-gate: <why>"',
    '  secure-keys            no `export const SECURE_KEYS`, a key expo-secure-store rejects or declared twice, nothing',
    '                         wiping ALL_SECURE_KEYS',
    '  token-storage          a credential name (also a bare token, jwt, credential) in a file that imports plain',
    '                         storage (expo-sqlite, kv-store, AsyncStorage, MMKV, expo-file-system)',
    '  token-in-state         the same names in a state store (<storesDir>/ or a zustand importer)',
    '  token-in-log           a credential, Authorization, Bearer, code_verifier or rawNonce in a console/record/',
    '                         capture/track call, or an argument named token, tokens, jwt, grant or credential',
    '  token-in-url           ?access_token= / #id_token= / &token= / code_verifier= in a string',
    '  fresh-install-wipe     no restore path that reads an install marker and wipes the secure keys',
    '  single-flight-refresh  a refresh outside adapters, fakes and TokenRefresher implementations (refresh*(<refresh',
    '                         token>), a refresh_token field, a /refresh or /oauth/token path in a string) in more',
    '                         than one file, or without a shared in-flight promise (singleFlight or ??=)',
    '  sign-out-steps         nothing calls the session factory, or a contract step (signOutSteps,',
    '                         serverSignOutSteps) is not passed to it',
    '                         (a step x-y is written \'x-y\' or made by xYStep(...))',
    '  protected-groups       a protected group without <routesDir>/<group>/_layout, a group or signed-out route',
    '                         outside every <X.Protected> (nested guards count), redirectTo before SDK 58',
    '  oauth-pkce             usePKCE: false, ResponseType.Token/IdToken, a client secret, exchangeCodeAsync without',
    '                         code_verifier',
    '  oauth-ephemeral        promptAsync without preferEphemeralSession: true (unless the contract gives a reason)',
    '  apple-sign-in          no usesAppleSignIn/plugin in the app config, signInAsync without nonce, no',
    '                         ERR_REQUEST_CANCELED handling',
    '  secure-store-plugin    the expo-secure-store plugin missing (Android backup rules), configureAndroidBackup: false',
    '                         without the app\'s own rules',
    '  account-deletion       createsAccounts without an existing accountDeletionRoute',
    '  contract               the auth contract missing or malformed, or "signIn": false while an app file imports',
    '                         expo-auth-session or expo-apple-authentication',
    '',
    'Secrets only: a contract with "signIn": false (expo-secure-store holds an API key or another secret, nobody',
    'signs in) runs the storage rules only: vendor-import, secure-store-call, secure-keys, the four leak rules,',
    'fresh-install-wipe, single-flight-refresh and secure-store-plugin.',
    '',
    'NOT APPLICABLE when none of expo-secure-store, expo-auth-session, expo-apple-authentication is in',
    'package.json or no app file imports one (sign-in is not built), AND the auth contract does not exist, AND the',
    'four leak rules (token-storage, token-in-state, token-in-log, token-in-url) find nothing; those four always run.',
    'rn-skills.config.json keys read: the layout keys srcDir, routesDir, servicesDir, storesDir, contractsDir, and',
    'authContract (the contract path). Installed skills (.agents/, .claude/, skills/, any folder with a SKILL.md)',
    'are never scanned.',
  ].join('\n'),
};

const CONTRACT_ARRAYS = ['protectedGroups', 'signedOutRoutes', 'signOutSteps'];

function readPackageJson(root) {
  const file = join(root, 'package.json');
  if (!existsSync(file)) throw new UsageError(`nothing to check: no package.json in ${root}`, 'Run from the app repo root (or pass it as the first argument).');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UsageError(`package.json is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
}

function expoMajorOf(manifest) {
  const spec = manifest.dependencies?.expo ?? manifest.devDependencies?.expo;
  const match = typeof spec === 'string' ? /(\d+)\./.exec(spec) : null;
  return match ? Number(match[1]) : null;
}

/** Reads and validates the contract; problems go to the report, a malformed file is bad input. */
function readContract(root, rel, report) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    report.problem({ file: rel, line: 1, rule: 'contract', message: 'the auth contract is missing: the checker cannot know the protected groups, sign-out steps or account deletion route', fix: "Copy the skill's templates/contracts/auth.json (and auth.schema.json) and fill in this app's facts; an app that keeps secrets but has no sign-in writes { \"signIn\": false }." });
    return null;
  }
  const text = readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, 'Fix the JSON syntax.');
  }
  let isValid = data !== null && typeof data === 'object' && !Array.isArray(data);
  if (isValid && data.signIn !== undefined && typeof data.signIn !== 'boolean') {
    report.problem({ file: rel, line: lineOfText(text, '"signIn"'), rule: 'contract', message: 'signIn must be true or false (or left out: true)', fix: 'false only when the app keeps secrets in expo-secure-store but has no sign-in.' });
    return null;
  }
  // Secrets only (no sign-in): the session facts do not exist, so they are not asked for.
  if (isValid && data.signIn === false) return { rel, text, data };
  for (const key of CONTRACT_ARRAYS) {
    const value = isValid ? data[key] : undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
      report.problem({ file: rel, line: lineOfText(text, `"${key}"`), rule: 'contract', message: `${key} must be a list of non-empty strings`, fix: 'Follow auth.schema.json.' });
      isValid = false;
    }
  }
  const server = isValid ? data.serverSignOutSteps : undefined;
  if (server !== undefined && (!Array.isArray(server) || server.some((entry) => typeof entry !== 'string' || entry === ''))) {
    report.problem({ file: rel, line: lineOfText(text, '"serverSignOutSteps"'), rule: 'contract', message: 'serverSignOutSteps must be a list of non-empty strings (or left out)', fix: 'Follow auth.schema.json.' });
    isValid = false;
  }
  if (isValid && typeof data.createsAccounts !== 'boolean') {
    report.problem({ file: rel, line: lineOfText(text, '"createsAccounts"'), rule: 'contract', message: 'createsAccounts must be true or false', fix: 'Say whether people can create an account in the app.' });
    isValid = false;
  }
  return isValid ? { rel, text, data } : null;
}

/** "signIn": false says there is no sign-in; an OAuth or Apple import says otherwise. */
function checkNoSignInPackages(ctx, importers) {
  const { contract } = ctx;
  for (const src of importers) {
    const pkg = ['expo-auth-session', 'expo-apple-authentication'].find((name) => importsOfPackage(src, name).length > 0);
    if (pkg === undefined) continue;
    ctx.add({ file: contract.rel, line: lineOfText(contract.text, '"signIn"'), rule: 'contract', message: `signIn is false, but ${src.rel} imports ${pkg}: the app signs people in, so the session rules (sign-out steps, protected groups, OAuth, Apple, account deletion) must run`, fix: 'Remove "signIn": false and fill in the sign-in facts (templates/contracts/auth.json).' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const manifest = readPackageJson(root);
  const report = createReporter({ name: 'check-auth', json: options.json });
  const layout = resolveLayout(root);
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const isApp = (rel) => rel.startsWith(`${layout.srcDir}/`) || rel.startsWith(`${layout.routesDir}/`);
  const rels = walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx'], ignore: ['**/*.d.ts'] }).filter(isApp);
  const sources = loadSources(root, rels);
  const appFiles = sources.filter((src) => !src.isTest);
  const importers = appFiles.filter((src) => AUTH_PACKAGES.some((pkg) => importsOfPackage(src, pkg).length > 0));
  const contractRel = options.contract ?? layout.config.authContract ?? `${layout.contractsDir}/auth.json`;
  const notBuilt = !AUTH_PACKAGES.some((pkg) => pkg in deps)
    ? `none of ${AUTH_PACKAGES.join(', ')} is in package.json`
    : importers.length === 0
      ? `no app file imports ${AUTH_PACKAGES.join(', ')} (sign-in is not built)`
      : null;
  if (notBuilt !== null && !existsSync(join(root, contractRel))) {
    // No auth package in use and no contract: the rest does not apply, but a hand-written sign-in
    // that keeps tokens in plain storage, a store, a log or a URL is still found.
    checkTokenLeaks({ layout, appFiles, add: (problem) => report.problem(problem) });
    if (report.count > 0) return report.finish({ checked: appFiles.length, unit: 'app files' });
    return report.notApplicable(`${notBuilt}, there is no ${contractRel}, and no credential leaks into plain storage, stores, logs or URLs`);
  }
  const ctx = {
    root,
    layout,
    appFiles,
    secureStoreImporters: appFiles.filter((src) => importsOfPackage(src, 'expo-secure-store').length > 0),
    contract: readContract(root, contractRel, report),
    config: readAppConfig(root),
    expoMajor: expoMajorOf(manifest),
    add: (problem) => report.problem(problem),
  };
  ctx.isSecretsOnly = ctx.contract?.data.signIn === false;
  checkVendorImports(ctx);
  checkSecureStoreCalls(ctx);
  checkSecureKeys(ctx);
  checkTokenLeaks(ctx);
  checkFreshInstallWipe(ctx);
  checkSingleFlightRefresh(ctx);
  checkSecureStorePlugin(ctx);
  if (ctx.isSecretsOnly) {
    checkNoSignInPackages(ctx, importers);
    return report.finish({ checked: appFiles.length, unit: 'app files' });
  }
  checkSignOutSteps(ctx);
  checkProtectedGroups(ctx);
  checkOAuth(ctx);
  checkAppleSignIn(ctx);
  checkAccountDeletion(ctx);
  return report.finish({ checked: appFiles.length, unit: 'app files' });
});
