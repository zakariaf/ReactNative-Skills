// ads-rules.mjs: check-ads.mjs's rules for the ads module, its wiring and placements. Each takes the
// scan context (lib/ads-facts.mjs) and the reporter. Not an entry point.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { maskComments } from '../check-lib.mjs';
import { APP_ID, FACTS, SDK, UNIT_ID } from './ads-facts.mjs';
import { callRanges, importsModule, isTestFile, lineAt, localFunctionsMatching, matchingParen, parseImports, readRepoJson, readRepoText } from './repo-scan.mjs';

const read = (ctx, rel) => (existsSync(join(ctx.root, rel)) ? maskComments(readRepoText(ctx.root, rel)) : null);

/** Source rules over app code: banner size, error codes, the sample and real IDs, ads in effects. */
export function checkSourceRules(ctx, report) {
  const idsFile = `${ctx.layout.configDir}/admob-ids.ts`;
  const sampleAllowed = `${ctx.layout.configDir}/ads-config.ts`;
  for (const rel of ctx.runtime) {
    const raw = ctx.sources.get(rel);
    const text = ctx.masked.get(rel);
    const isTest = isTestFile(rel);
    const add = (index, rule, message, fix) => report.problem({ file: rel, line: lineAt(text, index), rule, message, fix });
    for (const match of text.matchAll(/(?<!LARGE_)\bANCHORED_ADAPTIVE_BANNER\b/g)) add(match.index, 'deprecated-banner-size', 'ANCHORED_ADAPTIVE_BANNER is deprecated in 17.2.0', 'Use BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER (typescript-eslint no-deprecated flags the old one).');
    if (isTest) continue;
    if (rel.startsWith(`${ctx.adsDir}/`) || rel.startsWith(`${ctx.consentDir}/`)) {
      for (const match of text.matchAll(/\.code\b/g)) add(match.index, 'error-code-branch', 'reads error.code', 'Branch on error.phase, then error.reason (code is deprecated in 17.2.0 and removed in v18).');
    }
    if (rel !== `${ctx.adsDir}/ad-moments.ts`) {
      // The ad calls, plus same-file helpers that make one (one step: `finishReview()` calling
      // showInterstitialIfDue). Effects and app-resume listeners may call neither.
      const adCalls = ['showInterstitialIfDue', 'earnRewardedPerk', 'showInterstitial', 'showRewarded'];
      const helpers = localFunctionsMatching(text, new RegExp(`\\b(?:${adCalls.join('|')})\\s*\\(`)).filter((name) => !adCalls.includes(name));
      const unprompted = [
        ...callRanges(text, ['useEffect', 'useLayoutEffect', 'useFocusEffect', 'useInsertionEffect']).map((range) => ({ ...range, where: `${range.name}()` })),
        ...[...text.matchAll(/\bAppState\s*\.\s*addEventListener\s*\(/g)].map((match) => {
          const start = match.index + match[0].length - 1;
          return { start, end: matchingParen(text, start), where: 'an AppState listener (an app-resume ad)' };
        }).filter((range) => range.end !== -1),
      ];
      for (const range of unprompted) {
        const body = text.slice(range.start, range.end);
        for (const call of [...adCalls, ...helpers]) {
          const at = body.search(new RegExp(`\\b${call.replace(/\$/g, '\\$')}\\s*\\(`));
          if (at === -1) continue;
          const what = adCalls.includes(call) ? `${call}()` : `${call}(), which shows an ad,`;
          add(range.start + at, 'ad-in-effect', `${what} runs inside ${range.where}`, 'Call it only from the press handler that leaves a natural break, or from the user\'s "Watch an ad" press: an effect or a resume listener shows the ad over the screen the user just reached.');
        }
      }
    }
    if (rel !== sampleAllowed) {
      for (const match of raw.matchAll(new RegExp(FACTS.samplePublisher, 'g'))) add(match.index, 'sample-id', "Google's sample publisher ID in app code", 'Read TestIds.* in the adapter (units: \'test\') and GOOGLE_SAMPLE_APP_IDS in ads-config.ts; never type test IDs.');
    }
    if (rel !== idsFile) {
      for (const match of raw.matchAll(/ca-app-pub-\d{16}[~/]\d{10}/g)) {
        if (!match[0].includes(FACTS.samplePublisher)) add(match.index, 'hard-coded-id', `AdMob ID ${match[0]} in app code`, `Real IDs live only in ${idsFile} and reach the app through expo.extra.adUnits in live builds.`);
      }
    }
  }
}

// Real unit IDs reach the app only in live builds, through expo.extra: no app code imports the IDs.
export function checkIdsImport(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.layout.configDir}/`))) {
    for (const imp of parseImports(ctx.sources.get(rel))) {
      if (imp.isType || !importsModule(imp.specifier, 'admob-ids.ts')) continue;
      report.problem({ file: rel, line: imp.line, rule: 'ids-import', message: 'app code imports the AdMob IDs', fix: 'Only app.config.ts reads src/config/admob-ids.ts; the app gets its units from readAdsExtraForBinary() (expo.extra.adUnits, live builds only), so test builds never carry the real IDs.' });
    }
  }
}

// The audience decides the request configuration: general -> the rating, no child tags;
// child-directed -> rating G, both tags, and Android's AD_ID permission blocked.
export function checkContentRating(ctx, contract, report) {
  const adapter = `${ctx.adsDir}/admob-ads-adapter.ts`;
  const text = read(ctx, adapter);
  const audience = contract?.audience ?? 'general';
  const rating = audience === 'child-directed' ? 'G' : contract?.maxAdContentRating ?? 'PG';
  if (text !== null && !new RegExp(`maxAdContentRating\\s*:\\s*MaxAdContentRating\\.${rating}\\b`).test(text)) {
    report.problem({ file: adapter, rule: 'content-rating', message: `the request configuration does not set maxAdContentRating: MaxAdContentRating.${rating}`, fix: `Set it in REQUEST_CONFIGURATION (before initialize), equal to contracts/ads.json and the AdMob console's maximum ad content rating.` });
  }
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file))) {
    const code = ctx.masked.get(rel);
    for (const match of code.matchAll(new RegExp(`\\b(${FACTS.alwaysBannedRequestOptions.join('|')})\\b`, 'g'))) {
      report.problem({ file: rel, line: lineAt(code, match.index), rule: 'content-rating', message: `${match[1]} is set`, fix: 'Remove it: UMP writes the TCF consent string the SDK reads; a hand-set flag contradicts the user\'s choice.' });
    }
    for (const match of code.matchAll(new RegExp(`\\b(${FACTS.androidDroppedRequestOptions.join('|')})\\s*:`, 'g'))) {
      report.problem({ file: rel, line: lineAt(code, match.index), rule: 'content-rating', message: `${match[1]} is set, and react-native-google-mobile-ads ${FACTS.sdk.version} drops it on Android (the enum sends "child", the Android module matches only "CHILD")`, fix: audience === 'child-directed' ? 'Remove it and keep tagForChildDirectedTreatment: true and tagForUnderAgeOfConsent: true (references/consent-flow.md, Audience).' : 'Remove it: a general audience sets the rating only (references/consent-flow.md, Audience).' });
    }
    if (audience !== 'general') continue;
    for (const match of code.matchAll(new RegExp(`\\b(${FACTS.childTags.join('|')})\\b`, 'g'))) {
      report.problem({ file: rel, line: lineAt(code, match.index), rule: 'content-rating', message: `${match[1]} is set for a general audience`, fix: 'Remove it, or record "audience": "child-directed" in contracts/ads.json and follow the child-directed profile (rating G, both tags, AD_ID blocked).' });
    }
  }
  if (audience !== 'child-directed' || text === null) return;
  for (const tag of FACTS.childTags.filter((name) => !new RegExp(`\\b${name}\\s*:\\s*true\\b`).test(text))) {
    report.problem({ file: adapter, rule: 'content-rating', message: `a child-directed app does not set ${tag}: true`, fix: 'Add it to REQUEST_CONFIGURATION, before initialize.' });
  }
  const configText = ctx.config.map((rel) => ctx.masked.get(rel)).join('\n');
  if (!/\bblockedPermissions\b/.test(configText) || !configText.includes(FACTS.adIdPermission)) {
    const appConfig = ctx.config.find((rel) => rel.startsWith('app.config')) ?? 'app.config.ts';
    report.problem({ file: appConfig, rule: 'content-rating', message: `a child-directed app does not block ${FACTS.adIdPermission}`, fix: `Add android.blockedPermissions: ['${FACTS.adIdPermission}'] to the app config: the ads SDK and expo-tracking-transparency both declare it, and apps for children must not send the advertising ID.` });
  }
}

