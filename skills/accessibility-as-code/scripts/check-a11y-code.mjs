#!/usr/bin/env node
// check-a11y-code.mjs: checks React Native source for the accessibility mistakes a machine can see:
// a role and a name on every pressable, own touch boxes of at least 44 pt without hitSlop, state,
// translated labels, text scaling left on, reduce motion, announcements and switch reads through the
// app's one source, overlays that are modal for VoiceOver and TalkBack, no nested pressables, card
// openers that are not covered by their own text layer, custom canvases spoken as one image, a tap or
// accessibility-action alternative for every hold, swipe, drag and pinch, adjustable controls, screen
// tests that audit a11y, and the a11y gates it reads from quality-gates.json.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-a11y-code.mjs [repo-root] [options]

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, matchGlob, parseArgs, PROJECT_CONFIG_FILE, requireDir, resolveLayout, run, toPosix, walkRepo } from './check-lib.mjs';
import { extractBlock, topLevelEntries } from './lib/object-literal.mjs';
import { findCalls, findImports, findJsxTags, jsxAttributes, literalOf, maskCode } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-a11y-code',
  summary: 'Checks .ts/.tsx source (src/, or every workspace src/) for accessibility mistakes that are visible in code.',
  usage: '[repo-root] [options]',
  options: {
    src: { type: 'string', multiple: true, value: 'dir', help: 'Source folder to scan, repo-relative (repeatable; default: the layout srcDir and every workspace srcDir)' },
    'min-touch': { type: 'string', value: 'pt', help: 'Smallest own touch box (default: quality-gates.json a11y.minTouchPt, else 44; never below 44)' },
    'font-cap': { type: 'string', value: 'x', help: 'Lowest allowed maxFontSizeMultiplier (default: quality-gates.json a11y.maxFontScale, else 2; never below 2)' },
    'routes-dir': { type: 'string', multiple: true, value: 'dir', help: 'Route folders whose files the navigator presents (default: the layout routesDir and every workspace routesDir)' },
    'screen-test': { type: 'string', multiple: true, value: 'glob', help: 'Which tests are screen tests (default: **/*-screen.test.tsx and **/screens/**/*.test.tsx)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  pressable-role         a Pressable/Touchable*/RNGH button (also one wrapped by createAnimatedComponent) without',
    '                         accessibilityRole (or role); the only child of an expo-router <Link asChild> has role',
    '                         link from the Link, and a pressable hidden from screen readers (accessible={false},',
    '                         aria-hidden, or accessibilityElementsHidden with no-hide-descendants) needs neither',
    '                         role nor name',
    '  pressable-name         a pressable without accessibilityLabel/aria-label and without text inside (icon-only):',
    '                         text is a Text/AppText child, an expression child, or a component that renders text',
    '                         (not one named *Icon/*Glyph); aria-labelledby/accessibilityLabelledBy do not count',
    '                         (Android and web only: VoiceOver reads nothing)',
    '  touch-target           a pressable whose own style box is smaller than the minimum (44 x 44 pt by default):',
    '                         styles.<name> or any styles object bound to use*Styles()/StyleSheet.create, inline',
    '                         objects and array elements, merged in order as React Native merges them',
    '  hit-slop               hitSlop on any element (invisible in layout, overlaps neighbours)',
    '  disabled-state         a Gesture Handler Pressable/button/touchable with disabled= (or enabled=) but no',
    '                         accessibilityState or aria-disabled: unlike React Native\'s own Pressable and Touchables,',
    '                         Gesture Handler does not derive accessibilityState.disabled from it',
    '  literal-a11y-text      accessibilityLabel/Hint or aria-label with literal or template-built text (use t())',
    '  font-scaling           allowFontScaling={false}, or a maxFontSizeMultiplier below the cap (2 by default)',
    '  reduce-motion          Reanimated useReducedMotion (a module-load constant)',
    '  a11y-store             AccessibilityInfo.is*Enabled / prefers* / addEventListener outside system-a11y-store.ts',
    '  announce               announceForAccessibility(WithOptions) outside use-announce.ts (use useAnnounce())',
    '  modal-overlay          a *dialog/*overlay/*sheet/*modal/*popover/*menu/*drawer/*popup component that is',
    '                         not modal: no accessibilityViewIsModal, no aria-modal on a Pressable/Touchable, no RN',
    '                         <Modal> or Gesture Handler drawer, and no component from a modal file (route files are',
    '                         left out: the navigator presents them); also aria-modal alone on a View or another host',
    '                         that drops it (React Native 0.86.3 maps it only on Pressable and TouchableOpacity/',
    '                         Highlight/NativeFeedback/Bounce; next to accessibilityViewIsModal it is right for the web)',
    '  modal-overlay-android  accessibilityViewIsModal (iOS only) without hiding the content behind it on Android',
    '                         in the same component (aria-hidden or importantForAccessibility="no-hide-descendants"',
    '                         on an element outside the layer, not inside it), and not inside RN <Modal>',
    '  nested-pressable       an accessible pressable that contains another pressable (raw, or a component that',
    '                         renders one): the screen reader reads the outer one and never reaches the inner one',
    '  opener-covered         a sibling drawn after an accessible, absolutely filled pressable (a card opener), or',
    '                         after a component whose returned element is one (a shared <CardOpener>), that takes',
    '                         the touch above it: a layer hidden from screen readers (the card\'s text layer) or',
    '                         text, without pointerEvents "none" (or "box-none" for a wrapper whose children take',
    '                         touches); a visible View over a backdrop button (a sheet card) is left alone',
    '  canvas-image           a Skia <Canvas> that is neither one labelled image (accessible, role image, label)',
    '                         nor explicitly decorative (accessible={false}, aria-hidden)',
    '  hold-alternative       onLongPress on a pressable or a React Native element without accessibilityActions, or',
    '                         a component calling useHoldToConfirm(...) that renders no accessibilityActions',
    '  gesture-alternative    a component with a gesture-only action and no accessibilityActions (or',
    '                         onAccessibilityEscape) spelled out on an element or declared by a component it renders',
    '                         (an opaque spread such as {...rowProps} does not count): Swipeable/ReanimatedSwipeable',
    '                         with renderLeftActions/renderRightActions, a GestureDetector with Gesture.Pan/Pinch/',
    '                         LongPress/Fling/Rotation built in the same component, a legacy *GestureHandler,',
    '                         DraggableFlatList onDragEnd',
    '  adjustable             role adjustable/slider without a value, accessibilityActions and onAccessibilityAction',
    '  screen-test-audit      a screen test that renders but never calls findInaccessiblePressables',
    '  a11y-gates             quality-gates.json a11y.minTouchPt below 44 or a11y.maxFontScale below 2 (the run',
    '                         then uses the floor; quality-gates owns the file)',
    '',
    'A component counts as rendering a pressable, a modal layer, text or accessibility actions only through the',
    'exported function that holds the tag (and the file helpers it calls), never through a sibling export.',
    'A component tag that receives onLongPress (<ListRow onLongPress>) is judged in its own file, where its pressable',
    'must declare the actions.',
    '',
    `${PROJECT_CONFIG_FILE} keys read: srcDir, routesDir (layout) and "a11yGestureExceptions": [{ "file": "src/...tsx",`,
    '"reason": "...", "approvedBy": "..." }] for a gesture the reviewer accepted as essential (WCAG 2.5.1); a listed',
    'file\'s gesture-alternative finding is printed as a note, and an entry that matches no finding is a problem.',
  ].join('\n'),
};

const PRESSABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TouchableNativeFeedback', 'RectButton', 'BorderlessButton', 'BaseButton']);
/** Where aria-modal becomes accessibilityViewIsModal in React Native 0.86.3 (Pressable.js, Touchable*.js). */
const ARIA_MODAL_HOSTS = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableNativeFeedback', 'TouchableBounce']);
/**
 * Hosts that drop aria-modal: View.js maps no aria-modal and the native view configs know only
 * accessibilityViewIsModal; TouchableWithoutFeedback hands it unchanged to its child; RNGH buttons ignore it.
 */
const ARIA_MODAL_DROPPED = new Set(['View', 'Animated.View', 'ScrollView', 'Animated.ScrollView', 'SafeAreaView', 'KeyboardAvoidingView', 'ImageBackground', 'TouchableWithoutFeedback', 'RectButton', 'BorderlessButton', 'BaseButton']);
/** Components that keep both screen readers inside on their own: RN Modal, Gesture Handler's drawers. */
const MODAL_HOSTS = new Set(['Modal', 'DrawerLayout', 'ReanimatedDrawerLayout']);
/** Gesture Handler's swipeable rows: actions revealed by a swipe. */
const SWIPEABLES = new Set(['Swipeable', 'ReanimatedSwipeable']);
/** Gesture Handler 1 style components (still exported by 2.32) whose gesture has no tap equivalent. */
const LEGACY_GESTURE_HANDLERS = new Set(['PanGestureHandler', 'PinchGestureHandler', 'LongPressGestureHandler', 'FlingGestureHandler', 'RotationGestureHandler']);
/** Gesture Handler 2 builders for gestures a screen reader cannot perform. */
const GESTURE_BUILDER = /\bGesture\s*\.\s*(Pan|Pinch|LongPress|Fling|Rotation)\s*\(/;
/** Text hosts: drawn above a card opener they take the touch (hit-testing returns the topmost view with pointerEvents auto). */
const TEXT_HOSTS = new Set(['Text', 'Animated.Text']);
const OVERLAY_FILE = /(^|-)(dialog|overlay|sheet|modal|popover|menu|drawer|popup)\.tsx$/;
const SIZE_KEYS = ['width', 'height', 'minWidth', 'minHeight'];
const DEFAULT_SCREEN_TESTS = ['**/*-screen.test.tsx', '**/screens/**/*.test.tsx'];
const TOUCH_CONSTANT = /^(?:[A-Z_]*\.)?(MIN_TOUCH\w*|MIN_TARGET\w*|TOUCH_TARGET\w*|minTouch\w*|minTarget\w*)$/;
const LETTER = /\p{L}/u;
const REANIMATED = 'react-native-reanimated';
const GESTURE_HANDLER = 'react-native-gesture-handler';
const DRAGGABLE_LIST = 'react-native-draggable-flatlist';
const EXPO_ROUTER = 'expo-router';
const HOST_PACKAGES = new Set(['react-native', GESTURE_HANDLER]);
/** Default imports of single components: Gesture Handler's swipeable entry points and the draggable list. */
const DEFAULT_COMPONENT_IMPORTS = new Map([
  [`${GESTURE_HANDLER}/ReanimatedSwipeable`, { from: GESTURE_HANDLER, imported: 'ReanimatedSwipeable' }],
  [`${GESTURE_HANDLER}/Swipeable`, { from: GESTURE_HANDLER, imported: 'Swipeable' }],
  [DRAGGABLE_LIST, { from: DRAGGABLE_LIST, imported: 'DraggableFlatList' }],
]);
/** Tags whose children the screen reader reads as the pressable's name. */
const TEXT_TAGS = new Set(['AppText', 'T', 'Text']);
/** Components named like icons never count as text: an icon font renders a private-use glyph in Text. */
const ICON_NAME = /(?:Icon|Glyph)s?$/;
const A11Y_STORE_FILE = 'system-a11y-store.ts';
const ANNOUNCE_FILE = 'use-announce.ts';
const STORE_READ = /AccessibilityInfo\.(is\w+Enabled|prefers\w+|addEventListener)\b/g;
const PASS_THROUGH = /\bpointerEvents\s*:\s*['"](?:none|box-none)['"]/;
const isTestFile = (rel) => /\.(test|spec)\.tsx?$/.test(rel);
const isFalseLiteral = (attr) => /^\{?\s*false\s*\}?$/.test(attr?.value?.trim() ?? '');

const GATES_FILE = 'quality-gates.json';
const GATES_FIX = 'Restore the gate in quality-gates.json (quality-gates owns it): a stricter value is fine, a looser one is never the fix and needs the reviewer. This run used the floor.';

/** quality-gates.json's a11y block: { a11y, text } (an empty a11y when the file does not exist), plus error when it is not JSON. */
function readGates(root) {
  const file = join(root, GATES_FILE);
  if (!existsSync(file)) return { a11y: {}, text: '' };
  const text = readFileSync(file, 'utf8');
  try {
    const a11y = JSON.parse(text).a11y;
    return { a11y: a11y && typeof a11y === 'object' ? a11y : {}, text };
  } catch (error) {
    return { a11y: {}, text, error: `${GATES_FILE} is not valid JSON (${error.message})` };
  }
}

/**
 * A threshold: the flag when given (a bad flag is bad input, exit 2), else the gate, else the floor.
 * A gate below its floor is a problem in the gates file (exit 1), and the run uses the floor.
 */
function threshold({ given, gates, key, floor, flag, report }) {
  if (given !== undefined) {
    const value = Number(given);
    if (!Number.isFinite(value) || value < floor) fail(`${flag} ${given} is below the floor ${floor}`, `Pass ${flag} ${floor} or more; the floor is the accessibility minimum, never a tuning knob.`);
    return value;
  }
  const gate = gates.a11y[key];
  if (gate === undefined) return floor;
  if (typeof gate === 'number' && gate >= floor) return gate;
  const match = new RegExp(`"${key}"`).exec(gates.text);
  report.problem({ file: GATES_FILE, line: match ? lineOf(gates.text, match.index) : 1, rule: 'a11y-gates', message: `${GATES_FILE} a11y.${key} is ${JSON.stringify(gate)}, ${typeof gate === 'number' ? `below the floor ${floor}` : `not a number (the floor is ${floor})`}`, fix: GATES_FIX });
  return floor;
}

/** The source folders: --src, else the layout srcDir plus every workspace's srcDir that exists. */
function sourceDirs(root, layout, options) {
  if (options.src.length > 0) return options.src.map((dir) => toPosix(dir).replace(/\/+$/, ''));
  const dirs = [layout.srcDir, ...layout.workspaces.map((workspace) => workspace.layout.srcDir)];
  return [...new Set(dirs)].filter((dir) => existsSync(join(root, dir)));
}

function collectFiles(root, dirs) {
  const include = dirs.flatMap((dir) => (dir === '.' || dir === '' ? ['**/*.ts', '**/*.tsx'] : [`${dir}/**/*.ts`, `${dir}/**/*.tsx`]));
  return walkRepo(root, { include, ignore: ['**/*.d.ts'] });
}

/** The size keys of one object literal's top level: numbers; minTouch for a touch-size constant; null when computed. */
function sizesOf(inner, minTouch) {
  const sizes = {};
  for (const { key, value } of topLevelEntries(inner)) {
    if (!SIZE_KEYS.includes(key)) continue;
    const text = value.trim();
    sizes[key] = /^\d+(\.\d+)?$/.test(text) ? Number(text) : TOUCH_CONSTANT.test(text) ? minTouch : null;
  }
  return sizes;
}

/** True when a style object's text fills its parent: StyleSheet.absoluteFill(Object), or position absolute with inset 0. */
const fillsParent = (text) => /\babsoluteFill(?:Object)?\b/.test(text) || (/\bposition\s*:\s*['"]absolute['"]/.test(text) && /\binset\s*:\s*0\b/.test(text));

/** What one style object says: its size keys, whether it fills its parent, whether touches pass through it. */
const factsOf = (inner, minTouch) => ({ sizes: sizesOf(inner, minTouch), fill: fillsParent(inner), passThrough: PASS_THROUGH.test(inner) });

/**
 * styleName -> facts, from every StyleSheet.create({...}) in the file (makeStyles factories call it too).
 * The blocks are read from the comment-masked source, so string values (pointerEvents: 'none') stay readable.
 */
function styleFacts(source, masked, minTouch) {
  const facts = new Map();
  const text = maskComments(source);
  for (const call of findCalls(masked, 'StyleSheet\\.create')) {
    const open = masked.indexOf('{', call.open);
    if (open === -1 || open > call.close) continue;
    const block = extractBlock(text, open);
    if (!block) continue;
    for (const { key, value } of topLevelEntries(block.inner)) {
      const inner = value.startsWith('{') ? extractBlock(value, 0) : null;
      if (inner) facts.set(key, factsOf(inner.inner, minTouch));
    }
  }
  return facts;
}

/** Names bound to a styles object: styles, and any const = use…Styles() or StyleSheet.create(...). */
function styleBindings(masked) {
  const names = new Set(['styles']);
  for (const m of masked.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:use\w*Styles\s*\(|StyleSheet\.create\s*\()/g)) names.add(m[1]);
  return names;
}

/** Index just past the string or template that starts at `start`. */
function skipString(text, start) {
  let i = start + 1;
  while (i < text.length && text[i] !== text[start]) i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/**
 * The parts of a style expression in order: references to a bound styles object (styles.box, s.box),
 * and inline object literals at expression level (the whole value, array elements, && / ?: operands).
 * A block holding `return` or `;` is a function body and is scanned inside; a destructured arrow
 * parameter is skipped. Each part: { label, sizes, fill, passThrough }.
 */
function styleParts(value, ctx) {
  const parts = [];
  const ref = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/y;
  let i = 0;
  while (i < value.length) {
    const ch = value[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(value, i);
      continue;
    }
    if (ch === '{') {
      const block = extractBlock(value, i);
      if (!block) break;
      if (/\breturn\b|;/.test(block.inner)) {
        i += 1;
        continue;
      }
      // A destructured parameter (({ pressed }) => ...) is not a style.
      if (/^\s*(?::[^)]*)?\)\s*(?::[^=]*)?=>/.test(value.slice(block.close + 1))) {
        i = block.close + 1;
        continue;
      }
      parts.push({ label: 'an inline style', ...factsOf(block.inner, ctx.minTouch) });
      i = block.close + 1;
      continue;
    }
    ref.lastIndex = i;
    const m = /[\w$.]/.test(value[i - 1] ?? '') ? null : ref.exec(value);
    if (m) {
      if (ctx.bindings.has(m[1]) && ctx.styles.has(m[2])) parts.push({ label: m[0], ...ctx.styles.get(m[2]) });
      i += m[0].length;
      continue;
    }
    i += 1;
  }
  return parts;
}

/** The style facts of one tag: its parts, whether it fills its parent, whether touches pass through it. */
function tagStyle(attrs, ctx) {
  const style = attrs.get('style');
  const parts = style?.kind === 'expr' ? styleParts(style.value, ctx) : [];
  const pointerEvents = literalOf(attrs.get('pointerEvents'));
  return {
    parts,
    fill: parts.some((part) => part.fill) || (style?.kind === 'expr' && /\bStyleSheet\.absoluteFill(?:Object)?\b/.test(style.value)),
    passThrough: pointerEvents === 'none' || pointerEvents === 'box-none' || parts.some((part) => part.passThrough),
  };
}

/** null, or how the box falls short ("32 pt wide"); an axis with a computed value is not judged. */
function boxTooSmall(size, minTouch) {
  const axis = (a, b) => {
    const known = [a, b].filter((v) => typeof v === 'number');
    if ([a, b].includes(null) || known.length === 0) return null;
    return Math.max(...known);
  };
  const w = axis(size.width, size.minWidth);
  const h = axis(size.height, size.minHeight);
  if (w !== null && w < minTouch) return `${w} pt wide`;
  if (h !== null && h < minTouch) return `${h} pt tall`;
  return null;
}

/** Words built into an accessibility text: a template with letters outside ${}, or a literal branch of ?: / ?? / ||. */
function builtText(attr) {
  if (!attr || attr.kind !== 'expr') return null;
  const value = attr.value.trim();
  if (/^`[\s\S]*`$/.test(value) && LETTER.test(value.replace(/\$\{[^}]*\}/g, ''))) return value;
  let depth = 0;
  let blanked = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    blanked += depth > 0 ? ' ' : char;
    if (char === ')') depth = Math.max(0, depth - 1);
  }
  const match = /(?:[?:]|\?\?|\|\|)\s*(['"`])((?:(?!\1)[^\\]|\\.)*)\1/u.exec(blanked);
  return match && LETTER.test(match[2]) && !/\$\{/.test(match[2]) ? value : null;
}

/** The body range of an opening tag from findJsxTags (up to its matching closing tag). */
function bodyOf(masked, tag) {
  const closeTag = `</${tag.name}>`;
  const opener = new RegExp(`<${tag.name.replace('.', '\\.')}[\\s>/]`, 'y');
  let depth = 1;
  for (let i = tag.end + 1; i < masked.length; i += 1) {
    if (masked.startsWith(closeTag, i)) {
      depth -= 1;
      if (depth === 0) return { from: tag.end + 1, to: i };
    } else {
      opener.lastIndex = i;
      if (opener.test(masked)) depth += 1;
    }
  }
  return { from: tag.end + 1, to: masked.length };
}

/** The body of a tag, cached per file; a self-closing tag has an empty body at its end. */
function bodyIn(file, tag) {
  if (tag.selfClosing) return { from: tag.end, to: tag.end };
  if (!file.bodies.has(tag)) file.bodies.set(tag, bodyOf(file.masked, tag));
  return file.bodies.get(tag);
}

/** The innermost element whose body holds `tag`, or null at the top of a return. */
function parentOf(file, tag) {
  let parent = null;
  for (const other of file.tags) {
    if (other.start >= tag.start) break;
    if (other.selfClosing) continue;
    const body = bodyIn(file, other);
    if (tag.start > body.from && tag.start < body.to) parent = other;
  }
  return parent;
}

/** The direct children of `parent` that come after `tag` (drawn later, so above it). */
function laterSiblings(file, tag, parent) {
  const limit = bodyIn(file, parent).to;
  let skipUntil = tag.selfClosing ? tag.end : bodyIn(file, tag).to;
  const siblings = [];
  for (const other of file.tags) {
    if (other.start <= skipUntil || other.start >= limit) continue;
    siblings.push(other);
    skipUntil = other.selfClosing ? other.end : bodyIn(file, other).to;
  }
  return siblings;
}

/**
 * True when a pressable may render text itself (the screen reader then reads that text as its name):
 * a text tag, a component that renders text (textNames), or an expression child.
 */
function mayHoldText(masked, tag, textNames) {
  if (tag.selfClosing) return false;
  const { from, to } = bodyOf(masked, tag);
  const body = masked.slice(from, to);
  const childTags = findJsxTags(body, body);
  if (childTags.some((child) => TEXT_TAGS.has(child.name) || textNames.has(child.name))) return true;
  let children = body;
  for (const child of childTags) children = children.slice(0, child.start) + ' '.repeat(child.end - child.start + 1) + children.slice(child.end + 1);
  return children.includes('{');
}

/**
 * Value imports that name a host component: named imports from react-native and Gesture Handler, the
 * default imports in DEFAULT_COMPONENT_IMPORTS, and local aliases made with createAnimatedComponent
 * (const AnimatedPressable = Animated.createAnimatedComponent(Pressable) stands for Pressable).
 * Returns { imports: local name -> { from, imported }, links: local names of expo-router's Link }.
 */
function hostImports(source, masked) {
  const map = new Map();
  const links = new Set();
  for (const imp of findImports(source, masked)) {
    if (/^import\s+type\b/.test(imp.text)) continue;
    const fallback = DEFAULT_COMPONENT_IMPORTS.get(imp.from);
    const defaultName = /^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/.exec(imp.text)?.[1];
    if (fallback && defaultName) map.set(defaultName, fallback);
    if (!HOST_PACKAGES.has(imp.from) && imp.from !== EXPO_ROUTER && imp.from !== DRAGGABLE_LIST) continue;
    const braces = /\{([^}]*)\}/.exec(imp.text);
    for (const part of braces ? braces[1].split(',') : []) {
      const m = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (!m || /^\s*type\s/.test(part)) continue;
      if (imp.from === EXPO_ROUTER) {
        if (m[1] === 'Link') links.add(m[2] ?? m[1]);
      } else if (imp.from !== DRAGGABLE_LIST) map.set(m[2] ?? m[1], { from: imp.from, imported: m[1] });
    }
  }
  for (const m of masked.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Animated\s*\.\s*)?createAnimatedComponent\s*(?:<[^>()]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    if (map.has(m[2])) map.set(m[1], map.get(m[2]));
  }
  return { imports: map, links };
}

const DECLARATION = /(export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)?/y;

/**
 * The top-level declarations of a module, in order: [{ name, exported, start, end }]. A declaration
 * runs to the start of the next one, so every tag belongs to the declaration it is written in.
 * `export { A, B as C }` marks A and B exported (C is the public name).
 */
function topLevelDeclarations(masked) {
  const decls = [];
  let depth = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[a-z]/.test(ch) && (i === 0 || /[\s;}]/.test(masked[i - 1]))) {
      DECLARATION.lastIndex = i;
      const m = DECLARATION.exec(masked);
      if (!m || (!m[2] && !m[1])) continue;
      decls.push({ name: m[2] ?? 'default', exported: Boolean(m[1]), start: i });
      i += m[0].length - 1;
    }
  }
  for (const list of masked.matchAll(/(?:^|[\s;}])export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of list[1].split(',')) {
      const m = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      const decl = m && decls.find((d) => d.name === m[1]);
      if (decl) Object.assign(decl, { exported: true, publicName: m[2] ?? m[1] });
    }
  }
  return decls.map((decl, k) => ({ ...decl, end: decls[k + 1]?.start ?? masked.length }));
}

