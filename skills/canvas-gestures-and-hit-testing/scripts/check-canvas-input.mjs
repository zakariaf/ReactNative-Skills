#!/usr/bin/env node
// check-canvas-input.mjs: checks the touch input of an Expo app's canvases against the rules of the
// canvas-gestures-and-hit-testing skill: one gesture module, at most one intent per gesture,
// hit-testing through the shared layout with slop, physical coordinates, worklet-safe callbacks,
// a pure and exhaustive intent function per surface, touch targets, and the Gesture Handler API.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-canvas-input.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, requireDir, run } from './check-lib.mjs';
import { DIRECTION_FREE_FILES, GESTURE_MODULE, inputScope, isInside, KIT_FILES, RNGH_PACKAGE, UI_THREAD_FILES, WORKLETS_API_FILES } from './lib/input-scope.mjs';
import { findClosing, findImports, findJsxTags, hasWorkletDirective, isTestFile, jsxAttributes, maskCode, readRepoFile, resolveImport, valueImports } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-canvas-input',
  summary: 'Checks the touch input of the canvases (the input kit, default src/canvas/gestures, every surface folder that takes touch, and every app file in the canvas scope) for the input rules of canvas-gestures-and-hit-testing.',
  usage: '[repo-root] [options]',
  options: {
    surface: { type: 'string', multiple: true, value: 'id', help: 'Only check the surface side (intent function, hit-targets test) of these surface ids; the input kit is always checked' },
    'kit-dir': { type: 'string', multiple: true, value: 'dir', help: 'The canvas kit folder (default: <srcDir>/canvas, or rn-skills.config.json "canvasKitDir")' },
    'gestures-dir': { type: 'string', multiple: true, value: 'dir', help: 'The input kit folder (default: <kit>/gestures, or rn-skills.config.json "canvasGesturesDir")' },
    'surface-dir': { type: 'string', multiple: true, value: 'glob', help: 'Surface folders (default: <featuresDir>/*/canvas and <srcDir>/games/*/canvas, or "canvasSurfaceDirs")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Canvas scope: the canvas kit folder, every surface folder, every app file that renders <Canvas>, <SurfaceCanvas>',
    'or <SurfaceHost>, every app file whose import feeds a canvas (named in a canvas GestureDetector gesture={...} or a',
    '<SurfaceCanvas input={...}>, directly or through a local const, or a component rendered around a canvas), and the',
    'feature folder (<featuresDir>/<feature>/) of a surface that takes touch or of a file that hands touch to a canvas',
    '(<SurfaceCanvas input=...>, a <GestureDetector> around a canvas; its model hook wires the input), minus',
    'contracts/canvas-input.json "gestureExempt". In that feature folder a self-contained control is left out: a .tsx',
    'file that renders its own <GestureDetector> around no canvas (nor a component that renders one), imports no value',
    'from the canvas kit or a surface folder and calls neither useCanvasGestures nor makeStickGesture (a bottom sheet,',
    'a swipeable row). The feature folder of a display-only canvas is not in scope at all.',
    'A surface takes touch when contracts/canvas-input.json lists it, when it holds its intent file',
    '(<dir>/intent-to-action.ts; a game surface: <dir>/intent-to-move.ts), or when a file of its feature folder',
    'calls useCanvasGestures or makeStickGesture. Stick surfaces (a sim/ sibling, only makeStickGesture, or "input":',
    '"stick") need no intent function and no hit-targets test.',
    '',
    'Rules:',
    '  input-file-missing     the input kit exists: canvas-intent.ts, classify-swipe.ts, stick-command.ts, pan-intent.ts,',
    '                         touch-targets.ts, use-canvas-gestures.ts with its test, canvas-gesture-probe.tsx',
    "  input-worklet          classify-swipe.ts, stick-command.ts and pan-intent.ts start with 'worklet'; and import values",
    "                         only from 'worklet' modules (and react-native-worklets)",
    '  gesture-one-file       no Gesture.* builder and no v3 use*Gesture hook in the canvas scope outside the input kit\'s',
    '                         use-canvas-gestures.ts (a copy forked into a feature is no exemption)',
    "  gesture-test-id        every builder in the gesture module has a literal .withTestId('<scope>.<kind>') (v3: testID)",
    '  intent-on-update       onUpdate/onChange never emit an intent (one intent per gesture, on start or end)',
    '  hover-on-change        an onUpdate/onChange that hops to JS (scheduleOnRN) does so only behind an isSameTarget guard',
    '  pan-finalize           every pan gesture in the gesture module has onFinalize (resets the pointer or the command',
    '                         after success, failure and cancel)',
    '  hit-test-slop          hitTest(...) in the input kit reads the shared layout and passes HIT_SLOP',
    '  physical-coords        gesture code never reads the writing direction (isRtl, isRTL, I18nManager, isMirrored, forceRTL)',
    '  pressable-in-detector  no Pressable*, Touchable*, *Button or contract "buttonComponents" inside a <GestureDetector>',
    '  canvas-rn-touch        no React Native touch on a canvas: no Pressable*, Touchable*, *Button or "buttonComponents"',
    '                         around a <Canvas> or <SurfaceCanvas>, and no onPress*, onLongPress, onTouch*, onResponder* or',
    '                         on*ShouldSetResponder* on the canvas element or on the element that directly wraps it',
    '  gesture-root           an app file renders <GestureHandlerRootView> (or gestureHandlerRootHOC); SKIP while the',
    '                         root layout is not yet created (React Native touch on a canvas alone asks for no kit',
    '                         and no root view, only canvas-rn-touch)',
    '  intent-to-action       every surface that takes touch has its pure intent function (default intentToAction) and a test',
    '  intent-pure            the intent file imports no React, React Native, Expo, Skia, store, service, API, route or UI value',
    '  intent-exhaustive      the intent file names every intent kind (tap, long-press, swipe, drag-end, aim)',
    '  touch-target-test      every tappable surface has a test that measures its layout with smallestTargetPt and MIN_TOUCH_PT',
    '  touch-target-min       touch-targets.ts MIN_TOUCH_PT is at least quality-gates.json "a11y.minTouchPt" (default 44)',
    '  rngh-api-version       Gesture Handler is declared; builder API with 2.x, hook API with 3.x, never mixed',
    '  worklets-api           input code uses scheduleOnRN (never runOnJS/runOnUI) and .get()/.set() (never .value)',
    '',
    `NOT APPLICABLE when no package.json declares ${RNGH_PACKAGE} and nothing uses it on a canvas, or when no canvas`,
    'takes touch (no input kit, no contract surface, no surface that takes touch, no SurfaceCanvas input, no gesture',
    'and no React Native touch on a canvas in the canvas scope). A contract that holds only "gestureExempt" or',
    '"buttonComponents" asks for nothing. Installed skills (folders holding a SKILL.md, .agents/,',
    '.claude/, skills/ ...) are never scanned.',
    'Examples: node check-canvas-input.mjs .   node check-canvas-input.mjs . --surface progress-grid',
  ].join('\n'),
};