/** The adapter grants rewards only on EARNED_REWARD; the root mock knows the large banner size. */
export function checkAdapterContent(ctx, report) {
  const adapter = `${ctx.adsDir}/admob-ads-adapter.ts`;
  const text = read(ctx, adapter);
  if (text !== null && !/addAdEventListener\(\s*RewardedAdEventType\.EARNED_REWARD\b/.test(text)) {
    report.problem({ file: adapter, rule: 'reward-on-earned', message: 'no RewardedAdEventType.EARNED_REWARD listener', fix: 'Grant the reward only on EARNED_REWARD; CLOSED alone resolves "dismissed".' });
  }
  const mock = `${ctx.layout.mocksDir}/${SDK}.ts`;
  if (existsSync(join(ctx.root, mock)) && !readRepoText(ctx.root, mock).includes('LARGE_ANCHORED_ADAPTIVE_BANNER')) {
    report.problem({ file: mock, rule: 'root-mock', message: 'the root mock lacks BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER', fix: 'Copy the template mock; without the key a banner test passes undefined as the size.' });
  }
  for (const name of FACTS.purePolicyFiles) {
    const rel = `${ctx.adsDir}/${name}`;
    if (!existsSync(join(ctx.root, rel))) continue;
    const raw = readRepoText(ctx.root, rel);
    const code = maskComments(raw);
    for (const imp of parseImports(raw).filter((entry) => !entry.specifier.startsWith('./'))) {
      report.problem({ file: rel, line: imp.line, rule: 'pure-policy', message: `imports ${imp.specifier}`, fix: 'The ad policy is pure: import only its sibling policy modules; pass facts in as arguments.' });
    }
    for (const match of code.matchAll(/\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bMath\s*\.\s*random\b|\bperformance\s*\.\s*now\b/g)) {
      report.problem({ file: rel, line: lineAt(code, match.index), rule: 'pure-policy', message: `${match[0]} in the ad policy`, fix: 'Take nowMs from the ClockPort as an argument.' });
    }
  }
}

// The AdsPort reports where the rewarded ad stands, never a loaded flag: with a flag "not loaded"
// means both "still loading" and "cannot come", so an offer can neither show busy nor go away.
export function checkRewardedStatus(ctx, report) {
  const { statusType, members, retired } = FACTS.rewardedStatus;
  const port = `${ctx.adsDir}/ads-port.ts`;
  const adapter = `${ctx.adsDir}/admob-ads-adapter.ts`;
  const portText = read(ctx, port);
  if (portText !== null) {
    if (!new RegExp(`\\b${statusType}\\b`).test(portText)) report.problem({ file: port, rule: 'rewarded-status', message: `does not export ${statusType}`, fix: "Restore ads-port.ts from the template: export type RewardedStatus = 'loading' | 'ready' | 'unavailable'." });
    for (const member of members.filter((name) => !new RegExp(`\\b${name}\\s*:`).test(portText))) {
      report.problem({ file: port, rule: 'rewarded-status', message: `AdsPort has no ${member} member`, fix: 'Restore ads-port.ts from the template: rewardedStatus(): RewardedStatus and subscribeRewardedStatus(listener).' });
    }
  }
  const adapterText = read(ctx, adapter);
  for (const member of adapterText === null ? [] : members.filter((name) => !new RegExp(`\\b${name}\\s*:`).test(adapterText))) {
    report.problem({ file: adapter, rule: 'rewarded-status', message: `the adapter does not report ${member}`, fix: "Restore admob-ads-adapter.ts: a status cell set to 'loading' by a preload, 'ready' on LOADED, 'unavailable' on a load error, once shown and before initialize." });
  }
  for (const rel of ctx.runtime) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(new RegExp(`\\b(${retired.join('|')})\\b`, 'g'))) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'rewarded-status', message: `uses ${match[1]}, a loaded flag (it hides an offer that is still loading)`, fix: "Use AdsPort.rewardedStatus() and subscribeRewardedStatus(); rewardedOffer gives a waiting perk 'loading' while its ad loads and 'hidden' only when no ad can come." });
    }
  }
}

