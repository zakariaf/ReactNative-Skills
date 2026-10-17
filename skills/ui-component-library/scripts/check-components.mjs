#!/usr/bin/env node
// check-components.mjs: proves an app's shared component library keeps its rules: every component of
// the catalogue (contracts/component-library.json) exists, exports its component and props, takes a
// required testID, derives its part ids from it and has a test; the component specs equal the token
// file; there is one press implementation; and the device lessons (decorative parts hidden, ids on
// measured boxes, the modal root, pair cells, drawn underlines, hold tracks, scatters) hold.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-components.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { UsageError, createReporter, fail, lineOf, matchGlob, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import {
  DEFAULT_EXCLUDE, DEFAULT_OWNED_ELSEWHERE, DEFAULT_PREREQUISITES, DEFAULT_PRESS_HOSTS, fillLayout, firstDifference, fixedHeightsAroundText, inRanges,
  jsxElements, loadContract, masked, overridesWithoutReason, propsBody, readSource, sourceFilesUnder, specNote, specsConfig,
  specsFromTokens, styleEntries, styleSheetRanges, testFiles, testIdsOnInnerText, uiComponentFiles,
} from './lib/component-source.mjs';
import { findImports, resolveImport } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-components',
  summary: 'Checks the app\'s shared component library against its catalogue (contracts/component-library.json): files, exports, required testIDs and derived part ids, tests, generated specs, one press implementation, and the component rules.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'Catalogue file (default: contracts/component-library.json, or rn-skills.config.json componentLibraryContract)' },
    'ui-dir': { type: 'string', value: 'dir', help: 'The shared components folder (default: the catalogue uiDir, else the layout uiDir: src/ui)' },
    only: { type: 'string', multiple: true, value: 'Component', help: 'Check only these components\' files, exports, testIDs, parts and tests (while building a subset; never at the end)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  catalogue-missing       the ui folder holds components but contracts/component-library.json does not exist',
    '  prerequisite-missing    a file the components import (theme, AppText, PressableSurface, press feedback, test helpers) is missing or old',
    '  specs-missing           the token file, its components block, component-specs.json or component-specs.ts is missing',
    '  specs-mismatch          component-specs.json differs from what write-component-specs.mjs derives from the token file',
    '  spec-override-reason    a specs override in the catalogue has no "why"',
    '  component-missing       a catalogue component file does not exist',
    '  component-unlisted      a component file in the ui folder is not in the catalogue',
    '  component-export        the file does not export `function <Name>` and `type <Name>Props`',
    '  testid-required         the props type lacks a required `testID: string` (catalogue testID "required", the default)',
    '  part-not-derived        a part the catalogue lists is not derived from the testID (`${testID}.<part>`)',
    '  component-untested      no test file imports the component',
    '  press-outside-host      Pressable, a Touchable, React Native\'s Button or a gesture-handler button imported (by name or through a namespace import) outside the catalogue\'s press hosts',
    '  own-press-look          a hand-written pressed look (pressed style, activeOpacity, underlayColor) outside the press hosts',
    '  press-feedback          a press host never runs usePressFeedback(), so its presses are silent',
    '  rotate-outside-allowed  a rotate transform in a component the catalogue does not mark mayRotate',
    '  shadow-outside-allowed  a shadow (shadow(), boxShadow) on a component the catalogue does not mark mayShadow',
    '  measurement-literal     a numeric size literal inside a component StyleSheet (take it from COMPONENT_SPECS or a token)',
    '  hold-reduce-motion      a hold-to-confirm timer without reduceMotion: ReduceMotion.Never',
    '  decorative-not-hidden   a hidesItself component does not set accessibilityElementsHidden and no-hide-descendants',
    '  testid-on-inner-text    the component\'s own testID sits on its only text while the View around it draws the box',
    '  fixed-text-height       a style with a fixed height wraps text (at 200 % text it clips; use minHeight)',
    '  ui-translates           a ui file imports the translation API (strings arrive translated through props)',
    '  pair-cell-flex          an inPairCell component\'s layout style has flex: 1 or flexBasis: 0 (a zero vertical basis)',
    '  modal-root              accessibilityViewIsModal outside the catalogue\'s modal root, or a modal root without it',
    '  modal-back              a modal root that does not close on Android back (Modal onRequestClose or BackHandler)',
    '  drawn-underline         a drawnUnderline component uses textDecorationLine, or draws no underline bar',
    '  hold-fill-track         a holdFill component\'s fill is not inside a track pinned to the face edges',
    '  scatter-ltr             a scatter component lays out without direction: \'ltr\' (its pieces mirror in RTL)',
    '  mock-only-built         a design stand-in the catalogue lists under mockOnly was built',
    '',
    'NOT APPLICABLE when the catalogue does not exist and the ui folder holds only files other skills own:',
    'the design-system primitives, a11y/, icons/, motion/, adaptive/, feedback/, screen-frame.tsx,',
    'subtree-error-boundary.tsx, physical-direction-view.tsx, screen-body.tsx, ad-banner-slot.tsx,',
    'parity-launch-marker.tsx (a catalogue',
    'adds more under ownedElsewhere).',
    'Example: node check-components.mjs .   (from the app repo root)',
  ].join('\n'),
};

