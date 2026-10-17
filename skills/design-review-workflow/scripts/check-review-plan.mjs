#!/usr/bin/env node
// check-review-plan.mjs: proves the design-review plan (contracts/design-review.json) sweeps the
// whole app: every screen and state of the screen contract (each with the link that opens it), the
// themes, text directions and text sizes the app supports, a device per platform and window class,
// every declared motion moment, the release build, and the on-device steps on real hardware in a safe
// order. --list prints the shot list (one cell per line).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-review-plan.mjs [repo-root] [--list]

import { join } from 'node:path';

import { createReporter, notYetCreated, parseArgs, resolveLayout, run, toPosix, UsageError } from './check-lib.mjs';
import {
  appFacts,
  appLanguages,
  appThemes,
  COMBINATION_PARAMS,
  CORE_STEPS,
  debugLinkParams,
  DEFAULT_MOTION_CATALOG,
  DEVICE_NAME,
  isObject,
  jsonLine,
  KEBAB,
  KNOWN_RTL,
  loadPlan,
  MIN_WHY,
  momentIds,
  planCells,
  planShapeProblems,
  planVideos,
  REQUIRED_TEXT_SIZES,
  shippedPlatforms,
  sweptScreens,
  textSizeDevices,
  VARIANTS,
} from './lib/review-plan.mjs';