const appConfigOf = (ctx) => ctx.config.find((rel) => rel.startsWith('app.config')) ?? 'app.config.ts';

/** The plugin gets admobPluginOptions(...), never literals, so every build gets the right app ID. */
export function checkPluginEntry(ctx, report) {
  let hasEntry = false;
  let hasOther = false;
  for (const rel of ctx.config.filter((file) => !isTestFile(file))) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(new RegExp(`\\[\\s*['"]${SDK}['"]\\s*,`, 'g'))) {
      const window = text.slice(match.index, match.index + 240);
      if (/admobPluginOptions\s*\(/.test(window)) {
        hasEntry = true;
        continue;
      }
      hasOther = true;
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'plugin-entry', message: 'the AdMob plugin gets options that are not admobPluginOptions(...)', fix: "Pass ['react-native-google-mobile-ads', admobPluginOptions(adsMode, ADMOB_IDS, SKADNETWORK_IDS)]: the sample app ID in test and off builds, the app's own (checked) only in live builds, on both platforms." });
    }
  }
  if (!hasEntry && !hasOther) {
    report.problem({ file: appConfigOf(ctx), rule: 'plugin-entry', message: `no ['${SDK}', admobPluginOptions(...)] plugin entry in the app config`, fix: "Add ['react-native-google-mobile-ads', admobPluginOptions(adsMode, ADMOB_IDS, SKADNETWORK_IDS)] to the plugins, with adsMode = resolveAdsMode(process.env, variant): without an app ID the SDK stops the app at launch." });
  }
}