const SIZE_KEYS = [
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexBasis', 'gap', 'rowGap', 'columnGap',
  'top', 'bottom', 'start', 'end', 'inset', 'insetBlock', 'insetInline',
  'padding', 'paddingBlock', 'paddingInline', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd',
  'paddingVertical', 'paddingHorizontal', 'margin', 'marginBlock', 'marginInline', 'marginTop', 'marginBottom',
  'marginStart', 'marginEnd', 'marginVertical', 'marginHorizontal', 'borderRadius', 'borderWidth',
  'borderTopWidth', 'borderBottomWidth', 'borderStartWidth', 'borderEndWidth', 'borderTopStartRadius',
  'borderTopEndRadius', 'borderBottomStartRadius', 'borderBottomEndRadius', 'outlineWidth', 'outlineOffset',
];
const SIZE_LITERAL = new RegExp(`\\b(${SIZE_KEYS.join('|')})\\s*:\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?=[,}\\n])`, 'g');
const PRESS_IMPORT_RN = /import\s*\{[^}]*\b(Button|Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b[^}]*\}\s*from\s*['"]react-native['"]/g;
const PRESS_IMPORT_RNGH = /import\s*\{[^}]*\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|RectButton|BorderlessButton|BaseButton)\b[^}]*\}\s*from\s*['"]react-native-gesture-handler['"]/g;
/** `import * as RN from 'react-native'` (or gesture-handler): the press parts are then used as RN.Pressable. */
const PRESS_NAMESPACE_IMPORT = /import\s*\*\s*as\s+(\w+)\s+from\s*['"](react-native|react-native-gesture-handler)['"]/g;
const PRESS_PARTS_RN = 'Button|Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback';
const PRESS_PARTS_RNGH = 'Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|RectButton|BorderlessButton|BaseButton';
/** "// press-outside-host: <reason>": a press import the reviewer accepted, with at least a few words of why. */
const PRESS_REASON = /\/\/\s*press-outside-host:\s*\S.{7,}/;
const OWN_PRESS_LOOK = /\bpressed\w*\s*:\s*\{[^}]*\b(?:opacity|transform|backgroundColor)\s*:|\bpressed\s*&&\s*\{|\b(?:opacity|backgroundColor)\s*:\s*\(?\s*(?:[\w.]*\.)?(?:is)?[pP]ressed\b|\bactiveOpacity\b|\bunderlayColor\b|\bstyle\s*=\s*\{\s*\(\s*\{\s*pressed\s*\}/g;
const TRANSLATION_PACKAGES = /^(react-intl|@formatjs\/.+|i18next|react-i18next|@lingui\/.+|i18n-js)$/;
const FIX_TEMPLATE = 'Copy the component and its test from this skill\'s templates/src/ui/ (or build it by references/building-a-component.md), then rerun.';

function pascalOf(file) {
  return basename(file, '.tsx').split(/[-.]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

/** Reports each match of `pattern`; `oncePerLine` folds several matches of one line into one problem. */
function scan(report, file, text, rule, pattern, { message, fix, when = () => true, oncePerLine = false }) {
  const seen = new Set();
  for (const match of text.matchAll(pattern)) {
    if (!when(match)) continue;
    const line = lineOf(text, match.index);
    if (oncePerLine && seen.has(line)) continue;
    seen.add(line);
    report.problem({ file, line, rule, message: message(match), fix });
  }
}

/** The catalogue in use: the contract's, or (no contract) one entry per discovered file. */
function catalogueOf(contract, discovered) {
  if (contract.exists) return contract.data.components;
  return discovered.map((file) => ({ name: pascalOf(file), file, testID: 'required', parts: [], implicit: true }));
}

/** The defaults plus the catalogue's list (an entry for the same file replaces the default). */
function filesOf(defaults, extra, layout, uiDir) {
  const byFile = new Map();
  for (const entry of [...defaults, ...(extra ?? [])]) {
    const file = fillLayout(entry.file, layout, uiDir);
    byFile.set(file, { ...entry, file });
  }
  return [...byFile.values()];
}

function checkPrerequisites(report, root, prerequisites) {
  for (const { file, owner, mustContain, why } of prerequisites) {
    if (!existsSync(join(root, file))) {
      report.problem({ file, rule: 'prerequisite-missing', message: 'a file the components import is missing', fix: `Set it up first (${owner} creates it), then rerun.` });
    } else if (mustContain && !readFileSync(join(root, file), 'utf8').includes(mustContain)) {
      report.problem({ file, rule: 'prerequisite-missing', message: `an older copy: it lacks ${mustContain}${why ? ` (${why})` : ''}`, fix: `Update it from ${owner}'s template first, then rerun.` });
    }
  }
}

function checkSpecs(report, root, config, contractRel) {
  for (const override of overridesWithoutReason(config)) {
    report.problem({ file: contractRel, rule: 'spec-override-reason', message: `the override of ${override.path} gives no reason`, fix: 'Add "why": one sentence naming the design rule or decision that differs from the token file.' });
  }
  for (const file of [config.out, config.module]) {
    if (!existsSync(join(root, file))) report.problem({ file, rule: 'specs-missing', message: 'the component measurements are missing', fix: file === config.out ? 'Run write-component-specs.mjs from the repo root.' : 'Copy component-specs.ts from the templates (it imports the JSON as COMPONENT_SPECS).' });
  }
  const jsonName = basename(config.out);
  if (existsSync(join(root, config.module)) && !readFileSync(join(root, config.module), 'utf8').includes(jsonName)) {
    report.problem({ file: config.module, rule: 'specs-mismatch', message: `it does not import ${jsonName}`, fix: `Export COMPONENT_SPECS as the import of ./${jsonName} (copy the template).` });
  }
  if (!existsSync(join(root, config.tokens))) {
    report.problem({ file: config.tokens, rule: 'specs-missing', message: 'the token file the specs come from does not exist', fix: 'Create it with design-system-structure, or point specs.tokens in the catalogue at it.' });
    return;
  }
  let tokens;
  let expected;
  try {
    tokens = JSON.parse(readFileSync(join(root, config.tokens), 'utf8'));
    expected = specsFromTokens(tokens, config);
  } catch (error) {
    const isBlock = error instanceof UsageError && /has no "/.test(error.message);
    report.problem({ file: config.tokens, rule: isBlock ? 'specs-missing' : 'specs-mismatch', message: error.message.split('\n')[0], fix: error instanceof UsageError ? error.fix : 'Fix the token file (plain JSON).' });
    return;
  }
  if (!existsSync(join(root, config.out))) return;
  let actual;
  try {
    actual = JSON.parse(readFileSync(join(root, config.out), 'utf8'));
  } catch (error) {
    report.problem({ file: config.out, rule: 'specs-mismatch', message: `not valid JSON (${error.message.split('\n')[0]})`, fix: 'Run write-component-specs.mjs to rewrite it.' });
    return;
  }
  const diff = firstDifference(expected, actual);
  if (diff) {
    const note = specNote(tokens, config, diff.path);
    report.problem({ file: config.out, rule: 'specs-mismatch', message: `${diff.path} is ${diff.actual === undefined ? 'missing' : JSON.stringify(diff.actual)}, the token file gives ${JSON.stringify(diff.expected)}${note ? ` (${note})` : ''}`, fix: 'Run write-component-specs.mjs; never edit the JSON by hand (change the token file, or add a reasoned override).' });
  }
}

/** Repo-relative files each test imports (resolved through aliases and relative paths). */
function testImports(root, layout) {
  return testFiles(root).map((file) => {
    const source = readSource(root, file);
    const targets = new Set();
    for (const { from } of findImports(source)) {
      const resolved = resolveImport(file, from, { root, aliases: layout.aliases });
      if (resolved.kind === 'local' && resolved.path) targets.add(resolved.path);
    }
    return targets;
  });
}

function checkEntry(report, ctx, entry) {
  const file = `${ctx.uiDir}/${entry.file}`;
  if (!existsSync(join(ctx.root, file))) {
    report.problem({ file, rule: 'component-missing', message: `${entry.name} is in the catalogue but its file does not exist`, fix: `${FIX_TEMPLATE} If the app no longer has it, remove it from ${ctx.contractRel}.` });
    return;
  }
  const source = readSource(ctx.root, file);
  const text = masked(source);
  if (!new RegExp(`export function ${entry.name}\\b`).test(text) || !new RegExp(`export type ${entry.name}Props\\b`).test(text)) {
    report.problem({ file, line: 1, rule: 'component-export', message: `does not export function ${entry.name} and type ${entry.name}Props`, fix: `One component per file, named after the file: export function ${entry.name}(props: ${entry.name}Props): ReactNode.` });
  }
  // Without a catalogue nothing says which parts are decorative, so the testID rule waits for it.
  if (entry.implicit !== true && (entry.testID ?? 'required') === 'required') {
    const body = propsBody(text, entry.name) ?? '';
    if (!/(?:^|[\s;{])(?:readonly\s+)?testID\s*:\s*string\s*;/.test(body)) {
      report.problem({ file, line: Math.max(1, lineOf(text, Math.max(0, text.search(new RegExp(`export type ${entry.name}Props`))))), rule: 'testid-required', message: `${entry.name}Props needs a required \`readonly testID: string;\``, fix: 'Take testID as a required prop, put it on the element the design measures, and derive every part from it.' });
    }
  }
  for (const part of entry.parts ?? []) {
    if (!new RegExp(`\\}\\.${part.replace(/-/g, '\\-')}(?=[\`.$])`).test(text)) {
      report.problem({ file, line: 1, rule: 'part-not-derived', message: `the part "${part}" is not derived from the testID`, fix: `Give that element testID={\`\${testID}.${part}\`} (a screen never builds part ids by hand), or remove the part from the catalogue.` });
    }
  }
  if (!ctx.tests.some((targets) => targets.has(file))) {
    report.problem({ file, line: 1, rule: 'component-untested', message: `no test file imports ${entry.file}`, fix: `Write ${entry.file.replace(/\.tsx$/, '.test.tsx')} beside it: render it with renderWithProviders, assert role, name, state and its parts, and end with the inaccessible-pressables audit.` });
  }
}

function checkFlags(report, ctx, entry) {
  const file = `${ctx.uiDir}/${entry.file}`;
  if (!existsSync(join(ctx.root, file))) return;
  const text = masked(readSource(ctx.root, file));
  if (entry.hidesItself === true && (!/\baccessibilityElementsHidden\b/.test(text) || !/no-hide-descendants/.test(text))) {
    report.problem({ file, line: 1, rule: 'decorative-not-hidden', message: `${entry.name} is decorative but stays in the accessibility tree`, fix: 'Set accessibilityElementsHidden and importantForAccessibility="no-hide-descendants" on its root (iOS reads the first, Android the second); never un-hide it to make it measurable.' });
  }
  if (entry.inPairCell === true) checkPairCellFlex(report, file, text, entry.name);
  if (entry.drawnUnderline === true) checkDrawnUnderline(report, file, text, entry.name);
  if (entry.holdFill === true) checkHoldFillTrack(report, file, text);
  if (entry.scatter === true) checkScatter(report, file, text, entry.name);
  if (entry.modalRoot === true) checkModalRoot(report, file, text, entry.name);
}

/**
 * A component that sits in a cell of a row or grid keeps its content height there: flex: 1 is
 * flexBasis 0 on a column cell's vertical axis (the row measured 0 pt on a device; Jest has no
 * layout engine). The layout style grows instead.
 */
function checkPairCellFlex(report, file, text, name) {
  const entries = new Map(styleEntries(text).map((entry) => [entry.name, entry]));
  for (const match of text.matchAll(/\blayoutStyle\s*=\s*\{\s*(?:styles\.(\w+)|(\{[^}]*\}))\s*\}/g)) {
    const entry = match[1] ? entries.get(match[1]) : { body: match[2], index: match.index };
    if (entry && (/\bflex\s*:\s*1\b/.test(entry.body) || /\bflexBasis\s*:\s*0\b/.test(entry.body))) {
      report.problem({ file, line: lineOf(text, entry.index), rule: 'pair-cell-flex', message: `${name}'s layout style has a zero flex basis (flex: 1): in a column cell the row measures 0 pt on the device`, fix: 'Use { flexGrow: 1 }: the component grows into its cell and keeps its content height.' });
    }
  }
}

function checkDrawnUnderline(report, file, text, name) {
  const at = text.search(/\btextDecorationLine\b/);
  if (at >= 0) {
    report.problem({ file, line: lineOf(text, at), rule: 'drawn-underline', message: `${name} underlines with textDecorationLine, whose thickness and offset no platform lets you set`, fix: 'Draw the underline as a View bar in the label colour (height and offset from COMPONENT_SPECS), as text-button.tsx does.' });
  } else if (!styleEntries(text).some((entry) => /underline/i.test(entry.name) && /(^|[\s,{])height\s*:/.test(entry.body))) {
    report.problem({ file, line: 1, rule: 'drawn-underline', message: `${name} draws no underline bar`, fix: 'Add an underline style ({ height: <spec thickness>, marginTop: <spec offset> }) and render it under the label.' });
  }
}

function checkHoldFillTrack(report, file, text) {
  const track = styleEntries(text).find(({ body }) => /position\s*:\s*'absolute'/.test(body) && ['top', 'bottom', 'start', 'end'].every((key) => new RegExp(`\\b${key}\\s*:\\s*0\\b`).test(body)) && /flexDirection\s*:\s*'row'/.test(body));
  const fillAt = text.search(/\}\.fill`/);
  const trackAt = track ? text.search(new RegExp(`style=\\{styles\\.${track.name}\\b`)) : -1;
  if (fillAt >= 0 && (trackAt < 0 || trackAt > fillAt)) {
    report.problem({ file, line: lineOf(text, fillAt), rule: 'hold-fill-track', message: 'the hold fill sits straight in the face, so its percentage width is taken inside the face\'s padding and the full fill stops short', fix: 'Wrap the fill in a View styled { position: \'absolute\', top: 0, bottom: 0, start: 0, end: 0, flexDirection: \'row\' } and give the fill alignSelf: \'stretch\' and the percentage width.' });
  }
}

function checkScatter(report, file, text, name) {
  if (styleEntries(text).some((entry) => /\bdirection\s*:\s*'ltr'/.test(entry.body))) return;
  const at = Math.max(0, text.search(/\bstart\s*:/));
  report.problem({ file, line: lineOf(text, at), rule: 'scatter-ltr', message: `${name} places its pieces with start offsets but its band has no direction 'ltr', so the scatter mirrors in right-to-left languages`, fix: 'Add direction: \'ltr\' to the band style: start stays the left edge (physical left and right are banned in styles).' });
}

function checkModalRoot(report, file, text, name) {
  if (!/\baccessibilityViewIsModal\b/.test(text)) {
    report.problem({ file, line: 1, rule: 'modal-root', message: `${name} is the modal root but is not marked modal, so VoiceOver can leave the dialog`, fix: 'Put accessibilityViewIsModal on its root View (with its testID), and render the layer in React Native\'s Modal.' });
  }
  const modal = jsxElements(text).find((element) => element.name === 'Modal');
  const hasBack = modal ? /\bonRequestClose\s*=/.test(modal.attrs) : /\bBackHandler\.addEventListener\s*\(\s*['"]hardwareBackPress['"]|\buseBackHandler\s*\(/.test(text);
  if (!hasBack) {
    report.problem({ file, line: modal ? lineOf(text, modal.start) : 1, rule: 'modal-back', message: `${name} does not close on Android's back button or back gesture`, fix: 'Pass onRequestClose to the Modal (Android back button and predictive back gesture), or subscribe to BackHandler hardwareBackPress while it is open and return true.' });
  }
}

/** accessibilityViewIsModal anywhere in the library but the modal root hides that root's testID. */
function checkModalFlag(report, ctx, files, roots) {
  for (const rel of files) {
    if (roots.has(rel)) continue;
    const file = `${ctx.uiDir}/${rel}`;
    const text = masked(readSource(ctx.root, file));
    const at = text.search(/\baccessibilityViewIsModal\b/);
    if (at >= 0) report.problem({ file, line: lineOf(text, at), rule: 'modal-root', message: `${rel} is marked modal, which hides the modal root's testID (and the screen under it) from the tree E2E tools read`, fix: 'Leave the flag on the catalogue\'s modal root (the scrim) only; the card inside it is never modal.' });
  }
}

/** Rules for every component file of the library (catalogued or discovered). */
function checkComponentFile(report, ctx, rel, entry) {
  const file = `${ctx.uiDir}/${rel}`;
  const source = readSource(ctx.root, file);
  const text = masked(source);
  // Without a catalogue the flags are unknown: the flag rules wait for it (catalogue-missing says so).
  const isImplicit = entry?.implicit === true;
  if (!isImplicit && entry?.mayRotate !== true) {
    scan(report, file, text, 'rotate-outside-allowed', /\brotate[XYZ]?\s*:/g, { message: () => 'a rotate transform in a component the catalogue does not mark mayRotate', fix: 'Controls, cards and rows stay square; a drawn glyph or a decorative tilt gets "mayRotate": true in the catalogue.' });
  }
  if (!isImplicit && entry?.mayShadow !== true) {
    scan(report, file, text, 'shadow-outside-allowed', /(?:^|[^\w$.]|\.\.\.)shadow\s*\(|\bboxShadow\s*:/gm, { message: () => 'a shadow on a component that lies flat', fix: 'A shadow says "this floats or can be pressed": flat parts (cards, rows, chips, badges) have none; a dialog, toast or thumb gets "mayShadow": true.' });
  }
  const sheets = styleSheetRanges(text);
  scan(report, file, text, 'measurement-literal', SIZE_LITERAL, { when: (m) => Number(m[2]) !== 0 && inRanges(m.index, sheets), message: (m) => `${m[1]}: ${m[2]} is a literal size`, fix: 'Take it from COMPONENT_SPECS (add it to the token file\'s components block) or a theme token; a value the design leaves unnamed becomes a named constant with a comment.' });
  for (const found of testIdsOnInnerText(text)) {
    report.problem({ file, line: lineOf(text, found.index), rule: 'testid-on-inner-text', message: `the testID sits on the text inside the ${found.parent} that draws the box, so an E2E tool measures only the words`, fix: 'Put testID, accessible, accessibilityRole and accessibilityLabel on that View and drop the testID from the AppText (as chip.tsx and badge.tsx do); part ids (.label) stay on text.' });
  }
  for (const entryStyle of fixedHeightsAroundText(text)) {
    report.problem({ file, line: lineOf(text, entryStyle.index), rule: 'fixed-text-height', message: `the style "${entryStyle.name}" fixes a height around text, which clips when the text grows to 200 %`, fix: 'Use minHeight (from COMPONENT_SPECS) so the box grows with the text.' });
  }
}

function checkTranslates(report, ctx, files) {
  for (const file of files) {
    const source = readSource(ctx.root, file);
    for (const { from, index, text } of findImports(source)) {
      if (/^import\s+type\b/.test(text)) continue;
      const resolved = resolveImport(file, from, { root: ctx.root, aliases: ctx.layout.aliases });
      const isI18n = resolved.kind === 'local' ? resolved.path?.startsWith(`${ctx.layout.i18nDir}/`) : TRANSLATION_PACKAGES.test(from);
      if (isI18n) report.problem({ file, line: lineOf(source, index), rule: 'ui-translates', message: `imports the translation API (${from})`, fix: 'Shared components are presentational: the screen model calls t() and passes translated strings (and formatted numbers) as props.' });
    }
  }
}

/**
 * True when the import line, or the run of // comment lines directly above it (a file header that
 * ends at the import counts), states why this file presses on its own.
 */
function hasPressReason(sourceLines, line) {
  if (PRESS_REASON.test(sourceLines[line - 1] ?? '')) return true;
  for (let index = line - 2; index >= 0 && /^\s*\/\//.test(sourceLines[index] ?? ''); index -= 1) {
    if (PRESS_REASON.test(sourceLines[index])) return true;
  }
  return false;
}

/** Each `<NS>.Pressable` (and the other press parts) used through a namespace import of react-native or gesture-handler. */
function namespacedPressUses(text) {
  const uses = [];
  for (const imported of text.matchAll(PRESS_NAMESPACE_IMPORT)) {
    const parts = imported[2] === 'react-native' ? PRESS_PARTS_RN : PRESS_PARTS_RNGH;
    const use = new RegExp(`\\b${imported[1]}\\.(${parts})\\b`, 'g');
    for (const found of text.matchAll(use)) if (text.slice(Math.max(0, found.index - 2), found.index) !== '</') uses.push({ index: found.index, part: found[1], from: imported[2], importIndex: imported.index });
  }
  return uses;
}

function checkPressing(report, ctx, appFiles, pressHosts) {
  const hosts = new Set(pressHosts.map((name) => `${ctx.uiDir}/${name}`));
  for (const file of appFiles) {
    if (hosts.has(file)) continue;
    const source = readSource(ctx.root, file);
    const sourceLines = source.split('\n');
    const text = masked(source);
    const fix = `Compose the press host (${pressHosts.join(', ')}) through Button, ListRow, IconButton and the rest; a second press implementation answers, sounds and announces differently. A file that must render outside every provider (a crash fallback) states why with "// press-outside-host: <reason>" above the import.`;
    const unreasoned = (m) => !hasPressReason(sourceLines, lineOf(text, m.index));
    scan(report, file, text, 'press-outside-host', PRESS_IMPORT_RN, { when: unreasoned, message: (m) => `${m[1]} is a second press implementation`, fix });
    scan(report, file, text, 'press-outside-host', PRESS_IMPORT_RNGH, { when: unreasoned, message: (m) => `${m[1]} from react-native-gesture-handler is a second press implementation`, fix });
    for (const use of namespacedPressUses(text)) {
      if (hasPressReason(sourceLines, lineOf(text, use.importIndex))) continue;
      const via = use.from === 'react-native' ? '' : ' from react-native-gesture-handler';
      report.problem({ file, line: lineOf(text, use.index), rule: 'press-outside-host', message: `${use.part}${via} (through a namespace import) is a second press implementation`, fix });
    }
    scan(report, file, text, 'own-press-look', OWN_PRESS_LOOK, { oncePerLine: true, message: () => 'a hand-written pressed look', fix: 'The press look is the press surface\'s, one token choice for the whole app (design-system-structure\'s PRESS); remove the pressed style.' });
    if (/\b(holdToConfirm|HOLD_TO_CONFIRM\w*)\b/.test(text) && /\bwithTiming\s*\(/.test(text) && !/reduceMotion\s*:\s*ReduceMotion\.Never/.test(text)) {
      report.problem({ file, line: lineOf(text, text.search(/\bwithTiming\s*\(/)), rule: 'hold-reduce-motion', message: 'the hold timer would finish at once under Reduce Motion, so a touch would confirm', fix: 'Pass reduceMotion: ReduceMotion.Never to the hold\'s withTiming: it is a safety timer, not decoration.' });
    }
  }
  for (const file of hosts) {
    if (!existsSync(join(ctx.root, file))) continue;
    const text = masked(readSource(ctx.root, file));
    const bound = /\bconst\s+(\w+)\s*=\s*usePressFeedback\s*\(\s*\)/.exec(text);
    if (!bound || !new RegExp(`\\b${bound[1]}\\s*\\(\\s*\\)`).test(text.slice(bound.index + bound[0].length))) {
      report.problem({ file, line: 1, rule: 'press-feedback', message: 'the press host never runs the press feedback, so presses are silent', fix: 'const onPressFeedback = usePressFeedback(); then call onPressFeedback() before props.onPress(), except for a switch (its handler plays its own feedback).' });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const layout = resolveLayout(root);
  const contract = loadContract(root, layout, options.contract);
  const uiDir = options['ui-dir'] ?? contract.data?.uiDir ?? layout.uiDir;
  if (!existsSync(join(root, uiDir))) fail(`nothing to check: ${uiDir} does not exist`, 'Run from the app repo root, or pass --ui-dir (a monorepo\'s UI package: packages/ui/src).');
  const report = createReporter({ name: 'check-components', json: options.json });
  const prerequisites = filesOf(DEFAULT_PREREQUISITES, contract.data?.prerequisites, layout, uiDir);
  // Prerequisites and the files other skills keep in the ui folder are never library components.
  const ownedElsewhere = filesOf(DEFAULT_OWNED_ELSEWHERE, contract.data?.ownedElsewhere, layout, uiDir);
  const listedFiles = new Set((contract.data?.components ?? []).map((entry) => entry.file));
  const prerequisiteUi = new Set([...prerequisites, ...ownedElsewhere].map((entry) => entry.file).filter((file) => file.startsWith(`${uiDir}/`)).map((file) => file.slice(uiDir.length + 1)).filter((rel) => !listedFiles.has(rel)));
  const pressHosts = contract.data?.pressHosts ?? DEFAULT_PRESS_HOSTS;
  const discovered = uiComponentFiles(root, uiDir, { exclude: contract.data?.exclude ?? DEFAULT_EXCLUDE, skip: prerequisiteUi });
  if (!contract.exists && discovered.length === 0) {
    return report.notApplicable(`no shared component library yet: ${contract.rel} does not exist and ${uiDir} holds only files other skills own`);
  }
  if (!contract.exists) {
    report.problem({ file: contract.rel, rule: 'catalogue-missing', message: `${uiDir} holds ${discovered.length} components but no catalogue lists them`, fix: 'Copy templates/contracts/component-library.json, list every component with its parts and flags, and rerun.' });
  }
  const catalogue = catalogueOf(contract, discovered);
  const known = new Set(catalogue.map((entry) => entry.name));
  const unknown = options.only.filter((name) => !known.has(name));
  if (unknown.length > 0) fail(`--only names components the catalogue does not list: ${unknown.join(', ')}`, `Use catalogue names: ${[...known].join(', ')}.`);
  const ctx = { root, layout, uiDir, contractRel: contract.rel, tests: testImports(root, layout) };
  let checked = prerequisites.length;
  checkPrerequisites(report, root, prerequisites);
  const config = specsConfig(contract.data, uiDir);
  const specsInUse = contract.exists || (config !== null && (existsSync(join(root, config.out)) || existsSync(join(root, config.module))));
  if (config !== null && specsInUse) {
    checked += 1;
    checkSpecs(report, root, config, contract.rel);
  }
  const selected = options.only.length > 0 ? catalogue.filter((entry) => options.only.includes(entry.name)) : catalogue;
  for (const entry of selected) {
    checked += 1;
    checkEntry(report, ctx, entry);
  }
  for (const entry of catalogue) checkFlags(report, ctx, entry);
  const listed = new Map(catalogue.map((entry) => [entry.file, entry]));
  if (contract.exists) {
    const mockFiles = new Set((contract.data.mockOnly ?? []).map((item) => item.file).filter(Boolean));
    for (const rel of discovered.filter((file) => !listed.has(file) && !mockFiles.has(file))) {
      report.problem({ file: `${uiDir}/${rel}`, line: 1, rule: 'component-unlisted', message: 'a component the catalogue does not list, so none of its rules are checked', fix: `Add it to ${contract.rel} with its parts and flags (or move it into a feature if only one screen uses it).` });
    }
  }
  const libraryFiles = [...new Set([...discovered, ...catalogue.map((entry) => entry.file)])].filter((rel) => existsSync(join(root, uiDir, rel)));
  if (contract.exists) checkModalFlag(report, ctx, libraryFiles, new Set(catalogue.filter((entry) => entry.modalRoot === true).map((entry) => entry.file)));
  for (const rel of libraryFiles) {
    checked += 1;
    checkComponentFile(report, ctx, rel, listed.get(rel));
  }
  for (const item of contract.data?.mockOnly ?? []) {
    const builtFile = item.file === undefined ? null : `${uiDir}/${item.file}`;
    if ((builtFile && existsSync(join(root, builtFile))) || known.has(item.name)) {
      report.problem({ file: builtFile ?? contract.rel, line: 1, rule: 'mock-only-built', message: `${item.name} is a design stand-in the app never builds (${item.why})`, fix: 'Delete it and use the real thing the catalogue names; a stand-in ships as a fake.' });
    }
  }
  const exclude = contract.data?.exclude ?? DEFAULT_EXCLUDE;
  const uiSources = sourceFilesUnder(root, [uiDir]).filter((file) => {
    const rel = file.slice(uiDir.length + 1);
    return !exclude.some((glob) => matchGlob(rel, glob)) && !prerequisiteUi.has(rel);
  });
  checkTranslates(report, ctx, uiSources);
  const appDirs = [layout.srcDir, layout.routesDir, uiDir, ...layout.workspaces.flatMap((workspace) => [workspace.layout.srcDir, workspace.layout.routesDir])];
  const appFiles = sourceFilesUnder(root, appDirs);
  checked += appFiles.length;
  checkPressing(report, ctx, appFiles, pressHosts);
  return report.finish({ checked, unit: 'catalogue entries and files' });
});