const BUILDER_CALL = /\bGesture\.(Tap|Pan|LongPress|Fling|Pinch|Rotation|Hover|Manual|Native|ForceTouch)\s*\(\s*\)/g;
const ANY_BUILDER = /\bGesture\.(Tap|Pan|LongPress|Fling|Pinch|Rotation|Hover|Manual|Native|ForceTouch|Exclusive|Simultaneous|Race)\s*\(/g;
const V3_SINGLE = /\buse(Tap|Pan|LongPress|Fling|Pinch|Rotation|Hover|Manual|Native)Gesture\s*\(/g;
const V3_ANY = /\buse(Tap|Pan|LongPress|Fling|Pinch|Rotation|Hover|Manual|Native)Gesture\s*\(|\buse(Exclusive|Simultaneous|Competing)Gestures\s*\(/g;
const INTENT_KINDS = ['tap', 'long-press', 'swipe', 'drag-end', 'aim'];
/** Elements that are a canvas for canvas-rn-touch (SurfaceHost is display-only: it takes no input). */
const CANVAS_TAGS = new Set(['Canvas', 'SurfaceCanvas']);
const RENDERS_CANVAS = /<(Canvas|SurfaceCanvas|SurfaceHost)\b/;
/** React Native's own touch props: each one hit-tests beside the gesture module. */
const RN_TOUCH_PROP = /^(onPress|onPressIn|onPressOut|onLongPress|onTouch(Start|Move|End|Cancel)(Capture)?|onResponder[A-Z]\w*|on(Start|Move)ShouldSetResponder(Capture)?)$/;
const IMPURE_PACKAGE = /^(react|react-dom|react-native|react-native-.+|@react-native(-community)?\/.+|expo|expo-.+|@expo\/.+|@shopify\/.+|zustand(\/.*)?|@tanstack\/.+|react-intl)$/;
const TEST_ID = /^['"][a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+['"]$/;
const DEFAULT_MIN_TOUCH_PT = 44;

/** The first match of a (global) pattern without touching its lastIndex, which matchAll would copy. */
const firstMatch = (re, text) => new RegExp(re.source, re.flags.replace('g', '')).exec(text);

/** The method calls chained after `from` in masked code: [{ name, open, close, at }]. */
function chainFrom(masked, from) {
  const calls = [];
  let i = from;
  for (;;) {
    let j = i;
    while (/\s/.test(masked[j] ?? '')) j += 1;
    if (masked[j] !== '.') break;
    j += 1;
    while (/\s/.test(masked[j] ?? '')) j += 1;
    const name = /^[A-Za-z_$][\w$]*/.exec(masked.slice(j, j + 80))?.[0];
    if (name === undefined) break;
    const at = j;
    j += name.length;
    while (/\s/.test(masked[j] ?? '')) j += 1;
    if (masked[j] !== '(') break;
    const close = findClosing(masked, j);
    if (close === -1) break;
    calls.push({ name, open: j, close, at });
    i = close + 1;
  }
  return calls;
}

/** Text of a property value starting at `from`, up to the depth-0 comma or closing bracket. */
function valueSpan(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return masked.slice(from, i);
      depth -= 1;
    } else if (c === ',' && depth === 0) return masked.slice(from, i);
  }
  return masked.slice(from);
}

/** Every onUpdate/onChange callback body of a gesture file (builder chain calls and v3 config properties). */
function updateBodies(masked) {
  const bodies = [];
  for (const match of masked.matchAll(/\.(onUpdate|onChange)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(masked, open);
    bodies.push({ name: match[1], index: match.index, body: masked.slice(open + 1, close === -1 ? masked.length : close) });
  }
  for (const match of masked.matchAll(/(?<![.\w$])(onUpdate|onChange)\s*:/g)) {
    bodies.push({ name: match[1], index: match.index, body: valueSpan(masked, match.index + match[0].length) });
  }
  return bodies;
}

/**
 * The capitalised JSX elements of a file as a tree: [{ tag, name, start, parent }]. Opening tags come from
 * findJsxTags, closing tags pair with the nearest open element of the same name (an element left open
 * inside it closes with it). A heuristic over masked code, enough to find what wraps a canvas.
 */
function jsxElements(source, masked) {
  const events = [
    ...findJsxTags(source, masked).map((tag) => ({ at: tag.start, tag })),
    ...[...masked.matchAll(/<\/([A-Z][A-Za-z0-9_.]*)\s*>/g)].map((match) => ({ at: match.index, close: match[1] })),
  ].sort((a, b) => a.at - b.at);
  const stack = [];
  const elements = [];
  for (const event of events) {
    if (event.tag !== undefined) {
      const element = { tag: event.tag, name: event.tag.name, start: event.tag.start, parent: stack.at(-1) ?? null };
      elements.push(element);
      if (!event.tag.selfClosing) stack.push(element);
      continue;
    }
    const index = stack.findLastIndex((element) => element.name === event.close);
    if (index !== -1) stack.splice(index);
  }
  return elements;
}

function readJsonFile(root, rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch {
    return null;
  }
}

class InputChecker {
  constructor(scope, report, options) {
    this.scope = scope;
    this.report = report;
    this.root = scope.root;
    this.options = options;
  }

  read(rel) {
    return this.scope.read(rel);
  }

  /** An app .tsx file that renders a canvas (<Canvas>, <SurfaceCanvas> or the display-only <SurfaceHost>). */
  rendersCanvas(rel) {
    return rel.endsWith('.tsx') && RENDERS_CANVAS.test(maskCode(this.read(rel) ?? ''));
  }

  /**
   * The feature folders (<featuresDir>/<feature>) that hold a file handing touch to a canvas: the model hook
   * that wires its input lives there too, so a gesture built anywhere in that feature is canvas input. A
   * feature whose canvases are display-only is left out (its sheet handle or swipeable row is ordinary UI).
   */
  canvasFeatureDirs() {
    if (this.featureDirsCache !== undefined) return this.featureDirsCache;
    const { scope } = this;
    const dirs = new Set();
    for (const rel of scope.sources) {
      if (scope.isExempt(rel) || !this.rendersCanvasInput(rel)) continue;
      const featuresDir = scope.featuresDirs.find((dir) => rel.startsWith(`${dir}/`));
      const parts = featuresDir === undefined ? [] : rel.slice(featuresDir.length + 1).split('/');
      if (parts.length > 1) dirs.add(`${featuresDir}/${parts[0]}`);
    }
    this.featureDirsCache = [...dirs];
    return this.featureDirsCache;
  }

  /**
   * Canvas scope: the kit, every surface folder, files that render a canvas, app files whose import feeds a
   * canvas (canvasInputImports), and the feature folder of a surface that takes touch or of a file that
   * hands touch to a canvas, minus its self-contained controls. A display-only surface brings only its own
   * folder.
   */
  inCanvasScope(rel) {
    return this.scopeReason(rel) !== null;
  }

  /**
   * Why a file is in the canvas scope, or null: { kind: 'kit' | 'surface' | 'canvas' } | { kind: 'handed',
   * by } (an app file whose import a canvas file hands to the canvas) | { kind: 'feature', dir }.
   */
  scopeReason(rel) {
    this.reasonCache ??= new Map();
    if (this.reasonCache.has(rel)) return this.reasonCache.get(rel);
    const { scope } = this;
    let reason = null;
    if (isTestFile(rel) || scope.isExempt(rel)) reason = null;
    else if (scope.isKit(rel)) reason = { kind: 'kit' };
    else if (scope.surfaces.some((surface) => isInside(rel, surface.dir))) reason = { kind: 'surface' };
    else if (this.rendersCanvas(rel)) reason = { kind: 'canvas' };
    else if (this.canvasInputImports().has(rel)) reason = { kind: 'handed', by: this.canvasInputImports().get(rel) };
    else {
      const featureDirs = [...scope.surfaces.filter((surface) => surface.interactive).map((surface) => surface.featureDir), ...this.canvasFeatureDirs()];
      const dir = featureDirs.find((featureDir) => isInside(rel, featureDir));
      if (dir !== undefined && !this.isSelfContainedControl(rel)) reason = { kind: 'feature', dir };
    }
    this.reasonCache.set(rel, reason);
    return reason;
  }

  /**
   * The local value bindings a file imports from app files that exist: Map localName -> repo path.
   * Type-only imports and packages are left out.
   */
  importBindings(rel) {
    this.bindingsCache ??= new Map();
    if (this.bindingsCache.has(rel)) return this.bindingsCache.get(rel);
    const source = this.read(rel) ?? '';
    const { aliases } = this.scope.targetOf(rel).layout;
    const bindings = new Map();
    for (const { from, text } of findImports(source)) {
      const clause = /^import\s+([\s\S]*?)\s*from\s*['"]/.exec(text)?.[1];
      if (clause === undefined || /^type\b/.test(clause)) continue;
      const target = resolveImport(rel, from, { root: this.root, aliases });
      if (target.kind === 'external' || !target.exists) continue;
      const braces = /\{([^}]*)\}/.exec(clause);
      const names = clause
        .replace(/\{[^}]*\}/, '')
        .split(',')
        .map((part) => /^\s*(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(part)?.[1]);
      for (const part of (braces?.[1] ?? '').split(',')) {
        if (!/^\s*type\s/.test(part)) names.push(/([A-Za-z_$][\w$]*)\s*$/.exec(part)?.[1]);
      }
      for (const name of names) if (name !== undefined) bindings.set(name, target.path);
    }
    this.bindingsCache.set(rel, bindings);
    return bindings;
  }

  /**
   * The identifiers an expression reads, followed through the file's local const/let/var declarations
   * (`const scrub = useScrubGesture();` then `gesture={scrub}` reads useScrubGesture).
   */
  static expressionNames(masked, expr) {
    const declarations = [];
    for (const match of masked.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=(?![=>])/g)) {
      const from = match.index + match[0].length;
      let depth = 0;
      let end = masked.length;
      for (let i = from; i < masked.length; i += 1) {
        const c = masked[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}') depth -= 1;
        else if (depth <= 0 && (c === ';' || (c === '\n' && !/^\s*[.?:]/.test(masked.slice(i + 1, i + 40))))) {
          end = i;
          break;
        }
        if (depth < 0) {
          end = i;
          break;
        }
      }
      declarations.push({ declared: new Set(match[1].match(/[A-Za-z_$][\w$]*/g) ?? []), init: masked.slice(from, end) });
    }
    const names = new Set();
    const queue = [...(maskCode(expr).match(/[A-Za-z_$][\w$]*/g) ?? [])];
    while (queue.length > 0) {
      const name = queue.pop();
      if (names.has(name)) continue;
      names.add(name);
      for (const { declared, init } of declarations) if (declared.has(name)) queue.push(...(init.match(/[A-Za-z_$][\w$]*/g) ?? []));
    }
    return names;
  }

  /**
   * App files that feed a canvas through an import: Map repo path -> the canvas file that hands it on. A
   * canvas file (it renders <Canvas> or <SurfaceCanvas>) feeds a canvas with what its canvas GestureDetector
   * gesture={...} or its <SurfaceCanvas input={...}> reads, and with every component it renders around a
   * canvas. A gesture built in such a file is canvas input wherever the file lives (src/hooks, src/ui).
   * The canvas kit is checked on its own and is left out.
   */
  canvasInputImports() {
    if (this.handedCache !== undefined) return this.handedCache;
    const { scope } = this;
    const handed = new Map();
    for (const rel of scope.sources) {
      if (!rel.endsWith('.tsx') || scope.isExempt(rel) || scope.isKit(rel)) continue;
      const source = this.read(rel) ?? '';
      const masked = maskCode(source);
      if (!/<(Canvas|SurfaceCanvas)\b/.test(masked)) continue;
      const bindings = this.importBindings(rel);
      if (bindings.size === 0) continue;
      const fed = new Set();
      const exprs = [];
      const tags = findJsxTags(source, masked);
      for (const tag of tags) {
        const attrs = tag.name === 'SurfaceCanvas' || tag.name === 'GestureDetector' ? jsxAttributes(source, tag, masked) : null;
        if (tag.name === 'SurfaceCanvas' && attrs.get('input')?.kind === 'expr') exprs.push(attrs.get('input').value);
        if (tag.name !== 'GestureDetector' || attrs.get('gesture')?.kind !== 'expr') continue;
        const close = masked.indexOf('</GestureDetector>', tag.start);
        if (/<(Canvas|SurfaceCanvas)\b/.test(masked.slice(tag.end, close === -1 ? masked.length : close))) exprs.push(attrs.get('gesture').value);
      }
      for (const expr of exprs) for (const name of InputChecker.expressionNames(masked, expr)) if (bindings.has(name)) fed.add(bindings.get(name));
      for (const canvas of jsxElements(source, masked).filter((element) => CANVAS_TAGS.has(element.name))) {
        for (let outer = canvas.parent; outer !== null; outer = outer.parent) {
          const target = bindings.get(outer.name.split('.')[0]);
          if (target !== undefined) fed.add(target);
        }
      }
      for (const target of fed) if (!scope.isKit(target) && scope.isAppSource(target) && !isTestFile(target) && !handed.has(target)) handed.set(target, rel);
    }
    this.handedCache = handed;
    return handed;
  }

  /**
   * A self-contained control in a feature folder (a bottom sheet, a swipeable row): a .tsx file that renders
   * its own <GestureDetector> around no canvas and no component that renders one, imports no value from the
   * canvas kit or a surface folder, and calls neither useCanvasGestures nor makeStickGesture. Its gesture is
   * ordinary UI, not canvas input. A .ts hook that builds a gesture for someone else is never one.
   */
  isSelfContainedControl(rel) {
    if (!rel.endsWith('.tsx')) return false;
    const source = this.read(rel) ?? '';
    const masked = maskCode(source);
    if (!/<GestureDetector\b/.test(masked) || /<(Canvas|SurfaceCanvas|SurfaceHost)\b/.test(masked)) return false;
    if (/\b(useCanvasGestures|makeStickGesture)\s*\(/.test(masked)) return false;
    const bindings = this.importBindings(rel);
    const { scope } = this;
    if ([...bindings.values()].some((target) => scope.isKit(target) || scope.surfaces.some((surface) => isInside(target, surface.dir)))) return false;
    for (const open of masked.matchAll(/<GestureDetector\b/g)) {
      const close = masked.indexOf('</GestureDetector>', open.index);
      for (const tag of masked.slice(open.index + 1, close === -1 ? masked.length : close).matchAll(/<([A-Z][\w$]*)/g)) {
        const target = bindings.get(tag[1]);
        if (target !== undefined && this.rendersCanvas(target)) return false;
      }
    }
    return true;
  }

  hasGesture(rel) {
    const masked = maskCode(this.read(rel) ?? '');
    return firstMatch(ANY_BUILDER, masked) !== null || firstMatch(V3_ANY, masked) !== null;
  }

  /** A file that hands touch to a canvas: <SurfaceCanvas input=...> or a GestureDetector around a canvas. */
  rendersCanvasInput(rel) {
    if (!rel.endsWith('.tsx')) return false;
    const source = this.read(rel) ?? '';
    const masked = maskCode(source);
    for (const tag of findJsxTags(source, masked)) {
      if (tag.name === 'SurfaceCanvas' && jsxAttributes(source, tag, masked).has('input')) return true;
    }
    for (const open of masked.matchAll(/<GestureDetector\b/g)) {
      const close = masked.indexOf('</GestureDetector>', open.index);
      if (/<(Canvas|SurfaceCanvas)\b/.test(masked.slice(open.index, close === -1 ? masked.length : close))) return true;
    }
    return false;
  }

  /** The gestures folders to check, and whether anything proves that a canvas takes touch. */
  evidence() {
    const { scope } = this;
    const dirs = new Set(scope.gestureDirs.filter((dir) => scope.files.some((rel) => isInside(rel, dir))));
    const interactive = scope.surfaces.filter((surface) => surface.interactive);
    for (const surface of interactive) dirs.add(scope.gestureDirOf(surface.dir));
    const inputFiles = scope.sources.filter((rel) => !scope.isKit(rel) && this.rendersCanvasInput(rel));
    for (const rel of inputFiles) dirs.add(scope.gestureDirOf(rel));
    const gestureFiles = scope.sources.filter((rel) => this.inCanvasScope(rel) && this.hasGesture(rel) && !scope.isGestureModule(rel));
    for (const rel of gestureFiles) dirs.add(scope.gestureDirOf(rel));
    // React Native touch on a canvas (onPress, a Pressable around it) makes the check apply, but asks for
    // no input kit and no root view: its fix is either the gesture module (whose caller then asks for the
    // kit) or a gestureExempt entry for a whole-card press around a display-only canvas.
    const hasRnTouch = scope.sources.some((rel) => rel.endsWith('.tsx') && this.inCanvasScope(rel) && this.rnTouchFindings(rel).length > 0);
    // A contract surface is interactive, so it is already counted above. A contract that holds only
    // gestureExempt or buttonComponents is no evidence: exempting a whole-card press around a decorative
    // canvas must not demand an input kit the app does not use.
    return { dirs: [...dirs].sort(), takesGestures: dirs.size > 0, isApplicable: dirs.size > 0 || hasRnTouch };
  }

  checkKitFiles(dir) {
    for (const name of KIT_FILES) {
      const file = `${dir}/${name}`;
      if (!existsSync(join(this.root, file))) this.report.problem({ file, rule: 'input-file-missing', message: 'input kit file is missing', fix: `Copy templates/src/canvas/gestures/${name} from this skill verbatim and run its tests.` });
    }
  }

  checkWorklets(dir) {
    for (const name of UI_THREAD_FILES) {
      const file = `${dir}/${name}`;
      const source = this.read(file);
      if (source === null) continue;
      if (!hasWorkletDirective(source)) {
        this.report.problem({ file, line: 1, rule: 'input-worklet', message: "gesture callbacks call this module on the UI thread, but it has no file-level 'worklet'; directive (it throws on a device, never in Jest)", fix: "Put 'worklet'; as the first statement, right after the // path comment." });
        continue;
      }
      // `@/` resolves through the tsconfig.json of the file's own workspace (in a monorepo the root has none).
      const { aliases } = this.scope.targetOf(file).layout;
      for (const { spec, index } of valueImports(source)) {
        const target = resolveImport(file, spec, { root: this.root, aliases });
        if (target.kind === 'external') {
          if (spec !== 'react-native-worklets') this.report.problem({ file, line: lineOf(source, index), rule: 'input-worklet', message: `'worklet' module imports a value from the package ${spec}`, fix: 'Use `import type` for types; only react-native-worklets may be imported as a value.' });
          continue;
        }
        const targetSource = target.exists ? readRepoFile(this.root, target.path) : null;
        if (targetSource !== null && !hasWorkletDirective(targetSource)) this.report.problem({ file, line: lineOf(source, index), rule: 'input-worklet', message: `'worklet' module imports a value from ${target.path}, which is not a 'worklet' module`, fix: "Add 'worklet'; to that module if it is pure, or move the helper into a 'worklet' module." });
      }
    }
  }

  checkOneFile() {
    for (const rel of this.scope.sources) {
      if (this.scope.isGestureModule(rel) || !this.inCanvasScope(rel)) continue;
      const masked = maskCode(this.read(rel) ?? '');
      const reason = this.scopeReason(rel);
      for (const re of [ANY_BUILDER, V3_ANY]) {
        for (const match of masked.matchAll(re)) {
          const builder = match[0].replace(/\s*\($/, '');
          const base = { file: rel, line: lineOf(masked, match.index), rule: 'gesture-one-file' };
          if (reason.kind === 'handed') this.report.problem({ ...base, message: `builds a canvas gesture outside ${GESTURE_MODULE} (${builder}): ${reason.by} hands it to a canvas`, fix: `Add the mode to ${GESTURE_MODULE} and pass input={useCanvasGestures(...)} to <SurfaceCanvas> in ${reason.by} (only SurfaceCanvas in the canvas kit renders the GestureDetector); a file that is truly not canvas input goes in contracts/canvas-input.json "gestureExempt".` });
          else if (reason.kind === 'feature') this.report.problem({ ...base, message: `builds a gesture outside ${GESTURE_MODULE} (${builder}) in ${reason.dir}, a feature whose canvas takes touch`, fix: `Canvas input: add the mode to ${GESTURE_MODULE} and consume its intents. An ordinary control (a sheet, a swipeable row): render the gesture in its own <GestureDetector> inside a component file that imports nothing from the canvas kit, or list the file in contracts/canvas-input.json "gestureExempt".` });
          else this.report.problem({ ...base, message: `builds a canvas gesture outside ${GESTURE_MODULE} (${builder})`, fix: `Add the mode to ${GESTURE_MODULE} (the one gesture module) and consume its intents; an ordinary UI control here goes in contracts/canvas-input.json "gestureExempt".` });
        }
      }
      if (rel.endsWith('.tsx')) {
        this.checkDetectorChildren(rel, masked);
        for (const finding of this.rnTouchFindings(rel)) this.report.problem({ file: rel, rule: 'canvas-rn-touch', ...finding });
      }
    }
  }

  /** The touchable component names: Pressable*, Touchable*, Button, *Button and the contract's buttonComponents. */
  touchableSource() {
    const custom = this.scope.contract.buttonComponents.map((name) => name.replace(/[^A-Za-z0-9]/g, ''));
    return `Pressable\\w*|Touchable\\w*|Button|[A-Z]\\w*Button${custom.map((name) => `|${name}`).join('')}`;
  }

  checkDetectorChildren(rel, masked) {
    const touchable = new RegExp(`<(${this.touchableSource()})\\b`);
    for (const open of masked.matchAll(/<GestureDetector\b/g)) {
      const close = masked.indexOf('</GestureDetector>', open.index);
      const inside = masked.slice(open.index, close === -1 ? masked.length : close);
      const touch = touchable.exec(inside);
      if (touch) this.report.problem({ file: rel, line: lineOf(masked, open.index + touch.index), rule: 'pressable-in-detector', message: `<${touch[1]}> is rendered inside a canvas GestureDetector`, fix: 'Make the canvas the only child of the GestureDetector and render buttons as its siblings (or as plain views above it with their own touch handling).' });
    }
  }

  /**
   * React Native touch on a canvas: a touchable around a <Canvas>/<SurfaceCanvas>, or a touch prop on the
   * canvas element or on the element that directly wraps it. Each one hit-tests on its own, beside the
   * gesture module: no shared layout, no HIT_SLOP, no mirroring, nothing that keeps one intent per touch.
   * [{ line, message, fix }], cached per file (the evidence pass and the check both ask).
   */
  rnTouchFindings(rel) {
    this.rnTouchCache ??= new Map();
    if (this.rnTouchCache.has(rel)) return this.rnTouchCache.get(rel);
    const source = this.read(rel) ?? '';
    const masked = maskCode(source);
    const findings = [];
    if (/<(Canvas|SurfaceCanvas)\b/.test(masked)) {
      const touchable = new RegExp(`^(${this.touchableSource()})$`);
      const fix = "Take the touch through the gesture module instead: the model hook calls useCanvasGestures(player.layout, { panMode, onIntent }), passes each intent to the surface's intentToAction and hands input to <SurfaceCanvas input={...}>. A whole-card press around a display-only canvas is an ordinary control: list its file in contracts/canvas-input.json \"gestureExempt\".";
      const seen = new Set();
      const flagProps = (element, where) => {
        for (const [name, attr] of jsxAttributes(source, element.tag, masked)) {
          if (!RN_TOUCH_PROP.test(name) || seen.has(attr.index)) continue;
          seen.add(attr.index);
          findings.push({ line: lineOf(masked, attr.index), message: `${name} on <${element.name}> (${where}): React Native touch hit-tests on its own, so draw and touch drift and nothing keeps one intent per touch`, fix });
        }
      };
      for (const canvas of jsxElements(source, masked).filter((element) => CANVAS_TAGS.has(element.name))) {
        flagProps(canvas, 'the canvas');
        if (canvas.parent !== null && !touchable.test(canvas.parent.name)) flagProps(canvas.parent, `the element that directly wraps <${canvas.name}>`);
        for (let outer = canvas.parent; outer !== null; outer = outer.parent) {
          if (!touchable.test(outer.name) || seen.has(outer.start)) continue;
          seen.add(outer.start);
          findings.push({ line: lineOf(masked, outer.start), message: `<${outer.name}> wraps a <${canvas.name}>: React Native's touch system hit-tests the canvas on its own (no shared layout, no HIT_SLOP, no mirroring, no single intent)`, fix });
        }
      }
    }
    this.rnTouchCache.set(rel, findings);
    return findings;
  }

  checkGestureModule(file) {
    const source = this.read(file);
    if (source === null) return;
    const masked = maskCode(source);
    for (const match of masked.matchAll(BUILDER_CALL)) {
      const chain = chainFrom(masked, match.index + match[0].length);
      const testId = chain.find((call) => call.name === 'withTestId');
      const literal = testId === undefined ? '' : source.slice(testId.open + 1, testId.close).trim();
      if (!TEST_ID.test(literal)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'gesture-test-id', message: `Gesture.${match[1]}() has no literal .withTestId('<scope>.<kind>')`, fix: "Give every builder a test id the gesture test drives: .withTestId('canvas.tap'), 'canvas.long-press', 'canvas.pan', 'canvas.stick'." });
      if (match[1] === 'Pan' && !chain.some((call) => call.name === 'onFinalize')) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'pan-finalize', message: 'a pan gesture has no onFinalize, so a cancelled drag (a call, the system back gesture) leaves its preview or stick command behind', fix: 'Add .onFinalize(() => { pointer.set(IDLE_POINTER); }) (a stick: command.set(STICK_IDLE)); it runs on success, failure and cancel.' });
    }
    for (const match of masked.matchAll(V3_SINGLE)) {
      const open = match.index + match[0].length - 1;
      const config = masked.slice(open + 1, Math.max(open + 1, findClosing(masked, open)));
      if (!/\btestID\s*:\s*['"]/.test(config)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'gesture-test-id', message: `use${match[1]}Gesture() has no literal testID`, fix: "Give every gesture a test id the gesture test drives: testID: 'canvas.tap'." });
      if (match[1] === 'Pan' && !/\bonFinalize\b/.test(config)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'pan-finalize', message: 'a pan gesture has no onFinalize, so a cancelled drag leaves its preview or stick command behind', fix: 'Add onFinalize: () => { pointer.set(IDLE_POINTER); } (it runs on success, failure and cancel).' });
    }
    for (const { name, index, body } of updateBodies(masked)) {
      if (/\bonIntent\b/.test(body)) this.report.problem({ file, line: lineOf(masked, index), rule: 'intent-on-update', message: `${name}() emits an intent, so one gesture can produce many actions`, fix: 'Only move the pointer (and report hover changes) in onUpdate; emit the single intent in onEnd (onStart for long press).' });
      if (/\bscheduleOnRN\s*\(/.test(body) && !/\bisSameTarget\s*\(/.test(body)) this.report.problem({ file, line: lineOf(masked, index), rule: 'hover-on-change', message: `${name}() hops to JS on every finger move (scheduleOnRN without an isSameTarget guard)`, fix: 'Keep per-frame finger state in the pointer shared value and send only hover changes: if (!isSameTarget(hover, previous.hover)) scheduleOnRN(onHover, hover).' });
    }
  }

  checkHitTests(dir) {
    for (const name of [GESTURE_MODULE, 'pan-intent.ts', 'touch-targets.ts']) {
      const file = `${dir}/${name}`;
      const source = this.read(file);
      if (source === null) continue;
      const masked = maskCode(source);
      for (const match of masked.matchAll(/\bhitTest\s*\(/g)) {
        const open = match.index + match[0].length - 1;
        const args = masked.slice(open + 1, Math.max(open + 1, findClosing(masked, open)));
        if (!/^\s*layout(\.get\(\))?\s*,/.test(args) || !/\bHIT_SLOP\b/.test(args)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'hit-test-slop', message: 'hitTest() does not use the shared canvas layout with HIT_SLOP', fix: 'Call hitTest(layout.get(), point, HIT_SLOP): the layout the picture draws with, and 8 pt of slop for edge taps.' });
      }
    }
  }

  checkPhysical(dir) {
    for (const name of DIRECTION_FREE_FILES) {
      const file = `${dir}/${name}`;
      const source = this.read(file);
      if (source === null) continue;
      const masked = maskCode(source);
      for (const match of masked.matchAll(/\b(isRtl|isRTL|I18nManager|isMirrored|forceRTL)\b/g)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'physical-coords', message: `gesture code reads ${match[1]}; touches are physical and must not flip for right-to-left`, fix: 'Remove the direction logic: the layout mirrors regions for surfaces that opt in (isMirroredInRtl), and hitTest mirrors with it.' });
    }
  }

  checkWorkletsApi(dir) {
    for (const name of WORKLETS_API_FILES) {
      const file = `${dir}/${name}`;
      const source = this.read(file);
      if (source === null) continue;
      const masked = maskCode(source);
      for (const match of masked.matchAll(/\brunOn(JS|UI)\b/g)) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'worklets-api', message: `uses the deprecated runOn${match[1]}`, fix: 'Use scheduleOnRN(fn, ...args) from react-native-worklets (scheduleOnUI for the other direction).' });
      const shared = new Set([
        ...[...masked.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*use(?:SharedValue|DerivedValue)\b/g)].map((m) => m[1]),
        ...[...masked.matchAll(/\b(\w+)\??\s*:\s*(?:SharedValue|DerivedValue)\s*</g)].map((m) => m[1]),
        'pointer',
        'command',
      ]);
      for (const match of masked.matchAll(/\b(\w+)\.value\b/g)) {
        if (shared.has(match[1])) this.report.problem({ file, line: lineOf(masked, match.index), rule: 'worklets-api', message: `shared value ${match[1]} is accessed with .value`, fix: `Use ${match[1]}.get() / ${match[1]}.set(x) (React Compiler needs the accessors).` });
      }
    }
  }

  checkTouchMin(dir) {
    const file = `${dir}/touch-targets.ts`;
    const source = this.read(file);
    if (source === null) return;
    const gates = existsSync(join(this.root, 'quality-gates.json')) ? readJsonFile(this.root, 'quality-gates.json') : null;
    const gate = typeof gates?.a11y?.minTouchPt === 'number' ? gates.a11y.minTouchPt : DEFAULT_MIN_TOUCH_PT;
    const code = maskComments(source);
    const match = /\bexport\s+const\s+MIN_TOUCH_PT\s*(?::\s*number\s*)?=\s*(\d+(?:\.\d+)?)\s*;/.exec(code);
    if (match === null) {
      this.report.problem({ file, line: 1, rule: 'touch-target-min', message: 'touch-targets.ts does not export a literal MIN_TOUCH_PT', fix: `export const MIN_TOUCH_PT = ${gate}; (quality-gates.json "a11y.minTouchPt", accessibility-as-code).` });
      return;
    }
    if (Number(match[1]) < gate) this.report.problem({ file, line: lineOf(code, match.index), rule: 'touch-target-min', message: `MIN_TOUCH_PT is ${match[1]}, below the app's touch-target gate of ${gate} pt (quality-gates.json "a11y.minTouchPt")`, fix: `Set MIN_TOUCH_PT to ${gate} and fix the layouts whose hit-targets tests then fail; never lower the gate.` });
  }

  checkApiVersion(dir) {
    const file = `${dir}/${GESTURE_MODULE}`;
    const source = this.read(file);
    if (source === null) return;
    if (!this.scope.hasRngh) {
      this.report.problem({ file: 'package.json', rule: 'rngh-api-version', message: `the input kit needs ${RNGH_PACKAGE}, but no package.json declares it`, fix: `Run npx expo install ${RNGH_PACKAGE} (Expo's pin for the SDK).` });
      return;
    }
    // The workspace's own install first (npm hoists to the root unless versions conflict), then the root.
    const ws = this.scope.targetOf(dir).dir;
    const manifests = [...(ws === '' ? [] : [`${ws}/node_modules/${RNGH_PACKAGE}/package.json`]), `node_modules/${RNGH_PACKAGE}/package.json`];
    const installed = manifests.map((rel) => readJsonFile(this.root, rel)?.version).find((version) => typeof version === 'string');
    const version = typeof installed === 'string' ? installed : this.scope.rnghSpec;
    const major = /(\d+)/.exec(version ?? '')?.[1];
    if (major === undefined) return;
    const masked = maskCode(source);
    const hook = firstMatch(V3_ANY, masked);
    const builder = /\bGesture\.\w+\s*\(/.exec(masked);
    const what = typeof installed === 'string' ? `${RNGH_PACKAGE} ${version} is installed` : `package.json declares ${RNGH_PACKAGE} ${version}`;
    if (major === '2' && hook !== null) this.report.problem({ file, line: lineOf(masked, hook.index), rule: 'rngh-api-version', message: `${what}, but the gesture module uses the 3.x hook API`, fix: 'Use the 2.x builder API (Gesture.Tap/Pan/LongPress, Gesture.Exclusive) until the SDK upgrade brings 3.x.' });
    if (Number(major) >= 3 && builder !== null) this.report.problem({ file, line: lineOf(masked, builder.index), rule: 'rngh-api-version', message: `${what}, but the gesture module uses the legacy builder API`, fix: 'Migrate use-canvas-gestures.ts to the hook API as a whole (useTapGesture, usePanGesture, useExclusiveGestures; references/gesture-handler-versions.md).' });
  }

  checkRoot() {
    const { scope } = this;
    const exists = (rel) => existsSync(join(this.root, rel));
    const inTarget = (target, name) => (target.dir === '' ? name : `${target.dir}/${name}`);
    const entries = scope.targets.flatMap((target) => ['App.tsx', 'App.ts', 'index.tsx', 'index.ts'].map((name) => inTarget(target, name))).filter(exists);
    const candidates = [...scope.sources, ...entries];
    if (candidates.some((rel) => /<GestureHandlerRootView\b|\bgestureHandlerRootHOC\s*\(/.test(maskCode(this.read(rel) ?? '')))) return;
    // The app's root: the root layout (Expo Router) or App.tsx (React Navigation), in each workspace.
    const rootLayouts = scope.targets.map((target) => `${target.layout.routesDir}/_layout.tsx`);
    const file = scope.targets.flatMap((target) => [`${target.layout.routesDir}/_layout.tsx`, inTarget(target, 'App.tsx')]).find(exists);
    if (file === undefined) {
      const reason = notYetCreated(this.root, { file: rootLayouts[0], owner: 'app-startup-and-bootstrap' });
      this.report.skip({ file: rootLayouts[0], rule: 'gesture-root', message: reason });
      return;
    }
    this.report.problem({ file, rule: 'gesture-root', message: 'no <GestureHandlerRootView> wraps the app, so no canvas gesture fires on a device', fix: "Wrap the root layout's providers (or the root stack component it renders) in <GestureHandlerRootView style={styles.root}> with StyleSheet.create({ root: { flex: 1 } }), imported from react-native-gesture-handler." });
  }

  surfacesToCheck() {
    const interactive = this.scope.surfaces.filter((surface) => surface.interactive && surface.input === 'intents');
    const wanted = this.options.surface;
    if (wanted.length === 0) return interactive;
    const known = this.scope.surfaces.map((surface) => surface.id);
    for (const id of wanted) if (!known.includes(id)) fail(`surface ${id} is not a canvas surface of this repo (found: ${known.join(', ') || 'none'})`, 'Pass the id of a surface folder (its <id>-surface.ts) or of a contracts/canvas-input.json entry.');
    return interactive.filter((surface) => wanted.includes(surface.id));
  }

  checkIntent(surface) {
    const { file, name } = surface.intent;
    const source = this.read(file);
    const exported = new RegExp(`\\bexport\\s+(?:function\\s+${name}\\b|const\\s+${name}\\s*[:=])`);
    if (source === null || !exported.test(source)) {
      this.report.problem({ file, rule: 'intent-to-action', message: `surface ${surface.id} takes touch but has no pure ${name}(state, intent) export`, fix: `Write ${name} in ${file} like this skill's examples/progress-grid/intent-to-action.ts: an exhaustive switch over intent.kind that returns an action only when the domain allows it.` });
      return;
    }
    const testFile = file.replace(/\.ts$/, '.test.ts');
    if (!existsSync(join(this.root, testFile))) this.report.problem({ file: testFile, rule: 'intent-to-action', message: `${name} has no test`, fix: 'Test each intent kind the surface uses, illegal targets, ignored kinds, a finished or locked state, and a property: every non-null result is allowed by the domain.' });
    this.checkIntentPurity(surface, file, source);
    const code = maskComments(source);
    const missing = INTENT_KINDS.filter((kind) => !new RegExp(`['"]${kind}['"]`).test(code));
    if (missing.length > 0) this.report.problem({ file, line: 1, rule: 'intent-exhaustive', message: `${name} does not name the intent kind(s) ${missing.join(', ')}`, fix: 'Switch over intent.kind and list every kind; return null explicitly for the kinds this surface ignores.' });
  }

  checkIntentPurity(surface, file, source) {
    const { layout } = this.scope.targetOf(file);
    const impureDirs = [layout.uiDir, layout.storesDir, layout.servicesDir, layout.apiDir, layout.routesDir];
    for (const { spec, index } of valueImports(source)) {
      const resolved = resolveImport(file, spec, { root: this.root, aliases: layout.aliases });
      let why = null;
      if (resolved.kind === 'external') why = IMPURE_PACKAGE.test(spec) ? `the package ${spec}` : null;
      else if (impureDirs.some((dir) => isInside(resolved.path, dir))) why = `${resolved.path} (UI, store, service, API or route code)`;
      else if (this.scope.isKit(resolved.path) && resolved.exists && !hasWorkletDirective(readRepoFile(this.root, resolved.path) ?? '')) why = `${resolved.path} (canvas kit code that is not a pure 'worklet' module)`;
      if (why !== null) this.report.problem({ file, line: lineOf(source, index), rule: 'intent-pure', message: `${surface.intent.name} imports ${why}; the intent function is pure TypeScript`, fix: 'Take everything it needs as arguments (state, intent); import only types, the domain\'s pure modules and pure \'worklet\' kit modules.' });
    }
  }

  checkTouchTest(surface) {
    if (!surface.tappable) return;
    const tests = this.scope.files.filter((rel) => isTestFile(rel) && /\.test\.tsx?$/.test(rel) && (isInside(rel, surface.dir) || isInside(rel, surface.featureDir)));
    const proves = tests.some((rel) => {
      const source = this.read(rel) ?? '';
      return /from\s+['"][^'"]*touch-targets['"]/.test(source) && /\bsmallestTargetPt\s*\(/.test(source) && /\bMIN_TOUCH_PT\b/.test(source);
    });
    if (!proves) this.report.problem({ file: `${surface.dir}/hit-targets.test.ts`, rule: 'touch-target-test', message: `no test proves surface ${surface.id}'s smallest hit region is at least MIN_TOUCH_PT at the smallest supported canvas`, fix: "Write hit-targets.test.ts like this skill's examples/progress-grid/hit-targets.test.ts: lay the largest view out at the smallest canvas and expect smallestTargetPt(layout) >= MIN_TOUCH_PT." });
  }

  run() {
    const { scope, report } = this;
    const { dirs, takesGestures, isApplicable } = this.evidence();
    if (!isApplicable) {
      if (!scope.hasRngh) return report.notApplicable(`${RNGH_PACKAGE} is not in package.json and no canvas takes touch`);
      return report.notApplicable(`no canvas takes touch: no ${scope.gestureDirs.join(', ')}, no surface in ${scope.contract.file}, no surface with an intent file or a useCanvasGestures caller, no SurfaceCanvas input and no gesture in the canvas scope`);
    }
    for (const dir of dirs) {
      this.checkKitFiles(dir);
      this.checkWorklets(dir);
      this.checkGestureModule(`${dir}/${GESTURE_MODULE}`);
      this.checkHitTests(dir);
      this.checkPhysical(dir);
      this.checkWorkletsApi(dir);
      this.checkTouchMin(dir);
      this.checkApiVersion(dir);
    }
    this.checkOneFile();
    if (takesGestures) this.checkRoot();
    for (const surface of this.surfacesToCheck()) {
      this.checkIntent(surface);
      this.checkTouchTest(surface);
    }
    return report.finish({ checked: scope.sources.length, unit: 'source files' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-canvas-input', json: options.json });
  const scope = inputScope(root, { kitDir: options['kit-dir'], gesturesDir: options['gestures-dir'], surfaceDirs: options['surface-dir'] });
  return new InputChecker(scope, report, options).run();
});