/** Real unit IDs reach expo.extra only through adsExtra() (live builds only, the key left out otherwise). */
export function checkUnitsExtra(ctx, report) {
  let hasExtra = false;
  for (const rel of ctx.config.filter((file) => !isTestFile(file) && file !== `${ctx.layout.configDir}/ads-config.ts`)) {
    const text = ctx.masked.get(rel);
    if (/\badsExtra\s*\(/.test(text)) hasExtra = true;
    for (const match of text.matchAll(/\badUnits\s*:/g)) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'extra-ad-units', message: 'expo.extra.adUnits is written without adsExtra()', fix: 'Spread ...adsExtra(adsMode, ADMOB_IDS) into extra: real IDs only in live builds, and never a null key (a null in extra arrives as {}).' });
    }
  }
  if (!hasExtra) report.problem({ file: appConfigOf(ctx), rule: 'extra-ad-units', message: 'the app config does not write expo.extra through adsExtra()', fix: 'extra: { ...config.extra, ...adsExtra(adsMode, ADMOB_IDS) }: the app reads adsMode (and the live units) with readAdsExtraForBinary(Application.applicationId).' });
}

export function checkSkadnetwork(ctx, report) {
  const rel = ctx.fill(FACTS.skadnetwork.file);
  const text = read(ctx, rel);
  if (text === null) return; // required-file reports it
  const ids = [...text.matchAll(/['"]([^'"]+)['"]/g)].map((match) => ({ id: match[1], line: lineAt(text, match.index) }));
  const pattern = new RegExp(FACTS.skadnetwork.idPattern);
  const malformed = ids.filter(({ id }) => !pattern.test(id));
  const fix = `Regenerate the list: node ${ctx.layout.scriptsDir}/ads/refresh-skadnetwork.ts`;
  if (malformed.length > 0) report.problem({ file: rel, line: malformed[0].line, rule: 'skadnetwork', message: `"${malformed[0].id}" is not a full SKAdNetwork identifier (${malformed.length} such entries)`, fix: `Each entry is "<10 characters>.skadnetwork". ${fix}.` });
  const seen = new Set();
  for (const { id, line } of ids) {
    if (seen.has(id)) report.problem({ file: rel, line, rule: 'skadnetwork', message: `duplicate "${id}"`, fix });
    seen.add(id);
  }
  if (ids.length < FACTS.skadnetwork.minCount) report.problem({ file: rel, rule: 'skadnetwork', message: `${ids.length} identifiers (Google lists at least ${FACTS.skadnetwork.minCount})`, fix });
  if (ids.length > 0 && malformed.length === 0 && ids[0].id !== FACTS.skadnetwork.first) report.problem({ file: rel, line: ids[0].line, rule: 'skadnetwork', message: `the list starts with "${ids[0].id}", not Google's first entry ${FACTS.skadnetwork.first}`, fix });
}