const SPEC = {
  name: 'check-review-plan',
  summary: 'Checks that contracts/design-review.json sweeps every screen, state, theme, direction, text size, device class and motion moment the app has, on the release build, and lists the cells.',
  usage: '[repo-root] [options]',
  options: {
    plan: { type: 'string', value: 'file', help: 'The plan file (default: <contractsDir>/design-review.json)' },
    list: { type: 'boolean', help: 'Also print every cell (<screen>.<state>--<theme>--<locale>--<text>--<device>) and motion video' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules: plan-invalid, plan-screens, plan-open, plan-themes, plan-locales, plan-text-sizes, plan-devices,',
    'plan-motion, plan-build, plan-device-pass. Exit 2 when the plan or the app config is missing.',
    'SKIP lines: contracts/screens.json (screen-contracts), src/ui/motion/motion-moments.ts (motion-and-animation),',
    'contracts/debug-links.json (debug-menu-and-test-hooks; only the link parameters wait for it),',
    'src/i18n/languages.ts (i18n-strings-and-catalogs; only the direction coverage waits for it).',
  ].join('\n'),
};

function checkScreens(root, loaded, report) {
  const swept = sweptScreens(root, loaded);
  const { rel, text, plan } = loaded;
  if (swept.missing) {
    const reason = notYetCreated(root, { file: swept.rel, owner: 'screen-contracts' });
    report.skip({ file: swept.rel, rule: 'plan-screens', message: reason ?? 'not found' });
    return null;
  }
  if (swept.error) {
    report.problem({ file: swept.rel, line: 1, rule: 'plan-screens', message: swept.error, fix: 'Fix the screen contract (screen-contracts owns its format).' });
    return null;
  }
  const ids = new Set(swept.all.map((s) => s?.id));
  for (const entry of Array.isArray(plan.screens.exclude) ? plan.screens.exclude : []) {
    const where = jsonLine(text, '"exclude"', `"${entry?.id}"`);
    if (typeof entry?.id !== 'string' || !ids.has(entry.id)) {
      report.problem({ file: rel, line: where, rule: 'plan-screens', message: `excluded screen "${entry?.id}" is not in ${swept.rel}`, fix: 'Exclude only screens the contract lists; delete stale exclusions.' });
    } else if (typeof entry.why !== 'string' || entry.why.trim().length < MIN_WHY) {
      report.problem({ file: rel, line: where, rule: 'plan-screens', message: `excluded screen "${entry.id}" has no reason (at least ${MIN_WHY} characters)`, fix: 'Say why a person never sees this screen in a shipped build, or sweep it.' });
    }
  }
  for (const entry of Array.isArray(plan.screens.invariant) ? plan.screens.invariant : []) {
    const where = jsonLine(text, '"invariant"', `"${entry.screen}"`);
    if (!swept.screens.some((s) => s.id === entry.screen)) {
      report.problem({ file: rel, line: where, rule: 'plan-screens', message: `invariant screen "${entry.screen}" is not a swept screen`, fix: 'Delete the stale entry.' });
    } else if (typeof entry.why !== 'string' || entry.why.trim().length < MIN_WHY) {
      report.problem({ file: rel, line: where, rule: 'plan-screens', message: `screen "${entry.screen}" is declared the same across ${entry.axis} without a reason (at least ${MIN_WHY} characters)`, fix: 'Say why the screen cannot change along that axis (no text, no colour), or drop the entry.' });
    }
  }
  if (swept.screens.length === 0) {
    report.problem({ file: swept.rel, line: 1, rule: 'plan-screens', message: 'the sweep covers no screen', fix: 'List the screens in the screen contract; exclude only what never ships.' });
    return null;
  }
  return swept.screens;
}

function parseQuery(value) {
  return value.split('&').filter(Boolean).map((pair) => {
    const at = pair.indexOf('=');
    return at === -1 ? { name: pair, value: '' } : { name: pair.slice(0, at), value: decodeURIComponent(pair.slice(at + 1)) };
  });
}

function checkOpenLinks(root, layout, loaded, screens, report) {
  const { rel, text, plan } = loaded;
  const open = plan.screens.open;
  const wanted = new Set(screens.flatMap((s) => s.states.map((state) => `${s.id}.${state}`)));
  const links = debugLinkParams(root, layout);
  let usesQuery = false;
  for (const key of wanted) {
    if (typeof open[key] !== 'string') {
      report.problem({ file: rel, line: jsonLine(text, '"open"'), rule: 'plan-open', message: `state "${key}" has no open link`, fix: `Add "${key}": the debug-link query that opens it (for example "open=tasks"), or an app path such as "/tasks/42"; every cell must be reproducible by anyone.` });
    }
  }
  for (const [key, value] of Object.entries(open)) {
    const line = jsonLine(text, '"open"', `"${key}"`);
    if (!wanted.has(key)) {
      report.problem({ file: rel, line, rule: 'plan-open', message: `open link "${key}" belongs to no swept screen state`, fix: 'Delete it, or add the state to the screen contract.' });
      continue;
    }
    if (value.startsWith('/')) continue;
    usesQuery = true;
    for (const { name, value: paramValue } of parseQuery(value)) {
      if (COMBINATION_PARAMS.includes(name)) {
        report.problem({ file: rel, line, rule: 'plan-open', message: `open link "${key}" sets "${name}", which every combination sets itself`, fix: `Drop "${name}=" from the link: the sweep sets ${COMBINATION_PARAMS.join(', ')} per combination.` });
      } else if (links.params) {
        const param = links.params[name];
        if (!param) report.problem({ file: rel, line, rule: 'plan-open', message: `open link "${key}" uses "${name}", which ${links.rel} does not declare`, fix: 'Use a declared parameter, or add it to the debug-link registry first (debug-menu-and-test-hooks).' });
        else if (Array.isArray(param.values) && !param.values.includes(paramValue)) {
          report.problem({ file: rel, line, rule: 'plan-open', message: `open link "${key}": "${name}=${paramValue}" is not one of ${param.values.join(', ')}`, fix: 'Use a declared value; a bad link opens nothing and the cell shows the wrong state.' });
        }
      }
    }
  }
  // Every combination opens debug/setup?lang=<locale>&theme=system&motion=still (review-cells.ts
  // combinationQuery), whatever the states' links are, so the contract is needed even without queries.
  if (links.missing) {
    const reason = notYetCreated(root, { file: links.rel, owner: 'debug-menu-and-test-hooks' });
    report.skip({ file: links.rel, rule: 'plan-open', message: reason ?? 'not found' });
  } else if (links.error) {
    report.problem({ file: links.rel, line: 1, rule: 'plan-open', message: links.error, fix: 'Fix the debug-link contract (debug-menu-and-test-hooks owns it).' });
  } else checkCombinationParams(loaded, links, report);
  return usesQuery;
}

/**
 * The combination link sets lang (each plan locale), theme=system and motion=still, and the motion
 * videos first send motion=system (review-cells.ts VIDEO_QUERY: the still override is saved and would
 * otherwise force reduced motion into the full-motion videos); a contract that does not declare
 * those values refuses those links, and the sweep captures nothing right.
 */
function checkCombinationParams(loaded, links, report) {
  const { params, rel: linksRel } = links;
  const needed = [
    { name: 'lang', values: loaded.plan.locales.map((l) => l.tag), why: 'the language of each combination' },
    { name: 'theme', values: ['system'], why: 'the app theme following the appearance the runner sets' },
    { name: 'motion', values: ['still', 'system'], why: 'animations held still for the stills, and back to the system setting for the motion videos' },
  ];
  for (const { name, values, why } of needed) {
    const param = params[name];
    const fix = `Declare "${name}" with ${values.map((v) => `"${v}"`).join(', ')} in the debug-link registry first (debug-menu-and-test-hooks); the debug link refuses a whole link with one unknown value.`;
    if (!isObject(param)) {
      report.problem({ file: linksRel, line: 1, rule: 'plan-open', message: `the sweep sets "${name}" on every combination (${why}), but ${linksRel} does not declare it`, fix });
      continue;
    }
    const missing = Array.isArray(param.values) ? values.filter((v) => !param.values.includes(v)) : [];
    if (missing.length > 0) {
      report.problem({ file: linksRel, line: 1, rule: 'plan-open', message: `the sweep sets ${missing.map((v) => `"${name}=${v}"`).join(', ')} on its combinations, but ${linksRel} allows only ${param.values.join(', ')}`, fix });
    }
  }
}

function checkThemes(loaded, facts, report) {
  const { rel, text, plan } = loaded;
  const wanted = appThemes(facts);
  const missing = wanted.filter((t) => !plan.themes.includes(t));
  const extra = plan.themes.filter((t) => !wanted.includes(t));
  const styles = facts.userInterfaceStyles.length > 0 ? facts.userInterfaceStyles.join(', ') : 'none (light)';
  if (missing.length > 0) {
    report.problem({ file: rel, line: jsonLine(text, '"themes"'), rule: 'plan-themes', message: `${facts.file} sets userInterfaceStyle ${styles}, but the plan leaves out ${missing.join(' and ')}`, fix: `Sweep ${wanted.join(' and ')}: every theme a person can see is a column of the matrix.` });
  }
  if (extra.length > 0) {
    report.problem({ file: rel, line: jsonLine(text, '"themes"'), rule: 'plan-themes', message: `the plan sweeps ${extra.join(' and ')}, which userInterfaceStyle ${styles} in ${facts.file} never shows`, fix: `Drop ${extra.join(' and ')}, or set userInterfaceStyle to "automatic" when the app really supports it.` });
  }
}

function checkLocales(root, loaded, found, report) {
  const { rel, text, plan } = loaded;
  let languages = null;
  if (found.missing) {
    const reason = notYetCreated(root, { file: found.rel, owner: 'i18n-strings-and-catalogs' });
    report.skip({ file: found.rel, rule: 'plan-locales', message: reason ?? 'not found' });
  } else if (found.error) {
    report.problem({ file: found.rel, line: 1, rule: 'plan-locales', message: `${found.error}, so the plan cannot be proved to sweep both text directions`, fix: 'Keep LANGUAGES (and RTL_LANGUAGES) plain literals: export const LANGUAGES = [\'en\', \'ar\'] as const (i18n-strings-and-catalogs owns the file).' });
  } else languages = found;
  for (const locale of plan.locales) {
    const line = jsonLine(text, `"tag": "${locale.tag}"`);
    if (languages && !languages.languages.includes(locale.tag)) {
      report.problem({ file: rel, line, rule: 'plan-locales', message: `locale "${locale.tag}" is not one of the app's languages (${languages.languages.join(', ')} in ${languages.rel})`, fix: 'Sweep only languages the app ships.' });
      continue;
    }
    const base = locale.tag.toLowerCase().split('-')[0];
    const isRtl = languages ? languages.rtl.has(locale.tag) : KNOWN_RTL.has(base);
    const expected = isRtl ? 'rtl' : 'ltr';
    if (locale.direction !== expected) {
      report.problem({ file: rel, line, rule: 'plan-locales', message: `locale "${locale.tag}" is ${expected}, the plan says ${locale.direction}`, fix: `Set "direction": "${expected}".` });
    }
  }
  if (!languages) return;
  const directions = new Set(plan.locales.map((l) => l.direction));
  if (languages.languages.some((tag) => languages.rtl.has(tag)) && !directions.has('rtl')) {
    report.problem({ file: rel, line: jsonLine(text, '"locales"'), rule: 'plan-locales', message: `the app ships a right-to-left language (${[...languages.rtl].join(', ')}) but the plan sweeps no rtl locale`, fix: 'Add one right-to-left locale: it is where layouts break most.' });
  }
  if (languages.languages.some((tag) => !languages.rtl.has(tag)) && !directions.has('ltr')) {
    report.problem({ file: rel, line: jsonLine(text, '"locales"'), rule: 'plan-locales', message: 'the app ships a left-to-right language but the plan sweeps no ltr locale', fix: 'Add the source language as an ltr locale.' });
  }
}

function checkTextSizes(loaded, report) {
  const { rel, text, plan } = loaded;
  const ids = new Set(plan.devices.map((d) => d.id));
  for (const size of plan.textSizes) {
    for (const id of Array.isArray(size.devices) ? size.devices : []) {
      if (!ids.has(id)) report.problem({ file: rel, line: jsonLine(text, `"id": "${size.id}"`), rule: 'plan-text-sizes', message: `text size "${size.id}" names device "${id}", which the plan does not list`, fix: 'Name a device id of "devices".' });
    }
  }
  for (const [id, values] of Object.entries(REQUIRED_TEXT_SIZES)) {
    const size = plan.textSizes.find((s) => s.id === id);
    if (!size) {
      report.problem({ file: rel, line: jsonLine(text, '"textSizes"'), rule: 'plan-text-sizes', message: `text size "${id}" is missing`, fix: `Add { "id": "${id}", "ios": "${values.ios}", "android": ${values.android} }.` });
      continue;
    }
    const line = jsonLine(text, `"id": "${id}"`);
    if (size.ios !== values.ios || size.android !== values.android) {
      report.problem({ file: rel, line, rule: 'plan-text-sizes', message: `text size "${id}" must be iOS "${values.ios}" and Android font_scale ${values.android} (found ${JSON.stringify(size.ios)} and ${JSON.stringify(size.android)})`, fix: `Use exactly those values: "${id}" means the ${id === 'largest' ? 'largest size a person can choose' : 'platform default'}, not a size the layout happens to survive.` });
    }
    const covered = new Set(textSizeDevices(plan, size));
    const needed = id === 'default' ? plan.devices : plan.devices.filter((d) => d.role === 'smallest-phone');
    for (const device of needed) {
      if (!covered.has(device.id)) {
        report.problem({ file: rel, line, rule: 'plan-text-sizes', message: `text size "${id}" leaves out device "${device.id}"`, fix: id === 'default' ? 'Sweep the default size on every device (drop its "devices" list).' : 'The largest size belongs on every smallest phone: that is where text clips first.' });
      }
    }
  }
}

function deviceRoleProblems(devices, platform, facts) {
  const own = devices.filter((d) => d.platform === platform);
  if (platform === 'web') return own.length === 0 ? ['a device (a phone-sized and a desktop browser window)'] : [];
  const wants = [];
  if (!own.some((d) => d.role === 'smallest-phone')) wants.push('a "smallest-phone" device (the smallest screen it supports)');
  const large = own.filter((d) => d.role === 'tablet' || d.role === 'foldable');
  if (platform === 'ios' && facts.supportsTablet && large.length === 0) wants.push('a "tablet" device (ios.supportsTablet is true)');
  else if (platform === 'ios' && facts.supportsTablet && !facts.requireFullScreen && facts.orientation !== 'landscape' && !large.some((d) => d.orientation === 'landscape')) {
    wants.push('an iOS tablet in landscape (with supportsTablet and no requireFullScreen, prebuild lists all four iPad orientations, so iPads rotate whatever "orientation" says)');
  }
  if (platform === 'android' && large.length === 0) wants.push('a "tablet" or "foldable" device (Android runs every app on large screens)');
  else if (platform === 'android' && !large.some((d) => d.orientation === 'landscape')) {
    wants.push('a large-screen device in landscape (Android 16 ignores the orientation lock at 600 dp and wider for apps targeting API 36)');
  }
  return wants;
}

function checkDevices(loaded, facts, report) {
  const { rel, text, plan } = loaded;
  const shipped = shippedPlatforms(facts);
  const devicesLine = jsonLine(text, '"devices"');
  for (const platform of shipped) {
    for (const want of deviceRoleProblems(plan.devices, platform, facts)) {
      report.problem({ file: rel, line: devicesLine, rule: 'plan-devices', message: `${platform}: the plan needs ${want}`, fix: 'Add the device, or set "orientation": "landscape" on the large screen (or add a second one in landscape), with its model and its own simulator or emulator name (references/sweep-matrix.md lists models and why).' });
    }
  }
  const landscape = plan.devices.filter((d) => d.orientation === 'landscape');
  if (facts.orientation === 'landscape') {
    for (const device of plan.devices.filter((d) => d.orientation !== 'landscape' && !(d.platform === 'android' && d.role !== 'smallest-phone' && d.role !== 'phone'))) {
      report.problem({ file: rel, line: jsonLine(text, `"id": "${device.id}"`), rule: 'plan-devices', message: `${facts.file} locks the app to landscape, but device "${device.id}" is swept in portrait`, fix: 'Set "orientation": "landscape".' });
    }
  } else if (facts.orientation !== 'portrait' && landscape.length === 0) {
    report.problem({ file: rel, line: devicesLine, rule: 'plan-devices', message: `${facts.file} does not lock the orientation, but no device is swept in landscape`, fix: 'Add a tablet or phone with "orientation": "landscape" (rotation is a layout of its own), or lock the orientation.' });
  }
  const names = new Set();
  for (const device of plan.devices) {
    const line = jsonLine(text, `"id": "${device.id}"`);
    if (!shipped.includes(device.platform)) {
      report.problem({ file: rel, line, rule: 'plan-devices', message: `device "${device.id}" is ${device.platform}, which the app does not ship (platforms: ${shipped.join(', ')})`, fix: 'Drop the device, or add the platform to the app config.' });
    }
    if (device.platform === 'ios' && device.role === 'tablet' && !facts.supportsTablet) {
      report.problem({ file: rel, line, rule: 'plan-devices', message: `device "${device.id}" is an iOS tablet, but ios.supportsTablet is not true in ${facts.file}`, fix: 'Drop it (iPads run the phone app scaled), or set supportsTablet and design for it.' });
    }
    if (device.platform === 'web') continue;
    if (typeof device.name !== 'string' || !DEVICE_NAME.test(device.name) || ['booted', 'all'].includes(device.name)) {
      report.problem({ file: rel, line, rule: 'plan-devices', message: `device "${device.id}" needs "name": its own simulator or emulator, named <project>-<purpose> (found ${JSON.stringify(device.name)})`, fix: 'Name a device this review creates and owns, for example "tasks-review-phone"; never "booted" or a shared one.' });
    } else if (names.has(device.name)) {
      report.problem({ file: rel, line, rule: 'plan-devices', message: `two devices share the simulator or emulator "${device.name}"`, fix: 'Give each device its own name: a device holds one model, appearance and text size at a time.' });
    }
    names.add(device.name);
  }
}

function checkMotion(root, loaded, report) {
  const { rel, text, plan, motionCatalog } = loaded;
  const ids = momentIds(root, motionCatalog);
  const record = Array.isArray(plan.motion?.record) ? plan.motion.record : [];
  const notRecorded = Array.isArray(plan.motion?.notRecorded) ? plan.motion.notRecorded : [];
  if (ids === null) {
    if (motionCatalog === DEFAULT_MOTION_CATALOG) {
      const reason = notYetCreated(root, { file: motionCatalog, owner: 'motion-and-animation' });
      report.skip({ file: motionCatalog, rule: 'plan-motion', message: reason ?? 'not found' });
    } else {
      report.problem({ file: rel, line: jsonLine(text, '"catalog"'), rule: 'plan-motion', message: `motion catalog ${motionCatalog} not found`, fix: 'Point "motion.catalog" at the moment catalog, or drop the key for the default.' });
    }
    return;
  }
  const known = new Set(ids);
  const covered = new Set();
  for (const id of record) {
    if (!known.has(id)) report.problem({ file: rel, line: jsonLine(text, '"record"', `"${id}"`), rule: 'plan-motion', message: `recorded moment "${id}" is not in ${motionCatalog}`, fix: 'Record only declared moments; declare a new one in the catalog first (motion-and-animation).' });
    covered.add(id);
  }
  for (const entry of notRecorded) {
    const line = jsonLine(text, '"notRecorded"', `"${entry?.id}"`);
    if (!known.has(entry?.id)) report.problem({ file: rel, line, rule: 'plan-motion', message: `moment "${entry?.id}" in notRecorded is not in ${motionCatalog}`, fix: 'Delete the stale entry.' });
    else if (typeof entry.why !== 'string' || entry.why.trim().length < MIN_WHY) report.problem({ file: rel, line, rule: 'plan-motion', message: `moment "${entry.id}" is not recorded and gives no reason (at least ${MIN_WHY} characters)`, fix: 'Record it, or say which recorded video shows it.' });
    if (covered.has(entry?.id)) report.problem({ file: rel, line, rule: 'plan-motion', message: `moment "${entry.id}" is both recorded and not recorded`, fix: 'Keep one.' });
    covered.add(entry?.id);
  }
  for (const id of ids) {
    if (!covered.has(id)) report.problem({ file: rel, line: jsonLine(text, '"motion"'), rule: 'plan-motion', message: `moment "${id}" of ${motionCatalog} is neither recorded nor listed in notRecorded`, fix: 'Add it to "record" (a video at full and reduced motion per platform), or to "notRecorded" with the reason.' });
  }
}

function checkBuild(loaded, usesQuery, report) {
  const { rel, text, plan } = loaded;
  const line = jsonLine(text, '"build"');
  if (!VARIANTS.includes(plan.build.variant)) {
    const production = plan.build.variant === 'production';
    report.problem({
      file: rel,
      line,
      rule: 'plan-build',
      message: production
        ? `the sweep runs on a production build, which strips the debug link every combination is set through (language, theme, motion held still)${usesQuery ? ' and the states\' open links' : ''}`
        : `the sweep runs on variant ${JSON.stringify(plan.build.variant)}`,
      fix: 'Use "preview": the same Release JavaScript, with the test-only debug link kept; the store build is judged in the on-device pass. Never the development client.',
    });
  }
}

function checkDevicePass(loaded, facts, report) {
  const { rel, text, plan } = loaded;
  const { steps, hardware } = plan.devicePass;
  const ids = new Set();
  let seenDestructive = null;
  for (const step of steps) {
    const line = jsonLine(text, '"steps"', `"${step?.id}"`);
    if (typeof step?.id !== 'string' || !KEBAB.test(step.id) || typeof step.destructive !== 'boolean') {
      report.problem({ file: rel, line, rule: 'plan-device-pass', message: `step ${JSON.stringify(step)} needs a kebab-case "id" and "destructive": true|false`, fix: 'Follow the template.' });
      continue;
    }
    if (ids.has(step.id)) report.problem({ file: rel, line, rule: 'plan-device-pass', message: `step "${step.id}" is listed twice`, fix: 'Keep one.' });
    ids.add(step.id);
    const core = CORE_STEPS.find((c) => c.id === step.id);
    if (core && core.destructive !== step.destructive) {
      report.problem({ file: rel, line, rule: 'plan-device-pass', message: `step "${step.id}" ${core.destructive ? 'destroys the state before it' : 'is not destructive'}; the plan says destructive: ${step.destructive}`, fix: `Set "destructive": ${core.destructive}.` });
    }
    if (step.destructive) seenDestructive ??= step.id;
    else if (seenDestructive) {
      report.problem({ file: rel, line, rule: 'plan-device-pass', message: `step "${step.id}" comes after the destructive step "${seenDestructive}"`, fix: 'Move every destructive step (upgrade, restore, crash, reinstall) to the end, so no other step has to be redone.' });
    }
  }
  for (const core of CORE_STEPS) {
    if (!ids.has(core.id)) report.problem({ file: rel, line: jsonLine(text, '"steps"'), rule: 'plan-device-pass', message: `core step "${core.id}" is missing`, fix: 'Keep every core step; a step that does not apply is answered "n/a" with its reason in the record, never removed from the plan.' });
  }
  const hardwareIds = new Set();
  for (const item of hardware) {
    const line = jsonLine(text, '"hardware"', `"${item?.id}"`);
    if (typeof item?.id !== 'string' || !KEBAB.test(item.id) || !['ios', 'android'].includes(item.platform) || typeof item.model !== 'string' || item.model.trim() === '') {
      report.problem({ file: rel, line, rule: 'plan-device-pass', message: `hardware ${JSON.stringify(item)} needs a kebab-case "id", "platform" (ios or android) and the "model"`, fix: 'Name the real phone the pass runs on, for example { "id": "android-budget", "platform": "android", "model": "a budget phone of the target market" }.' });
      continue;
    }
    if (hardwareIds.has(item.id)) report.problem({ file: rel, line, rule: 'plan-device-pass', message: `hardware "${item.id}" is listed twice`, fix: 'Keep one.' });
    hardwareIds.add(item.id);
  }
  for (const platform of shippedPlatforms(facts).filter((p) => p !== 'web')) {
    if (!hardware.some((h) => h?.platform === platform)) {
      report.problem({ file: rel, line: jsonLine(text, '"hardware"'), rule: 'plan-device-pass', message: `no real ${platform} hardware for the on-device pass`, fix: 'Add the cheapest phone of the target market for that platform: simulators and emulators hide audio, haptics, fonts, memory pressure and real settings.' });
    }
  }
}

await run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const layout = resolveLayout(root);
  const loaded = loadPlan(root, layout, options.plan);
  const facts = appFacts(root);
  if (!facts) throw new UsageError('nothing to check: no app.config.ts, app.config.js or app.json', 'Run from the app repo root (or pass it as the first argument).');
  const report = createReporter({ name: 'check-review-plan', json: options.json });
  if (facts.computed.length > 0) {
    report.note(`${facts.file}: ${facts.computed.join(', ')} computed, not a literal (or a const of one in the same file), so read as absent; keep them literal (references/failure-messages.md, "App config facts")`);
  }
  const shape = planShapeProblems(loaded);
  for (const problem of shape) report.problem(problem);
  if (shape.length > 0) return report.finish({ checked: 1, unit: 'plan' });
  const screens = checkScreens(root, loaded, report);
  const usesQuery = screens ? checkOpenLinks(root, layout, loaded, screens, report) : false;
  checkThemes(loaded, facts, report);
  checkLocales(root, loaded, appLanguages(root, layout), report);
  checkTextSizes(loaded, report);
  checkDevices(loaded, facts, report);
  checkMotion(root, loaded, report);
  checkBuild(loaded, usesQuery, report);
  checkDevicePass(loaded, facts, report);
  if (screens) {
    const cells = planCells(loaded.plan, screens);
    const videos = planVideos(loaded.plan);
    report.note(`plan: ${screens.length} screens, ${cells.length} cells, ${videos.length} motion videos (captures in ${toPosix(join(loaded.capturesDir, '<review-id>'))})`);
    if (options.list) {
      for (const cell of cells) report.note(`cell ${cell.name}.png`);
      for (const video of videos) report.note(`video motion/${video}.mp4`);
    }
  }
  return report.finish({ checked: 1, unit: 'plan' });
});