/** A declaration plus the file's non-exported helpers it names, to a fixed point inside the file. */
function reachedFrom(decl, decls, masked) {
  const reached = new Set([decl]);
  const queue = [decl];
  while (queue.length > 0) {
    const text = masked.slice(queue[0].start, queue.shift().end);
    for (const helper of decls) {
      if (reached.has(helper) || helper.exported || !new RegExp(`(?<![\\w$])${helper.name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text)) continue;
      reached.add(helper);
      queue.push(helper);
    }
  }
  return [...reached];
}

/**
 * The exported components of a file with the tags each one renders: its own tags plus those of the
 * file's non-exported helpers it names. [{ name, tags, own, text }] (own: the tags written in the
 * component itself; text: the code of the component and its helpers).
 */
function exportedComponents(file) {
  const decls = topLevelDeclarations(file.masked);
  const tagsOf = (decl) => file.tags.filter((tag) => tag.start >= decl.start && tag.start < decl.end);
  return decls.filter((decl) => decl.exported).map((decl) => {
    const reached = reachedFrom(decl, decls, file.masked);
    return { name: decl.publicName ?? decl.name, tags: reached.flatMap(tagsOf), own: tagsOf(decl), text: reached.map((d) => file.masked.slice(d.start, d.end)).join('\n') };
  });
}

/** The style facts of a file: its StyleSheet blocks (styles) and the names bound to them (bindings). */
const styleContext = (source, masked, minTouch) => ({ styles: styleFacts(source, masked, minTouch), bindings: styleBindings(masked) });

function parseSources(root, files, minTouch) {
  return files
    .filter((rel) => rel.endsWith('.tsx') && !isTestFile(rel))
    .map((rel) => {
      const source = readFileSync(join(root, rel), 'utf8');
      const masked = maskCode(source);
      const tags = findJsxTags(source, masked);
      const attrs = new Map(tags.map((tag) => [tag, jsxAttributes(source, tag, masked)]));
      const { imports, links } = hostImports(source, masked);
      const file = { rel, source, masked, tags, attrs, imports, links, bodies: new Map(), style: styleContext(source, masked, minTouch) };
      return { ...file, components: exportedComponents(file) };
    });
}

/** The React Native or Gesture Handler name a tag stands for (an aliased import resolves), else its own name. */
const hostName = (file, tag) => file.imports.get(tag.name)?.imported ?? tag.name;
const isPressableTag = (file, tag) => PRESSABLES.has(hostName(file, tag));

/**
 * Exported component names that render a tag satisfying isSeed(file, tag), or another such component,
 * to a fixed point. Each tag counts for the component whose body holds it, never for its siblings.
 * A name for which exclude(name) holds never enters the set (so nothing inherits through it).
 */
function componentsRendering(sources, isSeed, exclude = () => false) {
  const names = new Set();
  const candidates = sources.flatMap((file) => file.components.map((component) => ({ file, component })));
  let changed = true;
  while (changed) {
    changed = false;
    for (const { file, component } of candidates) {
      if (names.has(component.name) || exclude(component.name) || !component.tags.some((tag) => isSeed(file, tag) || names.has(tag.name))) continue;
      names.add(component.name);
      changed = true;
    }
  }
  return names;
}

/** True when the tag is the root of a returned element: no element around it, written right after `return` or `=>`. */
function isReturnedRoot(file, tag) {
  if (parentOf(file, tag) !== null) return false;
  return /(?:\breturn|=>)[\s(]*$/.test(file.masked.slice(Math.max(0, tag.start - 80), tag.start));
}

/**
 * Exported components that are card openers: the element they return is an accessible pressable that
 * fills its parent (StyleSheet.absoluteFill, or position absolute with inset 0), or another such
 * component, to a fixed point. A screen that draws text above one of them has the same covered opener
 * as a raw one (a shared CardOpener with the text layer left in the feature).
 */
function openerComponents(sources, ctx) {
  const names = new Set();
  const candidates = sources.flatMap((file) => file.components.map((component) => ({ file, component })));
  const isOpenerRoot = (file, tag) => {
    const attrs = file.attrs.get(tag);
    if (isHiddenFromReaders(attrs) || !isReturnedRoot(file, tag)) return false;
    return names.has(tag.name) || (isPressableTag(file, tag) && tagStyle(attrs, { ...ctx, ...file.style }).fill);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const { file, component } of candidates) {
      if (names.has(component.name) || !component.own.some((tag) => isOpenerRoot(file, tag))) continue;
      names.add(component.name);
      changed = true;
    }
  }
  return names;
}

/** The tag that makes this file's layer modal for VoiceOver, or undefined. */
const modalFlagOf = (file) => file.tags.find((tag) => {
  const attrs = file.attrs.get(tag);
  return attrs.has('accessibilityViewIsModal') || (attrs.has('aria-modal') && ARIA_MODAL_HOSTS.has(hostName(file, tag)));
});
/** A tag that keeps a layer modal on its own: the iOS flag (or a mapped aria-modal), RN Modal, a drawer. */
const isModalSeed = (file, tag) => tag === modalFlagOf(file) || MODAL_HOSTS.has(hostName(file, tag));
/**
 * Tags whose aria-modal React Native drops: aria-modal alone on a View-like host. Next to
 * accessibilityViewIsModal it is right (react-native-web maps aria-modal, not the iOS flag).
 */
const droppedAriaModal = (file) => file.tags.filter((tag) => {
  const attrs = file.attrs.get(tag);
  return ARIA_MODAL_DROPPED.has(hostName(file, tag)) && attrs.has('aria-modal') && !attrs.has('accessibilityViewIsModal');
});
const rendersModalHost = (file) => file.tags.some((tag) => MODAL_HOSTS.has(hostName(file, tag)));

const isStaticTrue = (attr) => attr !== undefined && (attr.kind === 'bool' || (attr.kind === 'expr' && attr.value === 'true'));

/** True when the element is always hidden from both screen readers (and so needs no role or name). */
function isHiddenFromReaders(attrs) {
  if (isFalseLiteral(attrs.get('accessible'))) return true;
  if (isStaticTrue(attrs.get('aria-hidden'))) return true;
  return isStaticTrue(attrs.get('accessibilityElementsHidden')) && /no-hide-descendants/.test(attrs.get('importantForAccessibility')?.value ?? '');
}

/** True when the element hides itself from a screen reader in any way (also only sometimes). */
const hidesItself = (attrs) => attrs.has('aria-hidden') || attrs.has('accessibilityElementsHidden') || isFalseLiteral(attrs.get('accessible')) || /no-hide-descendants|['"]no['"]|^no$/.test(attrs.get('importantForAccessibility')?.value ?? '');

/**
 * attrs.has(name), or a spread that may supply it: an opaque spread ({...props}, {...a11yProps(x)})
 * may supply any attribute; one built from object literals supplies only the names it spells out.
 */
function giverOf(attrs, { opaqueGives = true } = {}) {
  const spreads = [...attrs].filter(([k]) => k.startsWith('...')).map(([, v]) => v.value.replace(/^\.\.\./, '').trim());
  // A whole name: aria-label is not inside aria-labelledby, accessibilityLabel not inside accessibilityLabelledBy.
  const spells = (text, name) => new RegExp(`(?<![\\w$-])${name}(?![\\w$-])`).test(text);
  return (name) => attrs.has(name) || spreads.some((text) => (opaqueGives && !text.includes('{')) || spells(text, name));
}

/**
 * True when the file hides what is behind the modal layer `flag` from TalkBack: aria-hidden or
 * importantForAccessibility="no-hide-descendants" on an element outside the layer and not around it.
 * An element inside the layer (a decorative grip) hides nothing behind it; a self-closing element
 * outside it counts only with a changing value (aria-hidden={isOpen}), because a static one is
 * decoration too.
 */
function hidesBehindOnAndroid(file, flag) {
  const layer = flag.selfClosing ? { from: flag.end, to: flag.end } : bodyOf(file.masked, flag);
  return file.tags.some((tag) => {
    if (tag === flag || (tag.start > layer.from && tag.start < layer.to)) return false;
    const attrs = file.attrs.get(tag);
    const hidden = attrs.get('aria-hidden');
    const important = attrs.get('importantForAccessibility');
    if (!hidden && !/no-hide-descendants/.test(important?.value ?? '')) return false;
    if (!tag.selfClosing && tag.start < flag.start) {
      const around = bodyOf(file.masked, tag);
      if (flag.start > around.from && flag.start < around.to) return false;
    }
    return !tag.selfClosing || (hidden ? !isStaticTrue(hidden) : important.kind === 'expr');
  });
}

function checkScreenTest(rel, masked, ctx) {
  const isScreenTest = rel.endsWith('.test.tsx') && ctx.screenTests.some((glob) => matchGlob(rel, glob));
  if (isScreenTest && /\brender\w*\s*\(/.test(masked) && !/\bfindInaccessiblePressables\s*\(/.test(masked)) {
    ctx.report.problem({ file: rel, line: 1, rule: 'screen-test-audit', message: 'this screen test renders UI but never audits it', fix: 'End the test with expect(findInaccessiblePressables(screen.container)).toStrictEqual([]) (import it from @test/a11y/find-inaccessible-pressables).' });
  }
}

function checkModuleRules(rel, source, masked, problem) {
  for (const imp of findImports(source, masked)) {
    if (imp.from === REANIMATED && /\buseReducedMotion\b/.test(imp.text)) problem(imp.index, 'reduce-motion', "Reanimated's useReducedMotion returns the value captured when the module loaded: it misses live changes and the in-app setting", 'Use useReduceMotion() from @/ui/a11y/use-reduce-motion.');
  }
  if (basename(rel) !== A11Y_STORE_FILE) {
    for (const m of masked.matchAll(STORE_READ)) problem(m.index, 'a11y-store', `AccessibilityInfo.${m[1]} is read outside the system accessibility store`, 'Read systemA11yStore (useReduceMotion(), useStore(systemA11yStore, selector)); a switch the store does not mirror yet is added there, in watchSystemA11y, so the app keeps one subscription per switch.');
  }
  if (basename(rel) !== ANNOUNCE_FILE) {
    for (const m of masked.matchAll(/AccessibilityInfo\.announceForAccessibility\w*\b/g)) problem(m.index, 'announce', 'announceForAccessibility is called directly', 'Use useAnnounce() from @/ui/a11y/use-announce: it speaks only while a screen reader runs, queued behind speech already playing, one short announcement per action.');
  }
}

function checkTextAttributes(attrs, ctx, problem) {
  for (const name of ['accessibilityLabel', 'accessibilityHint', 'aria-label']) {
    const attr = attrs.get(name);
    const literal = literalOf(attr);
    const built = literal === null ? builtText(attr) : null;
    if ((literal !== null && LETTER.test(literal)) || built !== null) problem(attr.index, 'literal-a11y-text', `${name}=${literal !== null ? `"${literal}"` : `{${built}}`} is not translated`, `Pass ${name}={t('area.element.a11y-label', { ... })} from the catalog; numbers go in as ICU values, never glued into the text.`);
  }
  const scaling = attrs.get('allowFontScaling');
  if (scaling && /false/.test(scaling.value)) problem(scaling.index, 'font-scaling', 'allowFontScaling={false} turns text scaling off', `Remove it; text must grow to at least ${ctx.fontCap * 100} %. Reflow the layout instead (minHeight, wrap, stack).`);
  const multiplier = attrs.get('maxFontSizeMultiplier');
  if (multiplier && /^\d+(\.\d+)?$/.test(multiplier.value) && Number(multiplier.value) > 0 && Number(multiplier.value) < ctx.fontCap) problem(multiplier.index, 'font-scaling', `maxFontSizeMultiplier={${multiplier.value}} caps text below ${ctx.fontCap}x`, `Use ${ctx.fontCap} or more (0 means no cap); only the text primitive sets it.`);
  if (attrs.has('hitSlop')) problem(attrs.get('hitSlop').index, 'hit-slop', 'hitSlop is used to enlarge the target', `Make the pressable's own box at least ${ctx.minTouch} x ${ctx.minTouch} pt (minWidth/minHeight from the touch-size token).`);
}

/**
 * React Native's Pressable and Touchables copy disabled into accessibilityState.disabled themselves
 * (Pressable.js, Touchable*.js in 0.86.3). Gesture Handler 2.32's do not: its Pressable uses disabled only
 * to turn the gesture off, its buttons take enabled, and its touchables pass accessibilityState through.
 * The native button sets Android's View.isEnabled (TalkBack hears it); iOS traits and RNTL read only
 * accessibilityState.
 */
function checkDisabledState(tag, attrs, file, gives, problem) {
  if (file.imports.get(tag.name)?.from !== GESTURE_HANDLER || gives('accessibilityState') || gives('aria-disabled')) return;
  const enabled = attrs.get('enabled');
  const prop = attrs.has('disabled') ? 'disabled' : enabled && !isStaticTrue(enabled) ? 'enabled' : null;
  if (prop === null) return;
  const name = hostName(file, tag);
  problem(attrs.get(prop).index, 'disabled-state', `Gesture Handler's <${name}> does not turn ${prop} into accessibilityState (React Native's own Pressable and Touchables do), so VoiceOver and getByRole/toBeDisabled() read it as active while it ignores taps (only TalkBack sees the native enabled flag)`, `Also pass accessibilityState={{ disabled: ${prop === 'enabled' ? '!<the enabled condition>' : '<the same condition>'} }} (or aria-disabled), with busy, checked or selected where they apply; or use React Native's Pressable, which derives it from disabled.`);
}

function checkPressable(tag, attrs, file, ctx, problem) {
  const gives = giverOf(attrs);
  const isAccessible = !isFalseLiteral(attrs.get('accessible'));
  if (isAccessible && !tag.selfClosing) {
    const body = bodyIn(file, tag);
    const inner = file.tags.find((other) => other.start > body.from && other.start < body.to && (isPressableTag(file, other) || ctx.pressableNames.has(other.name)));
    if (inner) problem(inner.start, 'nested-pressable', `<${inner.name}> sits inside an accessible <${tag.name}>, so the screen reader reads only the outer element and never reaches this one`, 'Make them siblings: the opener is an absolutely filled pressable under the content (role button, a label joining the visible texts, which hide from the screen reader and pass touches through), and the action is a separate element above it (references/roles-names-and-screen-readers.md).');
  }
  const parent = parentOf(file, tag);
  const inLink = parent !== null && file.links.has(parent.name);
  // expo-router's Link with asChild hands role 'link' and onPress to its one child (useLinkToPathProps.js).
  const hasRole = gives('accessibilityRole') || gives('role') || (inLink && file.attrs.get(parent).has('asChild'));
  if (!isHiddenFromReaders(attrs)) {
    if (!hasRole) problem(tag.start, 'pressable-role', `<${tag.name}> has no accessibilityRole`, inLink ? 'Add asChild to the <Link> (it gives its one child role link), or accessibilityRole="link"; never "button" for navigation.' : "Add accessibilityRole=\"button\" (or 'switch', 'checkbox', 'tab', 'link', 'radio' where true); VoiceOver, TalkBack and getByRole need it.");
    if (!gives('accessibilityLabel') && !gives('aria-label') && !mayHoldText(file.masked, tag, ctx.textNames)) {
      const androidOnly = gives('aria-labelledby') || gives('accessibilityLabelledBy') ? ' (aria-labelledby and accessibilityLabelledBy name it on Android only; VoiceOver reads nothing)' : '';
      problem(tag.start, 'pressable-name', `<${tag.name}> has no accessibilityLabel and no text inside${androidOnly}`, 'Pass accessibilityLabel={label} (translated by t() in the model hook); icon-only buttons take a required label prop. A pressable no screen reader should focus (a backdrop, a keyboard-dismiss area) says so with accessible={false} and duplicates an action reachable another way.');
    }
  }
  checkDisabledState(tag, attrs, file, gives, problem);
  const { parts } = tagStyle(attrs, ctx);
  const merged = {};
  for (const part of parts) for (const key of SIZE_KEYS) if (part.sizes[key] !== undefined) merged[key] = part.sizes[key];
  const small = parts.length > 0 ? boxTooSmall(merged, ctx.minTouch) : null;
  if (small) problem(attrs.get('style').index, 'touch-target', `<${tag.name}> is only ${small} (style: ${parts.map((part) => part.label).join(', ')})`, `Give the pressable itself at least ${ctx.minTouch} x ${ctx.minTouch} pt (minWidth/minHeight from the touch-size token) and centre the smaller glyph inside it.`);
}

/**
 * A card opener is an accessible pressable that fills its parent, or a component whose returned element
 * is one (openerNames). Every later sibling is drawn above it, and the touch goes to the topmost view under
 * the finger (Android TouchTargetHelper walks children from the last; UIKit hit-testing too); the
 * responder then bubbles through ancestors only, never to a sibling.
 */
function checkOpenerCover(tag, attrs, file, ctx, problem) {
  const isComponent = !isPressableTag(file, tag);
  if (isHiddenFromReaders(attrs) || (!isComponent && !tagStyle(attrs, ctx).fill)) return;
  const parent = parentOf(file, tag);
  if (parent === null) return;
  for (const sibling of laterSiblings(file, tag, parent)) {
    if (isPressableTag(file, sibling) || ctx.pressableNames.has(sibling.name)) continue;
    const siblingAttrs = file.attrs.get(sibling);
    // A hidden layer duplicates what the opener says, so it is decoration that must let touches through;
    // a visible View over a full-screen backdrop button (a sheet's card) blocks them on purpose.
    const takesTouch = hidesItself(siblingAttrs) || TEXT_HOSTS.has(hostName(file, sibling)) || TEXT_TAGS.has(sibling.name) || ctx.textNames.has(sibling.name);
    if (!takesTouch || tagStyle(siblingAttrs, ctx).passThrough) continue;
    const opener = isComponent ? `<${tag.name}> opener (it renders an absolutely filled pressable)` : `absolutely filled <${tag.name}> opener`;
    const together = isComponent ? '; better, keep the opener and the text layer above it in one src/ui card component, so no screen can leave it out' : '';
    problem(sibling.start, 'opener-covered', `<${sibling.name}> is drawn above the ${opener} and takes the touches there, so tapping the card's text does nothing on a device (RNTL's press on the opener cannot see this)`, `Give the layer style pointerEvents: 'none' (or 'box-none' for a wrapper whose children are buttons), so taps fall through to the opener; keep the action buttons as pressables above it${together}.`);
  }
}

/** Components that render an element with explicitly declared accessibility actions (an opaque spread does not count). */
const declaresActions = (file, tag) => giverOf(file.attrs.get(tag), { opaqueGives: false })('accessibilityActions');

/**
 * True when some tag offers a screen-reader alternative: accessibilityActions (or escape) here or in a
 * component that declares them. opaqueGives: whether an opaque spread ({...rowProps}) may count as one.
 */
function offersActions(file, tags, ctx, { opaqueGives = true } = {}) {
  return tags.some((tag) => {
    const gives = giverOf(file.attrs.get(tag), { opaqueGives });
    return gives('accessibilityActions') || gives('onAccessibilityEscape') || ctx.actionNames.has(tag.name);
  });
}

function checkHolds(file, ctx, problem) {
  for (const tag of file.tags) {
    const attrs = file.attrs.get(tag);
    if (!attrs.has('onLongPress') || !(isPressableTag(file, tag) || file.imports.has(tag.name))) continue;
    if (giverOf(attrs)('accessibilityActions')) continue;
    problem(attrs.get('onLongPress').index, 'hold-alternative', `onLongPress on <${tag.name}> has no screen-reader alternative`, "Add accessibilityActions={[{ name: 'longpress', label: t(...) }]} with onAccessibilityAction calling the same handler (TalkBack sends longpress on double-tap-and-hold; VoiceOver lists it in the Actions rotor), or offer the action with one tap elsewhere.");
  }
  const decls = topLevelDeclarations(file.masked);
  for (const call of file.masked.matchAll(/(?<!function\s+)\buseHoldToConfirm\s*\(/g)) {
    const decl = decls.findLast((d) => d.start <= call.index);
    if (!decl) continue;
    const reached = reachedFrom(decl, decls, file.masked);
    const tags = file.tags.filter((tag) => reached.some((d) => tag.start >= d.start && tag.start < d.end));
    if (!offersActions(file, tags, ctx)) problem(call.index, 'hold-alternative', `${decl.name} confirms with a hold but renders no screen-reader alternative`, "Add accessibilityActions (for example [{ name: 'activate' }]) with onAccessibilityAction on the held pressable, or confirm through a dialog.");
  }
}

/** The gesture-only actions a component renders: [{ index, what }]. */
function gestureTriggers(file, component) {
  const triggers = [];
  for (const tag of component.tags) {
    const attrs = file.attrs.get(tag);
    const name = hostName(file, tag);
    const from = file.imports.get(tag.name)?.from;
    if (SWIPEABLES.has(name) && (attrs.has('renderLeftActions') || attrs.has('renderRightActions'))) triggers.push({ index: tag.start, what: `<${tag.name}> reveals row actions with a swipe` });
    else if (from === GESTURE_HANDLER && LEGACY_GESTURE_HANDLERS.has(name)) triggers.push({ index: tag.start, what: `<${tag.name}> acts on a gesture` });
    else if (name === 'DraggableFlatList' && attrs.has('onDragEnd')) triggers.push({ index: tag.start, what: `<${tag.name}> reorders by dragging` });
    else if (name === 'GestureDetector' && from === GESTURE_HANDLER) {
      const built = GESTURE_BUILDER.exec(component.text);
      if (built) triggers.push({ index: tag.start, what: `<GestureDetector> runs Gesture.${built[1]}()` });
    }
  }
  return triggers;
}

/** The reviewed gesture exceptions from rn-skills.config.json: Map file -> entry; malformed entries are problems. */
function gestureExceptions(layout, report) {
  const list = layout.config?.a11yGestureExceptions;
  const map = new Map();
  if (list === undefined) return map;
  const bad = (message) => report.problem({ file: PROJECT_CONFIG_FILE, line: 1, rule: 'gesture-alternative', message, fix: 'Write "a11yGestureExceptions": [{ "file": "src/...tsx", "reason": "why the gesture is essential", "approvedBy": "the reviewer" }], added only after the developer agreed.' });
  if (!Array.isArray(list)) {
    bad('"a11yGestureExceptions" is not a list');
    return map;
  }
  list.forEach((entry, index) => {
    const text = (key) => typeof entry?.[key] === 'string' && entry[key].trim() !== '';
    if (!text('file') || !text('reason') || !text('approvedBy')) bad(`a11yGestureExceptions[${index}] needs "file", "reason" and "approvedBy": an exception without a recorded reason is a silenced failure`);
    else map.set(toPosix(entry.file).replace(/^\.\//, ''), entry);
  });
  return map;
}

function checkGestures(file, ctx, problem) {
  const seen = new Set();
  for (const component of file.components) {
    // Spelled out, not assumed: <TaskRow {...rowProps} /> under a swipeable offers nothing unless TaskRow declares the actions.
    if (offersActions(file, component.tags, ctx, { opaqueGives: false })) continue;
    for (const trigger of gestureTriggers(file, component)) {
      if (seen.has(trigger.index)) continue;
      seen.add(trigger.index);
      const exception = ctx.gestureExceptions.get(file.rel);
      if (exception) {
        ctx.usedExceptions.add(file.rel);
        ctx.report.note(`note: ${file.rel} [gesture-alternative] ${trigger.what} without accessibilityActions (exception: ${exception.reason}; approved by ${exception.approvedBy})`);
        continue;
      }
      problem(trigger.index, 'gesture-alternative', `${trigger.what}, but ${component.name} offers no accessibilityActions: VoiceOver and TalkBack use swipes to move focus, so the action is unreachable (WCAG 2.5.1, 2.5.7)`, "Expose each action on the row's accessible element as accessibilityActions={[{ name: 'complete', label: t(...) }, { name: 'delete', label: t(...) }]} with onAccessibilityAction (the VoiceOver Actions rotor, the TalkBack actions menu), and give pointer users a one-tap way too (a button, a menu item).");
    }
  }
}

function checkAdjustable(tag, attrs, problem) {
  const role = literalOf(attrs.get('accessibilityRole')) ?? literalOf(attrs.get('role'));
  if (role !== 'adjustable' && role !== 'slider') return;
  const gives = giverOf(attrs);
  const missing = [];
  if (!gives('accessibilityValue') && !gives('aria-valuenow') && !gives('aria-valuetext')) missing.push('accessibilityValue');
  for (const name of ['accessibilityActions', 'onAccessibilityAction']) if (!gives(name)) missing.push(name);
  if (missing.length > 0) problem(tag.start, 'adjustable', `an adjustable control lacks ${missing.join(', ')}`, "Give sliders accessibilityValue={{ min, max, now }}, accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} and onAccessibilityAction handling both; without the declared actions the swipe up/down (VoiceOver) or volume keys (TalkBack) do nothing.");
}

function checkCanvas(tag, attrs, problem) {
  if (tag.name !== 'Canvas') return;
  const decorative = isFalseLiteral(attrs.get('accessible')) || attrs.has('aria-hidden') || attrs.has('accessibilityElementsHidden') || /no-hide-descendants/.test(attrs.get('importantForAccessibility')?.value ?? '');
  if (decorative || [...attrs.keys()].some((k) => k.startsWith('...'))) return;
  const role = literalOf(attrs.get('accessibilityRole')) ?? literalOf(attrs.get('role'));
  const isImage = attrs.has('accessible') && (role === 'image' || role === 'img') && (attrs.has('accessibilityLabel') || attrs.has('aria-label'));
  if (!isImage) problem(tag.start, 'canvas-image', 'this canvas is neither one labelled image nor marked decorative, so the screen reader skips what it shows', 'Give the Canvas accessible, accessibilityRole="image" and accessibilityLabel={t(...)} of a pure describe(state); or mark decoration with accessible={false}.');
}

function checkOverlay(file, ctx, problem) {
  const name = basename(file.rel);
  const dropped = droppedAriaModal(file);
  for (const tag of dropped) problem(tag.start, 'modal-overlay', `aria-modal alone on <${tag.name}> does nothing on iOS: React Native 0.86.3 maps aria-modal to accessibilityViewIsModal only on Pressable and TouchableOpacity/Highlight/NativeFeedback/Bounce, so VoiceOver can still leave this layer`, `Add accessibilityViewIsModal to this <${tag.name}> (the overlay root, the scrim); keep aria-modal next to it when the app also runs on the web (react-native-web maps aria-modal), and keep aria-hidden on the content behind it for TalkBack.`);
  const isRoute = ctx.routeDirs.some((dir) => file.rel.startsWith(`${dir}/`));
  const isModal = file.tags.some((tag) => isModalSeed(file, tag) || ctx.modalNames.has(tag.name));
  if (OVERLAY_FILE.test(name) && !isRoute && dropped.length === 0 && !isModal) problem(0, 'modal-overlay', `${name} is an overlay that is not modal`, 'Present it as an Expo Router modal route or in RN <Modal>, or set accessibilityViewIsModal on the overlay root (the scrim, never the card inside) and hide the content behind it on Android. If it is not an overlay, rename it so its name does not end in an overlay word.');
  const flag = modalFlagOf(file);
  if (flag && !rendersModalHost(file) && !hidesBehindOnAndroid(file, flag)) problem(flag.start, 'modal-overlay-android', 'accessibilityViewIsModal is iOS only: TalkBack can still reach the content behind this overlay', "In the same component, hide the content behind the layer while it is open (aria-hidden={isOpen} on the sibling that holds the screen, or importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}; a hidden element inside the layer hides nothing behind it), or render the overlay in RN <Modal>.");
}

/** Route folders: --routes-dir, else the layout routesDir and every workspace routesDir. */
function routeDirs(layout, given) {
  if (given.length > 0) return given.map((dir) => toPosix(dir).replace(/\/+$/, ''));
  return [...new Set([layout.routesDir, ...layout.workspaces.map((workspace) => workspace.layout.routesDir)])];
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const rootArg = positionals[0] ?? '.';
  const root = requireDir(rootArg, 'app repo root');
  const layout = resolveLayout(root);
  const dirs = sourceDirs(root, layout, options);
  const files = dirs.length === 0 ? [] : collectFiles(root, dirs);
  if (files.length === 0) fail(`nothing to check: no .ts/.tsx files under ${dirs.length > 0 ? dirs.join(', ') : 'src/'} in ${rootArg}`, 'Run from the app repo root, or pass --src <dir>.');
  const report = createReporter({ name: 'check-a11y-code', json: options.json });
  const gates = readGates(root);
  if (gates.error) report.problem({ file: GATES_FILE, line: 1, rule: 'a11y-gates', message: gates.error, fix: 'Repair the JSON (quality-gates owns the file); this run used the floors 44 pt and 2x.' });
  const minTouch = threshold({ given: options['min-touch'], gates, key: 'minTouchPt', floor: 44, flag: '--min-touch', report });
  const fontCap = threshold({ given: options['font-cap'], gates, key: 'maxFontScale', floor: 2, flag: '--font-cap', report });
  const sources = parseSources(root, files, minTouch);
  const ctx = {
    report,
    minTouch,
    fontCap,
    screenTests: options['screen-test'].length > 0 ? options['screen-test'] : DEFAULT_SCREEN_TESTS,
    modalNames: componentsRendering(sources, isModalSeed),
    pressableNames: componentsRendering(sources, isPressableTag),
    openerNames: openerComponents(sources, { minTouch }),
    textNames: componentsRendering(sources, (file, tag) => TEXT_TAGS.has(tag.name), (name) => ICON_NAME.test(name)),
    actionNames: componentsRendering(sources, declaresActions),
    routeDirs: routeDirs(layout, options['routes-dir']),
    gestureExceptions: gestureExceptions(layout, report),
    usedExceptions: new Set(),
  };
  const parsed = new Map(sources.map((file) => [file.rel, file]));

  for (const rel of files) {
    const source = readFileSync(join(root, rel), 'utf8');
    const masked = maskCode(source);
    const problem = (index, rule, message, fix) => report.problem({ file: rel, line: lineOf(source, index), rule, message, fix });
    if (isTestFile(rel)) {
      checkScreenTest(rel, masked, ctx);
      continue;
    }
    checkModuleRules(rel, source, masked, problem);
    const file = parsed.get(rel);
    if (!file) continue;
    const fileCtx = { ...ctx, ...file.style };
    for (const tag of file.tags) {
      const attrs = file.attrs.get(tag);
      checkTextAttributes(attrs, ctx, problem);
      checkAdjustable(tag, attrs, problem);
      checkCanvas(tag, attrs, problem);
      if (isPressableTag(file, tag)) {
        checkPressable(tag, attrs, file, fileCtx, problem);
        checkOpenerCover(tag, attrs, file, fileCtx, problem);
      } else if (ctx.openerNames.has(tag.name)) {
        checkOpenerCover(tag, attrs, file, fileCtx, problem);
      }
    }
    checkHolds(file, ctx, problem);
    checkGestures(file, ctx, problem);
    checkOverlay(file, ctx, problem);
  }
  for (const [file] of ctx.gestureExceptions) {
    if (!ctx.usedExceptions.has(file)) report.problem({ file: PROJECT_CONFIG_FILE, line: 1, rule: 'gesture-alternative', message: `a11yGestureExceptions names ${file}, which has no gesture-alternative finding`, fix: 'Remove the stale exception: the file offers its actions now, or no longer exists.' });
  }
  return report.finish({ checked: files.length, unit: 'source files' });
});