/** The app's IDs keep AdMob's format on both platforms; never Google's sample, never an unfilled token. */
export function checkAppIds(ctx, report) {
  const rel = `${ctx.layout.configDir}/admob-ids.ts`;
  const text = read(ctx, rel);
  if (text === null) return; // required-file reports it
  if (text.includes(`ca-app-pub-${FACTS.placeholderPublisher}`)) {
    report.note(`${rel} still holds the template's placeholder IDs (publisher ${FACTS.placeholderPublisher}): testing builds are fine; ask the developer for the real AdMob IDs before the first store build (release gates refuse the placeholders)`);
  }
  for (const platform of ['ios', 'android']) {
    const at = text.search(new RegExp(`\\b${platform}\\s*:\\s*\\{`));
    if (at === -1) {
      report.problem({ file: rel, rule: 'app-ids', message: `no ${platform} IDs`, fix: `Add ${platform}: { appId, units: { banner, interstitial, rewarded } }: iOS and Android are separate AdMob apps.` });
      continue;
    }
    const section = text.slice(at, at + 600);
    for (const [key, pattern] of [['appId', APP_ID], ['banner', UNIT_ID], ['interstitial', UNIT_ID], ['rewarded', UNIT_ID]]) {
      const match = new RegExp(`\\b${key}\\s*:\\s*['"]([^'"]*)['"]`).exec(section);
      if (!match) {
        report.problem({ file: rel, rule: 'app-ids', message: `${platform} ${key} is missing`, fix: 'Ask the developer for the AdMob IDs (AdMob console: Apps, Ad units); never invent them.' });
        continue;
      }
      const line = lineAt(text, at + match.index);
      if (/^__[A-Z0-9_]+__$/.test(match[1])) report.problem({ file: rel, line, rule: 'app-ids', message: `${platform} ${key} is still the placeholder ${match[1]}`, fix: 'Write the real ID, or the documented-format placeholder (publisher 0000000000000000) until the developer has it.' });
      else if (match[1].includes(FACTS.samplePublisher)) report.problem({ file: rel, line, rule: 'app-ids', message: `${platform} ${key} is Google's sample ID`, fix: "The app's own IDs go here; test builds pick Google's samples by themselves." });
      else if (!pattern.test(match[1])) report.problem({ file: rel, line, rule: 'app-ids', message: `${platform} ${key} "${match[1]}" is not in AdMob's format`, fix: key === 'appId' ? 'Use ca-app-pub-<16 digits>~<10 digits>.' : 'Use ca-app-pub-<16 digits>/<10 digits>.' });
    }
  }
}

/** The pacing numbers are configuration: present, and at or above the app's floors. */
export function checkPolicyNumbers(ctx, contract, report) {
  const rel = `${ctx.layout.configDir}/ad-pacing.ts`;
  const text = read(ctx, rel);
  if (text === null) return; // required-file reports it
  const floors = contract?.pacingFloors ?? FACTS.defaultPacingFloors;
  for (const key of FACTS.pacingKeys) {
    const match = new RegExp(`\\b${key}\\s*:\\s*([0-9_]+)`).exec(text);
    if (match === null) {
      report.problem({ file: rel, rule: 'policy-numbers', message: `${key} is missing or not a number literal`, fix: `Set ${key} (default ${FACTS.defaultPacingFloors[key]}); the policy never hard-codes it.` });
      continue;
    }
    const value = Number(match[1].replace(/_/g, ''));
    if (typeof floors[key] === 'number' && value < floors[key]) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'policy-numbers', message: `${key} = ${value} is below the floor ${floors[key]} (contracts/ads.json pacingFloors)`, fix: `Use ${floors[key]} or more: the app may only be gentler than its floors.` });
    }
  }
}

/** Every <Name ...> opening tag, braces and quotes respected (so arrows inside props are fine). */
function jsxTags(text, name) {
  const tags = [];
  for (const start of text.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let depth = 0;
    let quote = null;
    let end = text.length;
    for (let i = start.index + name.length + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        end = i + 1;
        break;
      }
    }
    tags.push({ text: text.slice(start.index, end), index: start.index });
  }
  return tags;
}

/** The source of a top-level function or const arrow named `name` in `text` (masked), or ''. */
function definitionOf(text, name) {
  const start = text.search(new RegExp(`(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`));
  if (start < 0) return '';
  const end = text.indexOf('\n}', start);
  return text.slice(start, end < 0 ? undefined : end);
}

