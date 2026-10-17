#!/usr/bin/env node
// check-push.mjs: checks an Expo app's remote push notifications against the push-notifications
// rules: one adapter owns expo-notifications' push APIs, the permission is asked in context only,
// tokens carry an explicit EAS project id and are re-registered on rotation, the Android channels
// and the data kinds equal contracts/push.json, payloads are parsed and never navigated to, taps are
// handled at cold start and while running, one foreground handler, no deprecated API, the plugin and
// FCM configured, the registration removed at sign-out, the pieces wired, no push sending or push
// credential in the app.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-push.mjs [repo-root]

import { join } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import {
  checkAdapterOnly,
  checkChannelContract,
  checkChannelSetup,
  checkClientSend,
  checkContract,
  checkCredentials,
  checkDeprecated,
  checkFcmConfig,
  checkForegroundHandler,
  checkKindsContract,
  checkPayload,
  checkPermissionInContext,
  checkPluginConfig,
  checkRequiresAccount,
  checkProjectId,
  checkSignOut,
  checkTapHandling,
  checkTokenRequested,
  checkTokenRotation,
  checkWiring,
  isUsableContract,
} from './lib/push-rules.mjs';
import { TOKEN_APIS, apiUses, loadSources, readAppConfig, readJsonFile, readTextIfExists } from './lib/push-source.mjs';

const SPEC = {
  name: 'check-push',
  summary: "Checks an Expo app's remote push notifications against the push-notifications rules.",
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The push contract (default: rn-skills.config.json pushContract, else <contractsDir>/push.json)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (app code = .ts/.tsx under srcDir, tests excluded; a push adapter = <servicesDir>/**/*-adapter.ts):',
    '  push-contract          push tokens are requested but the contract is missing, not JSON, or malformed',
    '  push-token             the contract exists but no app code requests a push token',
    '  push-adapter-only      an expo-notifications token, permission, handler or response API outside a push adapter',
    '  permission-in-context  requestPermission/requestPermissionsAsync/optInToPush in a startup file (root',
    '                         _layout, root-navigator, the composition root) or inside an effect',
    '  expo-project-id        (provider expo) getExpoPushTokenAsync without projectId, or no projectId in the app config',
    '  token-rotation         a token is fetched but addPushTokenListener is never used',
    '  channel-setup          no setNotificationChannelAsync anywhere in app code',
    '  channel-contract       PUSH_CHANNELS (ids, order, importance) differs from the contract channels',
    '  kinds-contract         PUSH_KINDS differs from the contract kinds, or the message file never parses',
    '  payload-parse          notification content.data read outside a push adapter',
    '  payload-navigation     router.push/replace/navigate/dismissTo, Linking.openURL or openBrowserAsync with a',
    '                         payload field (data.url, data.href, data.route, data.screen, content.data, ...)',
    '  tap-handling           no launch-tap read, no response listener, or no clearLastNotificationResponse',
    '  foreground-handler     no setNotificationHandler, or more than one',
    '  deprecated-api         shouldShowAlert, getLastNotificationResponseAsync, clearLastNotificationResponseAsync',
    '  plugin-config          the expo-notifications plugin missing, without options, or without icon, mode or the',
    '                         contract defaultChannel',
    '  fcm-config             no android.googleServicesFile in the app config',
    '  sign-out-unregister    (requiresAccount) contracts/auth.json serverSignOutSteps lacks push-registration',
    '  push-wiring            createPushRegistration, usePushSync, usePushTaps or createPushKit (the root kit the',
    '                         registry src/services/create-root-kits.ts creates) defined but never called; a',
    '                         literal requiresAccount passed to createPushRegistration differs from the contract',
    '  client-send            app code reaches a push send API (Expo, FCM, APNs) or imports expo-server-sdk',
    '  push-credentials       a .p8/.p12 key, a Google service account key, or a push token in an EXPO_PUBLIC_',
    '                         variable anywhere in the repo (installed skills and build output excluded)',
    '',
    'SKIP: sign-out-unregister while contracts/auth.json does not exist (auth-and-secure-storage creates it).',
    'A repo that requests push tokens without any app config (app.config.ts/.js/.mjs, app.json) fails plugin-config.',
    'NOT APPLICABLE when expo-notifications is not in package.json, or when no app code requests a push token',
    'and the push contract does not exist (local notifications only: local-notifications).',
    'rn-skills.config.json keys read: the layout keys srcDir, routesDir, featuresDir, servicesDir, testDir,',
    'contractsDir, and pushContract (the contract path).',
  ].join('\n'),
};

function hasExpoNotifications(root) {
  const text = readTextIfExists(join(root, 'package.json'));
  if (text === null) fail(`nothing to check: ${root} has no package.json`, 'Pass the root of an Expo app.');
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (error) {
    fail(`package.json is not valid JSON: ${error.message}`, 'Fix package.json.');
  }
  return Boolean(pkg.dependencies?.['expo-notifications'] ?? pkg.devDependencies?.['expo-notifications']);
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-push', json: options.json });
  const layout = resolveLayout(root);
  if (!hasExpoNotifications(root)) return report.notApplicable('expo-notifications is not in package.json');

  const contractRel = options.contract ?? layout.config.pushContract ?? `${layout.contractsDir}/push.json`;
  const sources = loadSources(root, layout);
  const app = sources.filter((src) => !src.isTest);
  const tokenUsers = app.flatMap((src) => apiUses(src, TOKEN_APIS).map((use) => ({ ...use, src })));
  const contract = readJsonFile(root, contractRel);
  if (tokenUsers.length === 0 && contract === null) {
    return report.notApplicable(`expo-notifications is installed but no app code requests a push token and ${contractRel} does not exist (local notifications only)`);
  }

  const ctx = {
    root,
    layout,
    sources,
    app,
    tokenUsers,
    contract,
    contractRel,
    authContract: readJsonFile(root, `${layout.contractsDir}/auth.json`),
    appConfig: readAppConfig(root),
    add: (problem) => report.problem(problem),
    skip: (entry) => report.skip(entry),
  };

  if (tokenUsers.length > 0) checkContract(ctx);
  checkTokenRequested(ctx);
  checkAdapterOnly(ctx);
  checkPermissionInContext(ctx);
  checkPayload(ctx);
  checkDeprecated(ctx);
  checkClientSend(ctx);
  checkCredentials(ctx);
  checkWiring(ctx);
  if (tokenUsers.length > 0) {
    checkTokenRotation(ctx);
    checkChannelSetup(ctx);
    checkTapHandling(ctx);
    checkForegroundHandler(ctx);
  }
  if (isUsableContract(contract)) {
    checkProjectId(ctx);
    checkChannelContract(ctx);
    checkKindsContract(ctx);
    checkPluginConfig(ctx);
    checkFcmConfig(ctx);
    checkSignOut(ctx);
    checkRequiresAccount(ctx);
  } else if (contract !== null && tokenUsers.length === 0) {
    checkContract({ ...ctx, tokenUsers: [{ src: { rel: contract.rel, text: contract.text }, index: 0, api: 'contract' }] });
  }
  if (ctx.appConfig === null && tokenUsers.length > 0) {
    report.problem({ file: 'app.config.ts', line: 1, rule: 'plugin-config', message: 'no app config (app.config.ts, app.config.js or app.json) found', fix: 'Create app.config.ts (expo-project-bootstrap) with the expo-notifications plugin.' });
  }
  return report.finish({ checked: sources.length, unit: 'files' });
});
