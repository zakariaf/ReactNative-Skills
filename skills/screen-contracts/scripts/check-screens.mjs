#!/usr/bin/env node
// check-screens.mjs: proves the built screens match the app's screen contract (contracts/screens.json):
// exactly the contract's testIDs (none missing, none invented, none from another screen, parts a
// component derives counted), the copy keys each element shows, every state tested and audited,
// policies (one primary action, ad slots only where allowed), modal overlays that Android back closes, and
// each route's model hook with its test; every route file is a contracted screen.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-screens.mjs . [--screen <id>]... [--all]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createReporter, fail, lineOf, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';
import {
  IN_TREE_OVERLAYS,
  ROUTED,
  TESTID_SHAPE,
  catalogText,
  derivationOf,
  hookNameOf,
  assignScreenFiles,
  isTestFile,
  loadContract,
  routeFiles,
} from './lib/screen-contract.mjs';
import {
  canonicalOfParts,
  canonicalRegExp,
  componentUses,
  elementsWithProp,
  openingTag,
  rendersComponent,
  scanStrings,
  scanTKeys,
  suffixRegExp,
  templateRegExp,
  testBlocks,
} from './lib/screen-source.mjs';

const SPEC = {
  name: 'check-screens',
  summary:
    'Checks the built screens against the app\'s screen contract (contracts/screens.json): exact testIDs, ' +
    'copy keys, states tested and audited, one primary action, ad slots, modal overlays, route -> model hook -> ' +
    'view wiring with tests, and a contract entry for every route file.',
  usage: '[repo-root] [--screen <id>]... [--all] [options]',
  options: {
    screen: { type: 'string', multiple: true, value: 'id', help: 'Only this screen (its id or one of its scopes); it must be built' },
    all: { type: 'boolean', help: 'Every contract screen must be built (the definition of done)' },
    contract: { type: 'string', value: 'file', help: 'The contract (default: rn-skills.config.json "screensContract", else <contractsDir>/screens.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules (references/checks.md explains each one and its fix):',
    '  contract-missing       --all or --screen, and the contract does not exist',
    '  contract-invalid       the contract breaks its format (ids, scopes, states, paths, policies, references)',
    '  unknown-copy-key       an element\'s text or a11yLabel key is not in the source-language catalog',
    '  reference-image-missing a state names a reference image the references folder does not hold',
    '  screen-unlisted        a route file under the routes folder is no contract screen\'s "route" (nor ignoredRoutes)',
    '  screen-not-built       a screen named with --screen (or any, with --all) has no code',
    '  missing-testid         a contract testID of a built screen is set nowhere in its code (directly, by a',
    '                         pattern, or derived by a component from its parent\'s testID)',
    '  unknown-testid         a testID (or testID pattern) of the screen\'s scope that the contract does not list',
    '  testid-wrong-screen    a testID of another screen\'s scope used in this screen\'s code',
    '  missing-copy-key       a copy key an element shows is never used in the screen\'s code (or its textVia module)',
    '  retired-copy-key       a key listed in policies.retiredKeys is still used or still in the contract',
    '  ad-slot-not-allowed    an ad slot component rendered or imported on a screen policies.adSlot does not allow',
    '  one-primary-action     more primary actions (policies.primaryAction) in one file than its max',
    '  screen-test-missing    the screen\'s view test does not exist or never names one of its testIDs',
    '  testid-untested        a contract testID the view test never names (parts a component derives count',
    '                         through their parent)',
    '  state-untested         a state after the first has no view-test block named for it that audits it',
    '  state-test-audit       a view-test block renders the screen (render, renderWithProviders,',
    '                         renderRouterWithProviders or a local render* helper) without the',
    '                         findInaccessiblePressables audit, or the view test never audits',
    '  overlay-not-modal      an overlay, dialog or sheet keeps no screen reader inside it: no RN Modal, no',
    '                         modal root component, no accessibilityViewIsModal or aria-modal (the Android half of a layer',
    '                         with that flag is accessibility-as-code\'s modal-overlay-android)',
    '  overlay-no-back        an overlay, dialog or sheet that Android back cannot close: a <Modal> without a',
    '                         real onRequestClose, or a layer outside Modal and the modal roots without a',
    '                         BackHandler hardwareBackPress subscription (or useBackHandler)',
    '  route-model-hook       a routed screen\'s route file is missing or never calls the screen\'s model hook',
    '  model-hook-missing     the contract\'s model hook file does not exist',
    '  model-hook-test        the model hook has no use-<name>.test.ts(x) next to it',
    '',
    'Without a contract the plain run prints NOT APPLICABLE (the app keeps no screen contracts yet: the look-first',
    'probe of an app adopting them); with --all or --screen (the definition of done) a missing contract is a problem. A missing source catalog prints a SKIP for unknown-copy-key',
    '(i18n-strings-and-catalogs creates it). rn-skills.config.json keys read: the layout keys (routesDir,',
    'i18nDir, contractsDir) and "screensContract".',
    '',
    'Examples:',
    '  node check-screens.mjs .                    every built screen and the contract itself',
    '  node check-screens.mjs . --screen lists     one screen, which must be built',
    '  node check-screens.mjs . --all              every contract screen built and checked',
  ].join('\n'),
};

/** A line that declares string literal types (`type Key = 'a.b' | 'c.d'`, or a `| 'x'` member). */
const LITERAL_TYPE_LINE = /^\s*(export\s+)?type\s|^\s*\|\s*'/;
/** A constant that names a storage key (`const PENDING_KEY = 'lists.pending-filter'`). */
const STORAGE_KEY_LINE = /\bconst\s+[A-Z0-9_]*KEY[A-Z0-9_]*\s*=/;
/** render(), renderWithProviders(), renderRouterWithProviders() or a local render* helper (renderDialog); never renderHook() or renderItem(). */
const RENDERS = /\brender(?!Hook\b|Item\b)(?:[A-Z][A-Za-z0-9]*)?\s*\(/;
const AUDITS = /\bfindInaccessiblePressables\s*\(/;
const AUDIT_FIX = 'End the block with expect(findInaccessiblePressables(screen.container)).toStrictEqual([]) (@test/a11y/find-inaccessible-pressables, accessibility-as-code): each state is its own screen for VoiceOver and TalkBack.';

/** What a set of files sets: literals, patterns (canonical), suffix patterns, t() keys. */
function indexFiles(files, catalogKeys) {
  const index = { ids: new Map(), all: new Set(), patterns: [], suffixes: [], tKeys: [], sources: new Map() };
  for (const file of files) {
    const raw = readFileSync(file.abs, 'utf8');
    const { plain, templates, source } = scanStrings(raw);
    index.sources.set(file.rel, source);
    const lines = source.split('\n');
    const tKeys = scanTKeys(source);
    for (const key of tKeys) index.tKeys.push({ ...key, file: file.rel });
    const keySet = new Set(tKeys.map((entry) => entry.key));
    for (const { value, line, index: at } of plain) {
      index.all.add(value);
      if (!TESTID_SHAPE.test(value) || catalogKeys.has(value) || keySet.has(value)) continue;
      const text = lines[line - 1] ?? '';
      if (LITERAL_TYPE_LINE.test(text) || STORAGE_KEY_LINE.test(text)) continue;
      if (/\.(?:get|set|getItem|setItem)\(\s*$/.test(source.slice(Math.max(0, at - 16), at))) continue;
      if (!index.ids.has(value)) index.ids.set(value, { file: file.rel, line });
    }
    for (const { parts, line } of templates) {
      if (parts[0] === '') {
        const regex = suffixRegExp(parts);
        if (regex) index.suffixes.push({ regex, file: file.rel, line });
      } else if (parts[0].includes('.')) {
        index.patterns.push({ regex: templateRegExp(parts), canon: canonicalOfParts(parts), source: parts.map((part) => part ?? '${…}').join(''), file: file.rel, line });
      }
    }
  }
  return index;
}

/** present(canon): does the index set this id (directly, by pattern, by suffix on a present base, or derived)? */
function makePresence(contract, screen, index) {
  const memo = new Map();
  const literalHit = (canon) => {
    if (!canon.includes('*')) return index.ids.has(canon) || index.all.has(canon) || index.patterns.some((pattern) => pattern.regex.test(canon));
    const regex = canonicalRegExp(canon);
    return index.patterns.some((pattern) => pattern.canon === canon) || [...index.all].some((value) => regex.test(value));
  };
  function present(canon) {
    if (memo.has(canon)) return memo.get(canon);
    memo.set(canon, false);
    let found = literalHit(canon);
    for (const suffix of found ? [] : index.suffixes) {
      const match = suffix.regex.exec(canon);
      if (match && match.index > 0 && present(canon.slice(0, match.index))) found = true;
    }
    if (!found) {
      const derived = derivationOf(contract, screen, canon);
      if (derived !== null) {
        const isKeyOk = !derived.keyed || derived.key === '*' || index.all.has(derived.key);
        found = isKeyOk && present(derived.parent.canon);
      }
    }
    memo.set(canon, found);
    return found;
  }
  return present;
}

function checkTestIds(contract, screen, index, report) {
  const present = makePresence(contract, screen, index);
  const where = screen.code.join(', ');
  for (const element of screen.elements) {
    if (present(element.canon)) continue;
    const derived = derivationOf(contract, screen, element.canon);
    const how = derived === null ? `set testID="${element.testID}" on that element` : `pass testID="${derived.parent.testID}" to ${derived.component}, which derives it`;
    report.problem({ file: contract.rel, line: element.line, rule: 'missing-testid', message: `${screen.id} ${element.testID} (${element.component ?? 'element'}${element.states ? `, states ${element.states.join('/')}` : ''}) is set nowhere in ${where}`, fix: `In the screen's code, ${how}; change the code to the contract, never the contract to the code (a new id is a contract change the reviewer approves).` });
  }
  const known = (value) => screen.elements.some((element) => element.regex.test(value)) || screen.elements.some((element) => element.canon.startsWith(`${value}.`) || canonicalRegExp(element.canon.split('.').slice(0, value.split('.').length).join('.')).test(value));
  for (const [value, at] of index.ids) {
    const owner = contract.scopeOwner.get(value.split('.')[0]);
    if (owner === undefined) continue;
    if (owner !== screen.id) {
      report.problem({ ...at, rule: 'testid-wrong-screen', message: `"${value}" belongs to ${owner}, not to ${screen.id}`, fix: `Use this screen's own testID (scope ${screen.scopes.join(' or ')}); another screen's id makes E2E flows and screenshot checks find the wrong element.` });
    } else if (!known(value)) {
      report.problem({ ...at, rule: 'unknown-testid', message: `"${value}" is not in the contract for ${screen.id}`, fix: 'Use exactly the contract\'s testIDs (list-screen.mjs prints them). If the design needs a new one, change contracts/screens.json first, in its own reviewed change; never invent one in code.' });
    }
  }
  for (const pattern of index.patterns) {
    const owner = contract.scopeOwner.get(pattern.canon.split('.')[0]);
    if (owner === undefined) continue;
    if (owner !== screen.id) {
      report.problem({ file: pattern.file, line: pattern.line, rule: 'testid-wrong-screen', message: `pattern \`${pattern.source}\` builds ids of ${owner}, not of ${screen.id}`, fix: `Use this screen's own scope (${screen.scopes.join(' or ')}).` });
      continue;
    }
    const hits = screen.elements.some((element) => element.canon === pattern.canon || (!element.canon.includes('*') && pattern.regex.test(element.canon)) || element.canon.startsWith(`${pattern.canon}.`));
    const isCopyKey = contract.catalog !== null && Object.keys(contract.catalog).some((key) => pattern.regex.test(key));
    if (!hits && !isCopyKey) report.problem({ file: pattern.file, line: pattern.line, rule: 'unknown-testid', message: `pattern \`${pattern.source}\` matches no testID of ${screen.id}`, fix: 'Check the spelling against the contract (list-screen.mjs); a pattern that matches nothing hides a missing testID.' });
  }
}

/** True when a file outside the screen's code (its model hook, a textVia module) names the key as a literal. */
function fileUsesKey(root, rel, key) {
  if (typeof rel !== 'string' || !existsSync(join(root, rel))) return false;
  return scanStrings(readFileSync(join(root, rel), 'utf8')).plain.some((entry) => entry.value === key);
}

function checkCopyKeys(root, contract, screen, index, report) {
  const retired = contract.policies.retiredKeys;
  for (const element of screen.elements) {
    for (const key of [element.text, element.a11yLabel]) {
      if (typeof key !== 'string') continue;
      if (Object.hasOwn(retired, key)) continue;
      const via = element.textVia;
      const isUsed = via === undefined
        ? index.all.has(key) || index.patterns.some((pattern) => pattern.regex.test(key)) || fileUsesKey(root, screen.model, key)
        : fileUsesKey(root, via, key);
      if (isUsed) continue;
      const text = catalogText(contract.catalog, key);
      report.problem({ file: contract.rel, line: element.line, rule: 'missing-copy-key', message: `${screen.id} never uses the copy key "${key}"${text === null ? '' : ` (${JSON.stringify(text)})`} that ${element.testID} shows${via === undefined ? '' : ` (textVia ${via})`}`, fix: `Translate t('${key}') in the model hook and hand the text to the view where the design shows ${element.testID} (the view never calls t()).` });
    }
  }
  for (const { key, file, line } of index.tKeys) {
    if (Object.hasOwn(retired, key)) report.problem({ file, line, rule: 'retired-copy-key', message: `t('${key}') is retired`, fix: `Use ${retired[key]}; then delete the retired key from every catalog.` });
  }
}

function checkPolicies(contract, screen, files, index, report) {
  const { adSlot, primaryAction } = contract.policies;
  for (const file of files) {
    const source = index.sources.get(file.rel) ?? '';
    if (adSlot !== null && !adSlot.screens.has(screen.id)) {
      for (const component of adSlot.components) {
        for (const line of componentUses(source, component)) report.problem({ file: file.rel, line, rule: 'ad-slot-not-allowed', message: `${screen.id} renders or imports the ad slot ${component}`, fix: `Ads appear only on the screens policies.adSlot allows (${[...adSlot.screens].join(', ') || 'none'}) and never for paying users; remove it, or change the policy in a reviewed change.` });
      }
    }
    if (primaryAction !== null) {
      const lines = primaryAction.match.flatMap((match) => elementsWithProp(source, match)).sort((a, b) => a - b);
      if (lines.length > primaryAction.max) report.problem({ file: file.rel, line: lines[primaryAction.max], rule: 'one-primary-action', message: `${lines.length} primary actions in one file (at most ${primaryAction.max})`, fix: 'Keep one obvious action per screen: pick the primary action\'s props from the state, and make the others secondary.' });
    }
  }
}

/** The screen's view test: it must exist, name its testIDs, test every state and audit every rendering block. */
function checkTests(contract, screen, root, catalogKeys, report) {
  const testRel = screen.test;
  const abs = testRel === null ? null : join(root, testRel);
  if (abs === null || !existsSync(abs)) {
    report.problem({ file: testRel ?? contract.rel, line: testRel === null ? screen.line : undefined, rule: 'screen-test-missing', message: `${screen.id} has no view test${testRel === null ? '' : ` (${testRel})`}`, fix: 'Write the view test next to the view: render it through renderWithProviders with a model per state, find every testID (includeHiddenElements for decorative parts), fire each handler, audit each state.' });
    return;
  }
  const index = indexFiles([{ rel: testRel, abs }], catalogKeys);
  const present = makePresence(contract, screen, index);
  const named = screen.elements.filter((element) => present(element.canon));
  if (named.length === 0) {
    report.problem({ file: testRel, rule: 'screen-test-missing', message: `${screen.id}'s view test never names one of its testIDs`, fix: 'Find every contract testID in the rendered view: getByTestId(id, { includeHiddenElements: true }) over the ids of each state.' });
  } else {
    for (const element of screen.elements.filter((each) => !named.includes(each))) report.problem({ file: testRel, rule: 'testid-untested', message: `${screen.id}'s view test never names ${element.testID}`, fix: `Find it in the state that shows it: expect(screen.getByTestId('${element.testID.replace(/\{[a-zA-Z0-9]+\}/g, '<key>')}', { includeHiddenElements: true })).toBeOnTheScreen().` });
  }
  const blocks = testBlocks(readFileSync(abs, 'utf8'));
  let isAudited = false;
  for (const block of blocks) {
    if (AUDITS.test(block.body)) isAudited = true;
    else if (RENDERS.test(block.body)) report.problem({ file: testRel, line: block.line, rule: 'state-test-audit', message: `${screen.id} test "${block.name}" renders the screen but never audits it for inaccessible pressables`, fix: AUDIT_FIX });
  }
  if (!isAudited) report.problem({ file: testRel, rule: 'state-test-audit', message: `${screen.id}'s view test never audits the rendered screen`, fix: AUDIT_FIX });
  for (const state of screen.states.slice(1)) {
    const words = [state.id, state.id.replace(/-/g, ' ')].map((word) => word.toLowerCase());
    const block = blocks.find((each) => words.some((word) => each.title.toLowerCase().includes(word)) && AUDITS.test(each.body));
    if (block === undefined) report.problem({ file: testRel, rule: 'state-untested', message: `${screen.id} state "${state.id}" has no view-test block named for it that renders and audits it`, fix: `Add it('shows the ${state.id} state', ...) (or a describe('when ${state.id}')) that renders the view with that state's model, finds its testIDs and ends with the audit.` });
  }
}

/** A BackHandler subscription (an effect that returns its unsubscribe) or a useBackHandler hook. */
const BACK_HANDLER = /\bBackHandler\.addEventListener\s*\(\s*['"]hardwareBackPress['"]|\buseBackHandler\s*\(/;
/** onRequestClose that does nothing: {() => {}}, {() => undefined}, {undefined}, {null}, {noop}. */
const NO_OP_CLOSE = /\bonRequestClose\s*=\s*\{\s*(?:\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)|undefined|null|noop)\s*\}/;
const BACK_FIX = 'Point the Modal\'s onRequestClose at the overlay\'s cancel or close handler (Android calls it for the back button and the predictive back gesture); a layer outside Modal subscribes to BackHandler hardwareBackPress while it is open and returns true.';

/**
 * Overlays, dialogs and sheets drawn in the tree: a screen reader stays inside (RN Modal, a modal root, or
 * accessibilityViewIsModal, whose Android half accessibility-as-code checks) and Android back closes them.
 */
function checkOverlay(contract, screen, files, index, report) {
  if (!IN_TREE_OVERLAYS.has(screen.presentation)) return;
  const entries = files.map((file) => ({ rel: file.rel, source: index.sources.get(file.rel) ?? '' }));
  let hasModal = false;
  for (const { rel, source } of entries) {
    for (const match of source.matchAll(/<Modal\b/g)) {
      hasModal = true;
      const tag = openingTag(source, match.index);
      if (/\bonRequestClose\s*=/.test(tag) && !NO_OP_CLOSE.test(tag)) continue;
      report.problem({ file: rel, line: lineOf(source, match.index), rule: 'overlay-no-back', message: `${screen.id}'s <Modal> ${/\bonRequestClose\s*=/.test(tag) ? 'passes an onRequestClose that does nothing' : 'has no onRequestClose'}, so Android's back button and back gesture cannot close the ${screen.presentation}`, fix: BACK_FIX });
    }
  }
  if (hasModal) return;
  const roots = contract.policies.modalRoots.filter((name) => name !== 'Modal');
  if (entries.some(({ source }) => roots.some((name) => rendersComponent(source, name)))) return;
  const file = entries[0]?.rel ?? contract.rel;
  // aria-modal is React Native's alias of accessibilityViewIsModal.
  if (!entries.some(({ source }) => /\b(?:accessibilityViewIsModal|aria-modal)\b/.test(source))) {
    report.problem({ file, rule: 'overlay-not-modal', message: `${screen.id} is a ${screen.presentation} drawn over another screen but keeps no screen reader inside it`, fix: `Draw it in React Native's <Modal> with onRequestClose, or in a modal root (${roots.join(', ') || 'none listed'}; the library Scrim is one), or present it as an Expo Router modal route (presentation "modal-route"). A full-window layer outside Modal needs accessibilityViewIsModal plus the Android hide that accessibility-as-code's modal-overlay-android checks.` });
  } else if (!entries.some(({ source }) => BACK_HANDLER.test(source))) {
    report.problem({ file, rule: 'overlay-no-back', message: `${screen.id} is a ${screen.presentation} outside Modal and the modal roots with no Android back handling`, fix: 'Subscribe to BackHandler hardwareBackPress while the layer is open (an effect that returns the unsubscribe, the handler closes it and returns true), or draw it in React Native\'s <Modal> with onRequestClose.' });
  }
}

function checkRouteAndModel(root, screen, report) {
  const exists = (rel) => existsSync(join(root, rel));
  if (ROUTED.has(screen.presentation) && typeof screen.route === 'string') {
    const hook = typeof screen.model === 'string' ? hookNameOf(screen.model) : 'use<Screen>Model';
    if (!exists(screen.route)) {
      report.problem({ file: screen.route, rule: 'route-model-hook', message: `${screen.id}'s route file does not exist`, fix: `Create it: export default function <Name>Route() { const model = ${hook}(); return <View model={model} />; }.` });
    } else if (!new RegExp(`\\b${hook}\\s*\\(`).test(readFileSync(join(root, screen.route), 'utf8'))) {
      report.problem({ file: screen.route, rule: 'route-model-hook', message: `${screen.id}'s route file never calls ${hook}()`, fix: `Keep the route to "const model = ${hook}(); return <View model={model} />"; the model hook is the only code that reads stores, services and navigation.` });
    }
  }
  if (typeof screen.model !== 'string') return;
  if (!exists(screen.model)) {
    report.problem({ file: screen.model, rule: 'model-hook-missing', message: `${screen.id}'s model hook ${screen.model} does not exist`, fix: 'Write the model hook (or point "model" at it): never a no-op stand-in; a screen that is not ready is left out of navigation instead.' });
    return;
  }
  const stem = screen.model.replace(/\.[jt]sx?$/, '');
  if (!['.test.ts', '.test.tsx'].some((suffix) => exists(`${stem}${suffix}`))) {
    report.problem({ file: screen.model, rule: 'model-hook-test', message: `${screen.id}'s model hook has no test next to it`, fix: `Write ${stem.slice(stem.lastIndexOf('/') + 1)}.test.tsx: renderHook through createProvidersWrapper with fakes, one test per state and per handler.` });
  }
}

/** Contract-level rules: format, copy keys, reference images, retired keys in the contract, unlisted routes. */
function checkContract(root, contract, options, report) {
  for (const problem of contract.problems) report.problem({ file: contract.rel, line: problem.line, rule: 'contract-invalid', message: problem.message, fix: problem.fix });
  const skip = contract.catalog === null ? notYetCreated(root, { file: contract.catalogRel, owner: 'i18n-strings-and-catalogs' }) : null;
  if (skip !== null) report.skip({ file: contract.catalogRel, rule: 'unknown-copy-key', message: skip });
  for (const screen of contract.screens.values()) {
    for (const element of screen.elements) {
      for (const key of [element.text, element.a11yLabel]) {
        if (typeof key !== 'string') continue;
        if (Object.hasOwn(contract.policies.retiredKeys, key)) {
          report.problem({ file: contract.rel, line: element.line, rule: 'retired-copy-key', message: `${screen.id} ${element.testID} still shows the retired key "${key}"`, fix: `Use ${contract.policies.retiredKeys[key]} in the contract and the code.` });
        } else if (contract.catalog !== null && catalogText(contract.catalog, key) === null) {
          report.problem({ file: contract.rel, line: element.line, rule: 'unknown-copy-key', message: `${screen.id} ${element.testID} shows "${key}", which ${contract.catalogRel} does not have`, fix: 'Add the text to the source catalog first (then every language, i18n-strings-and-catalogs), or fix the key.' });
        }
      }
    }
    for (const state of screen.states) {
      if (typeof state.reference !== 'string') continue;
      const image = `${contract.referencesDir}/${state.reference}`;
      if (!existsSync(join(root, image))) report.problem({ file: contract.rel, rule: 'reference-image-missing', message: `${screen.id} state "${state.id}" names ${image}, which does not exist`, fix: 'Export the approved design frame there (1 pt = 1 px, light theme, the source language), or fix the name.' });
    }
  }
  if (options.screen.length > 0) return;
  const listed = new Set([...contract.screens.values()].map((screen) => screen.route).filter(Boolean));
  for (const route of routeFiles(root, contract.layout)) {
    if (listed.has(route) || contract.ignoredRoutes.includes(route)) continue;
    report.problem({ file: route, rule: 'screen-unlisted', message: `${route} is a route no contract screen names`, fix: `Add the screen to ${contract.rel} (id, route, model, view, states, elements), or list a redirect-only route under ignoredRoutes with its why.` });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'app root');
  const contract = loadContract(root, { contract: options.contract });
  const report = createReporter({ name: 'check-screens', json: options.json });
  const isStrict = options.all || options.screen.length > 0;
  if (contract.missing) {
    if (!isStrict) return report.notApplicable(`no ${contract.rel}: this app keeps no screen contracts yet (copy the template contracts/screens.json to adopt them)`);
    report.problem({ file: contract.rel, rule: 'contract-missing', message: `${contract.rel} does not exist, so no screen can be checked`, fix: 'Copy the skill\'s templates/contracts/screens.json (and its schema) and describe every screen of the app.' });
    return report.finish({ checked: 0, unit: 'screens' });
  }
  checkContract(root, contract, options, report);
  const find = (arg) => [...contract.screens.values()].find((screen) => screen.id === arg || screen.scopes.includes(arg));
  const wanted = options.screen.map((arg) => find(arg) ?? fail(`unknown screen "${arg}"`, `Use a screen id from ${contract.rel}: ${[...contract.screens.keys()].join(', ')}.`));
  const targets = wanted.length > 0 ? wanted : [...contract.screens.values()];
  const catalogKeys = new Set(Object.keys(contract.catalog ?? {}));
  const filesOf = assignScreenFiles(root, [...contract.screens.values()]);
  let checked = 0;
  for (const screen of targets) {
    const files = filesOf.get(screen.id) ?? [];
    const code = files.filter((file) => !isTestFile(file.rel));
    if (code.length === 0) {
      if (isStrict) report.problem({ file: screen.code[0] ?? contract.rel, rule: 'screen-not-built', message: `${screen.id} (${screen.name ?? screen.id}) has no code at ${screen.code.join(', ')}`, fix: 'Build the screen from its contract entry (route, model hook, view, tests), or remove it from the contract in a reviewed change.' });
      continue;
    }
    checked += 1;
    const index = indexFiles(code, catalogKeys);
    checkTestIds(contract, screen, index, report);
    checkCopyKeys(root, contract, screen, index, report);
    checkPolicies(contract, screen, code, index, report);
    checkTests(contract, screen, root, catalogKeys, report);
    checkOverlay(contract, screen, code, index, report);
    checkRouteAndModel(root, screen, report);
  }
  if (checked === 0 && report.count === 0 && !isStrict) fail(`no screen of ${contract.rel} is built yet`, 'Build the first screen, or run with --all to list every screen still missing.');
  return report.finish({ checked, unit: 'screens' });
});