/** Screens for which runtime code asks shouldShowBanner(..., '<screen>') or useBannerSlot('<screen>', ...). */
function askedScreens(ctx) {
  const screens = new Set();
  const app = ctx.runtime.filter((file) => ctx.isAppCode(file));
  const slotHook = `${ctx.layout.srcDir}/hooks/use-banner-slot.ts`;
  const isSlotHookPolicy = /\bshouldShowBanner\s*\(/.test(definitionOf(ctx.masked.get(slotHook) ?? '', 'useBannerSlot'));
  for (const rel of app.filter((file) => !file.startsWith(`${ctx.adsDir}/`))) {
    const text = ctx.masked.get(rel);
    const calls = ['shouldShowBanner', ...(isSlotHookPolicy ? ['useBannerSlot'] : [])];
    for (const call of callRanges(text, calls)) {
      for (const literal of text.slice(call.start, call.end).matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) screens.add(literal[1]);
    }
  }
  return screens;
}

/** The pacing's bannerScreens literal, or null when it is not a literal list. */
function pacingScreens(ctx) {
  const text = read(ctx, `${ctx.layout.configDir}/ad-pacing.ts`);
  const match = text === null ? null : /\bbannerScreens\s*:\s*\[([^\]]*)\]/.exec(text);
  return match === null ? null : [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

// Banners only on the declared screens (contracts/ads.json bannerSlots), with their testID, and
// isAllowed always from the policy (useBannerSlot or shouldShowBanner), never a hand-made boolean.
export function checkBanners(ctx, contract, report) {
  const slots = Object.entries(contract?.bannerSlots ?? {});
  const asked = askedScreens(ctx);
  const declared = pacingScreens(ctx);
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file))) {
    const text = ctx.masked.get(rel);
    for (const tag of jsxTags(text, 'AdBannerSlot')) {
      const line = lineAt(text, tag.index);
      const add = (message, fix) => report.problem({ file: rel, line, rule: 'banner-placement', message, fix });
      const slot = slots.find(([folder]) => rel.startsWith(folder));
      const testID = /testID\s*=\s*\{?\s*["']([^"']+)["']/.exec(tag.text)?.[1];
      if (!slot) {
        add('a banner outside the declared banner screens', 'Banners appear only on the screens contracts/ads.json "bannerSlots" names (never over a focused task, a form, a dialog or a purchase screen); add the screen there only if it is a browsing screen.');
        continue;
      }
      if (testID !== slot[1]) add(`banner testID is "${testID ?? '(none)'}"`, `Use testID="${slot[1]}".`);
      const screen = slot[1].replace(/\.banner-ad$/, '');
      const isInline = /isAllowed\s*=\s*\{[^}]*shouldShowBanner\s*\(/s.test(tag.text);
      const isPassedIn = /isAllowed\s*=\s*\{\s*(?:[\w$]+\s*\??\.\s*)*is[A-Z]\w*\b/.test(tag.text);
      if (!isInline && !isPassedIn) add('isAllowed is not computed from the ad policy', `Pass isAllowed from useBannerSlot('${screen}', facts) (the screen's model hook) or shouldShowBanner(config, context, '${screen}').`);
      else if (!asked.has(screen)) add(`no runtime code asks the policy for '${screen}'`, `Take the slot's model from useBannerSlot('${screen}', facts) in the screen's model hook; never a hand-made boolean.`);
      if (declared !== null && !declared.includes(screen)) add(`'${screen}' is not in AD_PACING.bannerScreens`, `Add '${screen}' to bannerScreens in src/config/ad-pacing.ts, or the policy never lets the slot show.`);
    }
  }
}

// Every finished break counts toward the pacing: without one recordBreak call site no second
// interstitial ever comes due.
export function checkBreakRecorded(ctx, report) {
  const callers = ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.adsDir}/`) && /\brecordBreak\s*\(/.test(ctx.masked.get(file)));
  // recordBreak is pure: a call whose result is thrown away records nothing. Its result must be
  // assigned, returned or passed on (preceded by `=`, `(`, `,`, `:`, `?`, `[`, `=>` or `return`).
  for (const rel of callers) {
    const code = ctx.masked.get(rel);
    for (const match of code.matchAll(/\brecordBreak\s*\(/g)) {
      const before = code.slice(0, match.index).trimEnd();
      if (/(?:[=(,:?[]|=>|\breturn|\bawait)$/.test(before)) continue;
      report.problem({ file: rel, line: lineAt(code, match.index), rule: 'break-recorded', message: 'the result of recordBreak() is thrown away: it is pure, so nothing is recorded', fix: 'Save it with the break itself: const counted = recordBreak(history, outcome); then store counted (and pass it on to showInterstitialIfDue).' });
    }
  }
  if (callers.length > 0) return;
  report.problem({ file: `${ctx.adsDir}/ad-history.ts`, line: 1, rule: 'break-recorded', message: 'nothing records a finished break: after the first interstitial no second one is ever due', fix: 'Where a natural break finishes (the store action or model hook that completes it), save history = recordBreak(history, outcome) together with the break itself.' });
}

// The consent moment: AdsProvider is mounted by the app, it alone runs prepareAds (through the
// flow), and a banner screen asks it for the ad moment.
export function checkConsentMoment(ctx, report) {
  const flow = `${ctx.adsDir}/consent-moment-flow.ts`;
  const gate = `${ctx.adsDir}/ad-gate.ts`;
  const app = ctx.runtime.filter((file) => ctx.isAppCode(file));
  if (!app.some((rel) => !rel.startsWith(`${ctx.adsDir}/`) && /<AdsProvider\b/.test(ctx.masked.get(rel)))) {
    report.problem({ file: `${ctx.adsDir}/ads-provider.tsx`, line: 1, rule: 'consent-moment', message: 'no app file mounts <AdsProvider>: no consent is asked and no ad ever loads', fix: 'Mount <AdsProvider ...> once around the root stack, inside the services and theme providers (examples/ads-root.tsx).' });
  }
  for (const rel of app.filter((file) => file !== flow && file !== gate)) {
    const text = ctx.masked.get(rel);
    const call = /\bprepareAds\s*\(/.exec(text);
    if (call) report.problem({ file: rel, line: lineAt(text, call.index), rule: 'consent-moment', message: 'prepareAds() is called outside the consent moment', fix: 'Let consent-moment-flow.ts call prepareAds (primer, form, ATT, initialize, once per session, only over an ad screen); screens ask for the ad moment through useBannerSlot.' });
  }
  if (existsSync(join(ctx.root, flow)) && !/\bprepareAds\s*\(/.test(ctx.masked.get(flow) ?? '')) {
    report.problem({ file: flow, line: 1, rule: 'consent-moment', message: 'nothing prepares ads: the SDK is never initialised and no ad ever loads', fix: 'Restore consent-moment-flow.ts from the template: it runs prepareAds the first time an ad screen is open.' });
  }
  const slotHook = `${ctx.layout.srcDir}/hooks/use-banner-slot.ts`;
  const slot = definitionOf(ctx.masked.get(slotHook) ?? '', 'useBannerSlot');
  const focusFix = 'In useBannerSlot(screen, facts, isScreenFocused): useEffect(() => (isScreenFocused ? requestAdMoment?.() : undefined), [isScreenFocused, requestAdMoment]) and isAllowed: isScreenFocused && shouldShowBanner(...). Stacks and tabs keep a screen mounted under the screens pushed over it.';
  if (slot !== '' && !/\brequestAdMoment\b/.test(slot)) {
    report.problem({ file: slotHook, line: 1, rule: 'consent-moment', message: 'useBannerSlot does not ask the consent moment for its ad moment', fix: focusFix });
  } else if (slot !== '') {
    const slotText = ctx.masked.get(slotHook);
    const at = slotText.indexOf(slot);
    const effect = callRanges(slot, ['useEffect']).find((range) => /\brequestAdMoment\b/.test(slot.slice(range.start, range.end)));
    if (effect && !/Focused\b/.test(slot.slice(effect.start, effect.end))) {
      report.problem({ file: slotHook, line: lineAt(slotText, at + effect.start), rule: 'consent-moment', message: 'useBannerSlot holds the ad moment while its screen is mounted, not while it is focused: the primer, the form and ATT can open over a screen pushed on top', fix: focusFix });
    }
    const allowed = /\bisAllowed\s*:([^,}]*)/.exec(slot);
    if (allowed && /shouldShowBanner/.test(allowed[1]) && !/Focused\b/.test(allowed[1])) {
      report.problem({ file: slotHook, line: lineAt(slotText, at + allowed.index), rule: 'consent-moment', message: 'isAllowed ignores the screen\'s focus: a covered screen keeps its banner mounted and refreshing', fix: focusFix });
    }
  }
  for (const rel of app.filter((file) => file !== slotHook)) {
    const text = ctx.masked.get(rel);
    for (const call of callRanges(text, ['useBannerSlot'])) {
      if (/,\s*true\s*,?\s*$/.test(text.slice(call.start, call.end))) {
        report.problem({ file: rel, line: lineAt(text, call.start), rule: 'consent-moment', message: 'useBannerSlot(..., true) ignores the screen\'s focus', fix: 'Pass useIsFocused() (expo-router; React Navigation: @react-navigation/native) from the screen\'s model hook.' });
      }
    }
  }
}

// The AdsPort's show, initialize and preload calls stay inside the modules that keep the rules: a
// direct show skips the pacing policy, the media pause (runFullscreenAd) and the history; an
// initialize or preload outside the consent moment may load ads before consent and ATT. A heuristic
// (references/ad-policy.md, 'What the checkers cannot see'): show and preload calls are found by
// their names; initialize only on a receiver named ads... or ...Ads (deps.ads, adsPort, createAdsPort(...)).
const PORT_CALL_HOMES = {
  show: ['ad-moments.ts'],
  start: ['ad-gate.ts', 'ad-moments.ts'],
};
const PORT_CALL_ADAPTERS = ['admob-ads-adapter.ts', 'fake-ads.ts', 'ads-factory.ts'];

/** The name before `.method(` at `dot`: the receiver's last identifier, or the callee of a call. */
function receiverName(text, dot) {
  let i = dot - 1;
  while (i >= 0 && /[\s?]/.test(text[i])) i -= 1;
  if (text[i] === ')') {
    for (let depth = 0; i >= 0; i -= 1) {
      if (text[i] === ')') depth += 1;
      else if (text[i] === '(' && --depth === 0) break;
    }
    i -= 1;
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
  }
  const end = i + 1;
  while (i >= 0 && /[\w$]/.test(text[i])) i -= 1;
  return text.slice(i + 1, end);
}

export function checkPortCalls(ctx, report) {
  const homeOf = (rel, kind) => rel.startsWith(`${ctx.adsDir}/`) && [...PORT_CALL_HOMES[kind], ...PORT_CALL_ADAPTERS].includes(rel.slice(ctx.adsDir.length + 1));
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !ctx.isTestOnly(file))) {
    const text = ctx.masked.get(rel);
    const add = (index, message, fix) => report.problem({ file: rel, line: lineAt(text, index), rule: 'port-calls', message, fix });
    if (!homeOf(rel, 'show')) {
      for (const match of text.matchAll(/\.\s*(showInterstitial|showRewarded)\s*\(/g)) {
        add(match.index, `AdsPort.${match[1]}() is called outside ad-moments.ts`, 'Call showInterstitialIfDue (the pacing policy, the media pause, the history) from the press handler that leaves the break, or earnRewardedPerk from the "Watch an ad" press.');
      }
    }
    if (homeOf(rel, 'start')) continue;
    const startFix = 'Only prepareAds (ad-gate.ts, run by the consent moment) initialises and preloads, after consent and the ATT answer; ad-moments.ts preloads the next ad after a show.';
    for (const match of text.matchAll(/\.\s*(preloadInterstitial|preloadRewarded)\s*\(/g)) {
      add(match.index, `AdsPort.${match[1]}() is called outside the consent moment`, startFix);
    }
    for (const match of text.matchAll(/\.\s*initialize\s*\(/g)) {
      if (/^ads|Ads/.test(receiverName(text, match.index))) add(match.index, 'AdsPort.initialize() is called outside the consent moment (the SDK may preload before consent)', startFix);
    }
  }
}

// The app reads its ads facts through readAdsExtraForBinary: an EAS Update made for another
// variant's binary (another app id) then turns ads off instead of changing the mode or the units.
export function checkExtraBinaryGuard(ctx, report) {
  const home = `${ctx.adsDir}/read-ads-extra.ts`;
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && file !== home)) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(/\breadAdsExtra\s*\(/g)) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'ads-extra-binary', message: 'reads expo.extra with readAdsExtra(), which an EAS Update for another variant can change', fix: "Use readAdsExtraForBinary(Application.applicationId) (expo-application): a manifest that names another variant's app id turns ads off." });
    }
  }
}

// The by-hand smoke flows live in <e2e>/ads-smoke/, outside the flows/<area>/ folders CI runs, so the
// app's naming contract declares the folder (naming-conventions' flow-file rule reads it).
export function checkSmokeFolder(ctx, report) {
  const folder = `${ctx.layout.e2eDir}/ads-smoke`;
  if (!existsSync(join(ctx.root, folder))) return;
  const rel = `${ctx.layout.contractsDir}/naming.json`;
  const naming = existsSync(join(ctx.root, rel)) ? readRepoJson(ctx.root, rel) : null;
  const entries = Array.isArray(naming?.extraE2eFolders) ? naming.extraE2eFolders : [];
  if (entries.some((entry) => entry?.folder === 'ads-smoke')) return;
  report.problem({ file: rel, rule: 'smoke-flows', message: `${folder}/ is not declared in "extraE2eFolders"`, fix: 'Add { "folder": "ads-smoke", "why": "by-hand ads smoke on ADS_MODE=test builds; CI never runs it" } to contracts/naming.json "extraE2eFolders" (naming-conventions; copy its template contract first if the app has none).' });
}

// A free allowance is configuration (src/config), never a number typed where the offer is built: a
// literal there drifts from the pacing review and from what the store listing promises.
export function checkFreeAllowance(ctx, report) {
  for (const rel of ctx.runtime.filter((file) => ctx.isAppCode(file) && !file.startsWith(`${ctx.layout.configDir}/`) && !file.startsWith(`${ctx.adsDir}/`))) {
    const text = ctx.masked.get(rel);
    for (const match of text.matchAll(/\bfreeAllowanceLeft\s*:\s*([1-9][0-9_]*)\b/g)) {
      report.problem({ file: rel, line: lineAt(text, match.index), rule: 'free-allowance-config', message: `freeAllowanceLeft is the literal ${match[1]}`, fix: 'Compute it from a number in src/config (for example AD_PACING or the feature\'s config) minus what the user already used; 0 means "no free use".' });
    }
  }
}
