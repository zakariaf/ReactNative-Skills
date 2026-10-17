#!/usr/bin/env node
// check-canvas-code.mjs: checks the Skia canvas code of an Expo app (the canvas kit, every surface
// folder, and every other app source file that imports @shopify/react-native-skia) against the rules
// of the skia-canvas-rendering skill: worklets, the frame clock, pure and opaque draw, per-frame
// allocation, the Skia API, the canvas element and where it lives, accessibility, lifecycle and the
// reduce-motion source.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-canvas-code.mjs [repo-root]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import { canvasScope, SKIA_PACKAGE, surfaceFolders } from './lib/canvas-scope.mjs';
import { balancedParens, findJsxTags, functionsOf, hasWorkletDirective, isTestFile, jsxAttributes, maskCode, matchBracket, openingTag, readRepoFile, resolveImport, scanSource, valueImports } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-canvas-code',
  summary: 'Checks the Skia canvas code (the kit folder, default src/canvas, every surface folder, default src/features/*/canvas, and every other app source file that imports @shopify/react-native-skia) for the rendering rules.',
  usage: '[repo-root] [options]',
  options: {
    'kit-dir': { type: 'string', multiple: true, value: 'dir', help: 'The canvas kit folder (default: <srcDir>/canvas, or rn-skills.config.json "canvasKitDir")' },
    'surface-dir': { type: 'string', multiple: true, value: 'glob', help: 'Surface folders (default: <featuresDir>/*/canvas and <srcDir>/games/*/canvas, or "canvasSurfaceDirs"; "**/canvas" works)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Scope: the kit and surface folders get every rule; any other runtime .ts/.tsx file under the app source',
    '(srcDir and routesDir of each workspace) that imports @shopify/react-native-skia gets the API, allocation and',
    'canvas-element rules (worklets-api, shared-value-accessor, skia-path-api, measure-text, text-direction,',
    'interpolate-color, reduced-motion-source, recorder-per-canvas, pixel-flip, frame-alloc, idle-clock,',
    "canvas-onlayout, canvas-a11y, canvas-outside-surface, lifecycle); one that imports the kit's CanvasSurface or",
    'DrawFrame type gets surface-outside-folder; every .tsx file that renders SurfaceHost or SurfaceCanvas gets',
    'opaque-contract.',
    '',
    'Rules:',
    "  worklet-directive      UI-thread modules (the kit's timeline, layout, scene, clock-state, frame runner, recorder,",
    "                         error and text modules; each surface's draw* and layout* files) start with 'worklet';",
    "  worklet-import         a 'worklet' module imports values only from other 'worklet' modules or react-native-worklets",
    '  frame-clock            no timeSinceFirstFrame in runtime code (it resets on re-activation); use timestamp + startAt',
    '  worklets-api           no runOnJS/runOnUI; use scheduleOnRN/scheduleOnUI',
    '  shared-value-accessor  shared values are read and written with .get()/.set(), never .value',
    '  frame-callback-body    useFrameCallback((info) => { runXFrame(...); }, false): one runner call, starts inactive',
    '  draw-pure              draw files import Skia types only and never create Skia objects or read clocks/random',
    "  opaque-background      the surface's draw function paints every pixel first (its first canvas call after any",
    '                         save/translate/scale/rotate/skew/concat is drawColor, drawPaint or clear, directly or as',
    '                         the first call of a same-file layer helper it starts with), because SurfaceCanvas is',
    '                         opaque; a surface declared "opaque": false in contracts/canvas-surfaces.json is exempt',
    '                         (opaque-contract proves it renders non-opaque)',
    '  opaque-contract        a surface declared "opaque": false is rendered by SurfaceHost/SurfaceCanvas with a literal',
    '                         isOpaque={false} (at least one render site, none without it), and isOpaque={false} is',
    '                         passed only for surfaces declared "opaque": false',
    '  frame-alloc            no Skia.* object is created inside a per-frame callback (useDerivedValue, useFrameCallback,',
    '                         useAnimatedReaction, useAnimatedStyle, useAnimatedProps)',
    '  skia-path-api          paths use Skia.PathBuilder, never Skia.Path.Make() or add* on an SkPath (the builder\'s add*',
    '                         methods are fine)',
    '  measure-text           no SkFont.measureText (unimplemented in CanvasKit); sum glyph widths (getTextWidth works',
    '                         but is typed @deprecated in Skia 2.6.2, so the no-deprecated lint rule fails it)',
    '  canvas-onlayout        <Canvas onSize={sharedValue}>, never onLayout (unsupported on the New Architecture)',
    '  text-direction         TextDirection.RTL is 0 (falsy): never combine it with && or ||',
    '  pixel-flip             canvas code never pixel-flips (scaleX -1); mirror positions in the layout',
    '  canvas-a11y            every <Canvas> is an accessible image: accessible (or accessible={true}; React Native',
    '                         0.86 defaults it to false and iOS VoiceOver skips a view that is not accessible),',
    '                         accessibilityRole="image" (or role="img") and accessibilityLabel (or aria-label), on the',
    '                         Canvas or on an open element around it; a decorative canvas opts out explicitly with',
    '                         accessible={false} or importantForAccessibility="no-hide-descendants"',
    '  canvas-outside-surface a <Canvas> that draws a computed picture lives only in the kit or a surface folder. Judged',
    '                         per element: its subtree (to </Canvas>) plus the same-file components it renders show',
    '                         <Picture>, call the Skia draw API or read a picture drawn with it, call a per-frame hook',
    '                         or animation (useDerivedValue, useSharedValue, useClock, with*), or read a name bound to',
    '                         one (or typed SharedValue/DerivedValue, or derived from such a name). A static',
    '                         declarative canvas (a gradient, a blur, a fixed shape) may live anywhere, also beside an',
    '                         animated view in the same file; static art recorded once (createPicture) is declared in',
    '                         the contract\'s "staticCanvases" (which never excuses per-frame values). The canvas size',
    '                         is layout, not motion: the shared value <Canvas onSize={size}> writes (or a prop typed',
    '                         SharedValue<SkSize>) and useDerivedValue values computed from it alone. A .tsx file that',
    '                         renders Skia elements whose attributes read per-frame values but no <Canvas> (an animated',
    '                         <AnimatedBar> another file\'s canvas renders) is reported too',
    "  surface-outside-folder an app file outside the kit and the surface folders that imports the kit's CanvasSurface or",
    '                         DrawFrame type, or whose export a SurfaceHost/SurfaceCanvas renders as its surface (a',
    '                         surface object or a draw file that escaped its folder)',
    '  idle-clock             no useClock() and no withRepeat(..., -1) driving a canvas: both keep a frame loop running',
    "                         while nothing changes; the kit's scene clock is the only frame driver. Every call counts",
    '                         in the kit, the surface folders and a Skia file without a <Canvas>; in any other .tsx',
    '                         file only a call whose value (by its bound name, or a value derived from it) reaches one',
    '                         of its <Canvas> elements',
    '  lifecycle              a file that runs useSceneClock also calls useCanvasLifecycle',
    '  clock-runnable         <kit>/use-scene-clock.ts routes push, stop, resume and every done message through',
    '                         scene-clock-state (pushScene, stopClock, resumeClock, finishRun), never switches the frame',
    '                         callback with a literal setActive(true|false) and never reads the scene shared value on JS',
    '  recorder-per-canvas    Skia.PictureRecorder() is created per canvas (useState), never at module scope',
    '  interpolate-color      canvas colours use Skia interpolateColors, not Reanimated interpolateColor',
    '  reduced-motion-source  canvas code never calls Reanimated useReducedMotion() (read once at app start)',
    '',
    `NOT APPLICABLE when no package.json declares ${SKIA_PACKAGE}. Installed skills (folders holding a SKILL.md,`,
    '.agents/, .claude/, skills/ ...) are never scanned. A configured surface glob that matches no folder is exit 2.',
    'Example: node check-canvas-code.mjs .',
  ].join('\n'),
};

const KIT_WORKLETS = /^(timeline\/[^/]+|canvas-layout|scene|scene-clock-state|run-scene-frame|record-picture|describe-error|draw-text)\.ts$/;
const SURFACE_WORKLETS = /^(draw|layout)[^/]*\.ts$/;
const DRAW_FILE = /^draw[^/]*\.ts$/;
const ALLOWED_WORKLET_PACKAGES = new Set(['react-native-worklets']);

/** The file's path inside its kit folder or directly inside its surface folder, for the role rules. */
function rolesOf(scope, rel) {
  const kit = scope.kitOf(rel);
  const surfaceDir = scope.surfaceDirOf(rel);
  const inKit = kit === null ? null : rel.slice(kit.length + 1);
  const inSurface = surfaceDir === null ? null : rel.slice(surfaceDir.length + 1);
  return {
    isWorkletRequired: !isTestFile(rel) && ((inKit !== null && KIT_WORKLETS.test(inKit)) || (inSurface !== null && SURFACE_WORKLETS.test(inSurface))),
    isDraw: !isTestFile(rel) && inSurface !== null && DRAW_FILE.test(inSurface),
    isClockHook: inKit === 'use-scene-clock.ts',
  };
}

function checkWorklet(ctx) {
  const { rel, source, root, report, roles, scope } = ctx;
  const isWorklet = hasWorkletDirective(source);
  if (roles.isWorkletRequired && !isWorklet) {
    report.problem({ file: rel, line: 1, rule: 'worklet-directive', message: "UI-thread module has no file-level 'worklet'; directive (a plain function called on the UI thread crashes at runtime)", fix: "Put 'worklet'; as the first statement, right after the // path comment." });
  }
  if (!isWorklet) return;
  for (const { spec, index } of valueImports(source)) {
    const target = resolveImport(rel, spec, { root, aliases: scope.aliasesOf(rel) });
    if (target.kind === 'external') {
      if (!ALLOWED_WORKLET_PACKAGES.has(spec)) report.problem({ file: rel, line: lineOf(source, index), rule: 'worklet-import', message: `'worklet' module imports a value from the package ${spec}`, fix: 'Use `import type` for types; move runtime package calls to the JS thread (only react-native-worklets is allowed).' });
      continue;
    }
    const targetSource = target.exists ? readRepoFile(root, target.path) : null;
    if (targetSource !== null && !hasWorkletDirective(targetSource)) {
      report.problem({ file: rel, line: lineOf(source, index), rule: 'worklet-import', message: `'worklet' module imports a value from ${target.path}, which is not a 'worklet' module`, fix: "Add 'worklet'; to that module (if it is pure) or move the shared helper into a 'worklet' module such as the surface's canvas-ids.ts." });
    }
  }
}

function checkFrameCallbacks(ctx) {
  const { rel, code, report } = ctx;
  for (const match of code.matchAll(/\buseFrameCallback\s*\(/g)) {
    const args = balancedParens(code, match.index + match[0].length - 1) ?? '';
    const isRunnerCall = /^\s*\(\s*\w+\s*\)\s*=>\s*\{\s*run[A-Z]\w*Frame\s*\([^;{}]*\)\s*;?\s*\}\s*,\s*false\s*$/.test(args);
    if (!isRunnerCall) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'frame-callback-body', message: 'useFrameCallback body is not a single call into a run*Frame runner, or does not start inactive (false)', fix: 'Write useFrameCallback((info) => { runSceneFrame(wiring, info.timestamp); }, false) and keep try/catch inside the runner.' });
  }
}

/** Shared values the kit passes around inside objects (clock.scene, clock.now, props.size ...). */
const KIT_SHARED_VALUES = ['scene', 'now', 'pointer', 'layout', 'picture', 'size', 'sim', 'command', 'accMs'];

function checkSharedValues(ctx) {
  const { rel, code, report } = ctx;
  // Locals from the hooks, plus every name typed as a SharedValue (props, wiring fields, parameters).
  const locals = [...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*use(?:SharedValue|DerivedValue)\b/g)].map((m) => m[1]);
  const typed = [...code.matchAll(/\b(\w+)\??\s*:\s*(?:SharedValue|DerivedValue)\s*</g)].map((m) => m[1]);
  const names = new Set([...locals, ...typed]);
  const kitChain = new RegExp(`\\.(${KIT_SHARED_VALUES.join('|')})\\.value\\b`);
  for (const match of code.matchAll(/(\.?)\b(\w+)\.value\b/g)) {
    const isNamed = match[1] === '' && names.has(match[2]);
    const isKitMember = match[1] === '.' && (names.has(match[2]) || kitChain.test(match[0]));
    if (!isNamed && !isKitMember) continue;
    const name = match[2];
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'shared-value-accessor', message: `shared value ${name} is accessed with .value`, fix: `Use ${name}.get() / ${name}.set(x) (React Compiler needs the accessors).` });
  }
}

function checkDraw(ctx) {
  const { rel, source, code, report, roles } = ctx;
  if (!roles.isDraw) return;
  for (const { spec, index } of valueImports(source)) {
    if (spec === SKIA_PACKAGE) report.problem({ file: rel, line: lineOf(source, index), rule: 'draw-pure', message: `draw file imports a value from ${SKIA_PACKAGE}`, fix: 'Import Skia types only (import type { SkCanvas } ...); every Skia object comes in through frame.kit.' });
  }
  const banned = [
    [/\bSkia\.\w+/g, 'creates or uses the Skia API inside draw', 'Build paints, colours, paths and fonts once in the kit (makeDrawKit, buildPaths) and read them from frame.kit.'],
    [/\bMath\.random\s*\(/g, 'reads Math.random inside draw', 'Take randomness from the view or from burstHash(seed, index) (particles).'],
    [/\b(Date\.now|performance\.now)\s*\(|\bnew\s+Date\b/g, 'reads a clock inside draw', 'Time arrives as frame.fx (the timeline sample); draw never reads a clock.'],
  ];
  for (const [re, message, fix] of banned) {
    for (const match of code.matchAll(re)) report.problem({ file: rel, line: lineOf(code, match.index), rule: 'draw-pure', message: `draw file ${message}`, fix });
  }
}

const PATTERN_RULES = [
  { rule: 'frame-clock', re: /\btimeSinceFirstFrame\b/g, runtimeOnly: true, message: 'uses timeSinceFirstFrame, which Reanimated resets to 0 whenever a frame callback is re-activated', fix: 'Stamp startAt = info.timestamp on the first frame (tickClock) and use elapsed = timestamp - startAt.' },
  { rule: 'worklets-api', re: /\brunOn(JS|UI)\b/g, runtimeOnly: false, message: 'uses the deprecated runOnJS/runOnUI', fix: 'Use scheduleOnRN(fn, ...args) / scheduleOnUI(fn, ...args) from react-native-worklets.' },
  { rule: 'measure-text', re: /\.measureText\s*\(/g, runtimeOnly: false, message: 'uses SkFont.measureText, which CanvasKit (Jest, Node) does not implement', fix: 'Sum font.getGlyphWidths(font.getGlyphIDs(text)) as textWidth() in draw-text.ts does (font.getTextWidth also works in CanvasKit, but Skia 2.6.2 types it @deprecated, so the no-deprecated lint rule fails it).' },
  { rule: 'text-direction', re: /(&&|\|\|)\s*TextDirection\.\w+|TextDirection\.\w+\s*(&&|\|\|)/g, runtimeOnly: false, message: 'combines TextDirection with && or ||, but TextDirection.RTL is 0 (falsy)', fix: 'Choose explicitly: isRtl ? TextDirection.RTL : TextDirection.LTR.' },
  { rule: 'interpolate-color', re: /\binterpolateColor\s*\(/g, runtimeOnly: true, message: 'uses Reanimated interpolateColor for a Skia colour', fix: 'Use Skia interpolateColors (a different colour format), or resolve colours once in the palette.' },
  { rule: 'reduced-motion-source', re: /\buseReducedMotion\s*\(/g, runtimeOnly: true, message: 'calls Reanimated useReducedMotion(), which reads the setting once at app start, so a later Reduce motion change is missed', fix: "Read the app's live reduce-motion value (accessibility-as-code's useReduceMotion, or the app's setting) on the screen and pass it as buildTimeline(events, motion)." },
  { rule: 'recorder-per-canvas', re: /^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*Skia\.PictureRecorder\s*\(/gm, runtimeOnly: true, message: 'creates a PictureRecorder at module scope', fix: 'Create one recorder per canvas in render: const [recorder] = useState(() => Skia.PictureRecorder()).' },
];

/** Where the expression that reaches `index` starts: the last `;` or unmatched opening bracket before it. */
function statementStart(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) return i + 1;
      depth -= 1;
    } else if (ch === ';' && depth === 0) return i + 1;
  }
  return 0;
}

const PATH_FIX = 'Build unit-size paths once with Skia.PathBuilder.Make()...build() (its add* methods are fine), or Skia.Path.Circle, and place them with canvas.translate/scale.';

/**
 * The mutable SkPath API (Skia.Path.Make() and add* on the path) is deprecated in Skia 2.6 and logs a
 * warning in 2.6.2. SkPathBuilder has the same add* methods and is the right API, so an add* call on
 * a builder (a chain that starts at PathBuilder, or a name bound to PathBuilder.Make()/MakeFromPath())
 * is not reported.
 */
function checkPathApi(ctx) {
  const { rel, code, report } = ctx;
  if (isTestFile(rel)) return;
  const builders = new Set([...code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*PathBuilder\.Make(?:FromPath)?\s*\(/g)].map((m) => m[1]));
  for (const match of code.matchAll(/\b[sS]kia\.Path\.Make\s*\(|\.\s*add(?:Circle|Rect|RRect|Oval|Arc|Path|Poly)\s*\(/g)) {
    if (!match[0].includes('Path.Make')) {
      const statement = code.slice(statementStart(code, match.index), match.index);
      const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(statement)?.[1];
      if (/PathBuilder\b/.test(statement) || (receiver !== undefined && builders.has(receiver))) continue;
    }
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'skia-path-api', message: 'uses the mutable Skia path API (deprecated in Skia 2.6, to be removed)', fix: PATH_FIX });
  }
}

function checkPatterns(ctx) {
  const { rel, code, report } = ctx;
  checkPathApi(ctx);
  for (const spec of PATTERN_RULES) {
    if (spec.runtimeOnly && isTestFile(rel)) continue;
    for (const match of code.matchAll(spec.re)) report.problem({ file: rel, line: lineOf(code, match.index), rule: spec.rule, message: spec.message, fix: spec.fix });
  }
  if (isTestFile(rel)) return;
  for (const match of code.matchAll(/scaleX\s*:\s*-\s*1\b|\.scale\(\s*-\s*1\s*,/g)) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'pixel-flip', message: 'pixel-flips the canvas (letters and digits would mirror)', fix: "Set isMirroredInRtl on the surface and let the layout mirror positions (cellRect/hitTest)." });
  }
}

/** An identifier ready for a RegExp (`$` is legal in names). */
const escapeName = (name) => name.replace(/\$/g, '\\$');

/** First canvas calls that paint every pixel of the clip (an opaque canvas must start with one). */
const FULL_COVER_CALLS = new Set(['drawColor', 'drawPaint', 'clear']);
/**
 * Matrix calls that may come first (the shake pattern: save, translate, then the background): drawColor,
 * drawPaint and clear fill the whole clip whatever the matrix is. clip* calls are never skipped: they
 * shrink what the fill covers.
 */
const MATRIX_CALLS = new Set(['save', 'translate', 'scale', 'rotate', 'skew', 'concat']);

/** The draw function the surface object names (`draw: drawProgressGrid`), or null without a surface object. */
function surfaceDrawName(root, dir) {
  const names = existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [];
  for (const name of names.filter((entry) => /-surface\.tsx?$/.test(entry) && !isTestFile(entry))) {
    const code = maskComments(readFileSync(join(root, dir, name), 'utf8'));
    const member = /\bdraw\s*:\s*([A-Za-z_$][\w$]*)/.exec(code);
    if (member !== null) return member[1];
    if (/^\s*draw\s*,?\s*$/m.test(code)) return 'draw';
  }
  return null;
}

/**
 * The first call of a function body that touches its canvas parameter, `canvas.x()` or
 * `helper(canvas, ...)`, after any leading matrix calls (save, translate, scale, rotate, skew, concat).
 */
function firstCanvasCall(scan, fn) {
  const params = scan.code.slice(fn.index + 1, matchBracket(scan.code, fn.index));
  const canvas = /^\s*([A-Za-z_$][\w$]*)/.exec(params)?.[1];
  if (canvas === undefined) return null;
  const body = scan.code.slice(fn.bodyStart + 1, fn.bodyEnd);
  const name = escapeName(canvas);
  const calls = new RegExp(`(?<![\\w$.])${name}\\s*\\.\\s*(\\w+)\\s*\\(|\\b(\\w+)\\s*\\(\\s*${name}(?![\\w$])`, 'g');
  for (const call of body.matchAll(calls)) {
    if (call[1] !== undefined && MATRIX_CALLS.has(call[1])) continue;
    return { canvas, method: call[1] ?? null, helper: call[2] ?? null };
  }
  return { canvas, method: null, helper: null };
}

/**
 * SurfaceCanvas renders an opaque <Canvas> (on Android a SurfaceView: transparent pixels are not
 * blended with what lies behind it), so the surface's draw() paints every pixel before anything else:
 * its first canvas call is drawColor/clear, or a same-file layer helper (drawBackground(canvas, frame))
 * whose own first canvas call is. A surface declared "opaque": false is exempt here; opaque-contract
 * proves that it really renders with isOpaque={false}.
 */
function checkOpaqueBackground(ctx) {
  const { rel, source, root, report, roles, scope } = ctx;
  if (!roles.isDraw) return;
  const dir = scope.surfaceDirOf(rel);
  if (scope.surfaceAt(dir)?.opaque === false) return;
  const scan = scanSource(source);
  const functions = functionsOf(scan).filter((fn) => fn.bodyStart !== -1);
  const wanted = surfaceDrawName(root, dir);
  const exported = functions.filter((fn) => /^draw/.test(fn.name) && new RegExp(`\\bexport\\s+(?:function\\s*${escapeName(fn.name)}|const\\s+${escapeName(fn.name)})\\b`).test(scan.code));
  const fn = wanted === null ? (exported.length === 1 ? exported[0] : undefined) : functions.find((entry) => entry.name === wanted);
  if (fn === undefined) return;
  const first = firstCanvasCall(scan, fn);
  if (first === null) return;
  if (first.method !== null && FULL_COVER_CALLS.has(first.method)) return;
  // One level of same-file layer helper: draw() may start with drawBackground(canvas, frame).
  const helper = first.helper === null ? undefined : functions.find((entry) => entry.name === first.helper && entry !== fn);
  const inner = helper === undefined ? null : firstCanvasCall(scan, helper);
  if (inner !== null && inner.method !== null && FULL_COVER_CALLS.has(inner.method)) return;
  const innerText = inner === null ? '' : inner.method !== null ? `, whose first canvas call is ${inner.canvas}.${inner.method}()` : inner.helper !== null ? `, which starts with ${inner.helper}(${inner.canvas}, ...) (only one helper level is followed)` : ', which never calls the canvas';
  const canvas = first.canvas;
  const what = first.method === null && first.helper === null ? 'never calls the canvas' : first.method === null ? `starts with ${first.helper}(${canvas}, ...)${innerText}` : `starts with ${canvas}.${first.method}()`;
  report.problem({ file: rel, line: fn.line, rule: 'opaque-background', message: `${fn.name} ${what}, but SurfaceCanvas is opaque: pixels it leaves untouched show black or stale content on device (an Android SurfaceView is not blended with what lies behind it)`, fix: `Make ${canvas}.drawColor(frame.colors.color.background) (or a drawPaint that covers the clip) the first call of ${fn.name} after any save/translate (or the first call of the background helper it starts with); for a canvas that must show what lies behind it, render it with isOpaque={false} and declare "opaque": false for the surface in contracts/canvas-surfaces.json.` });
}

/** The exported names of each surface folder's <id>-surface.ts (the CanvasSurface objects). */
function surfaceExports(root, dirs) {
  const exports = new Map();
  for (const dir of dirs) {
    const names = existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [];
    for (const name of names.filter((entry) => /-surface\.tsx?$/.test(entry) && !isTestFile(entry))) {
      const code = maskComments(readFileSync(join(root, dir, name), 'utf8'));
      for (const match of code.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)/g)) exports.set(`${dir}/${match[1]}`, dir);
    }
  }
  return exports;
}

/** The local name -> { name, spec } map of a file's named imports (`import { a as b } from 'x'`). */
function namedImports(source) {
  const imports = new Map();
  for (const match of source.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of match[1].split(',')) {
      const [name, local = name] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      if (name) imports.set(local.trim(), { name: name.trim(), spec: match[2] });
    }
  }
  return imports;
}

/**
 * Every <SurfaceHost>/<SurfaceCanvas> render site. A surface object it renders from outside every
 * surface folder is surface-outside-folder (the route an unannotated surface object takes).
 * "opaque": false in the contract exempts draw() from painting its background, so the claim must be
 * true where the surface is rendered: every SurfaceHost/SurfaceCanvas that renders such a surface
 * passes a literal isOpaque={false} (a spread proves nothing), at least one does, and isOpaque={false}
 * appears only on surfaces the contract declares "opaque": false (so the contract and the code agree).
 */
function checkRenderSites(root, scope, report, dirs, outside) {
  const exports = surfaceExports(root, dirs);
  const rendered = new Map();
  const files = walkRepo(root, { include: ['*.tsx'], ignore: ['**/*.d.ts'] }).filter((rel) => scope.isAppSource(rel) && !isTestFile(rel) && scope.kitOf(rel) === null);
  for (const rel of files) {
    const source = readFileSync(join(root, rel), 'utf8');
    if (!/<Surface(Host|Canvas)\b/.test(source)) continue;
    const masked = maskCode(source);
    const imports = namedImports(source);
    for (const tag of findJsxTags(source, masked).filter((entry) => entry.name === 'SurfaceHost' || entry.name === 'SurfaceCanvas')) {
      const attrs = jsxAttributes(source, tag, masked);
      const surfaceAttr = attrs.get('surface');
      if (surfaceAttr?.kind !== 'expr' || !/^[A-Za-z_$][\w$]*$/.test(surfaceAttr.value)) continue;
      const imported = imports.get(surfaceAttr.value);
      if (imported === undefined) continue;
      const target = resolveImport(rel, imported.spec, { root, aliases: scope.aliasesOf(rel) });
      if (target.kind !== 'local' || !target.exists) continue;
      if (scope.surfaceDirOf(target.path) === null && scope.kitOf(target.path) === null && !isTestFile(target.path) && !outside.has(target.path)) {
        // A surface object without the CanvasSurface annotation, found through the element that renders it.
        outside.add(target.path);
        const code = maskComments(readRepoFile(root, target.path) ?? '');
        const at = new RegExp(`\\bexport\\s+const\\s+${escapeName(imported.name)}\\b`).exec(code);
        report.problem({ file: target.path, line: at === null ? 1 : lineOf(code, at.index), rule: 'surface-outside-folder', message: `${imported.name} is rendered as a surface (<${tag.name} surface={${surfaceAttr.value}}> in ${rel}:${lineOf(source, tag.start)}) but lives outside every surface folder (${scope.surfaceGlobs.join(', ')}), so its draw and surface files escape the per-surface rules`, fix: `Move the surface's files into <featuresDir>/<feature>/canvas/ (or <srcDir>/games/<game-id>/canvas/), or declare its folder as a surface in ${scope.contract.file}.` });
      }
      const dir = exports.get(`${posix.dirname(target.path)}/${imported.name}`);
      if (dir === undefined) continue;
      const opaqueAttr = attrs.get('isOpaque');
      const isLiteralFalse = opaqueAttr?.kind === 'expr' && opaqueAttr.value === 'false';
      const declared = scope.surfaceAt(dir);
      const id = declared?.id ?? dir;
      const line = lineOf(source, tag.start);
      if (declared?.opaque === false) {
        rendered.set(dir, (rendered.get(dir) ?? 0) + (isLiteralFalse ? 1 : 0));
        if (!isLiteralFalse) report.problem({ file: rel, line, rule: 'opaque-contract', message: `<${tag.name}> renders ${id}, which ${scope.contract.file} declares "opaque": false, without a literal isOpaque={false}: the canvas stays opaque (on Android a SurfaceView), and the background its draw() leaves unpainted shows black on device`, fix: `Pass isOpaque={false} on this <${tag.name}> (written out, not through a spread), or remove "opaque": false for ${id} and start its draw() with canvas.drawColor(frame.colors.color.background).` });
      } else if (isLiteralFalse) {
        report.problem({ file: rel, line, rule: 'opaque-contract', message: `<${tag.name}> renders ${id} with isOpaque={false}, but ${scope.contract.file} does not declare it "opaque": false, so the checkers and its draw test treat it as opaque`, fix: `Declare "opaque": false for ${id} in ${scope.contract.file} (its surfaces entry), or drop isOpaque={false} and keep draw() painting every pixel first.` });
      }
    }
  }
  for (const surface of scope.contract.surfaces.filter((entry) => entry.opaque === false && dirs.includes(entry.dir))) {
    if ((rendered.get(surface.dir) ?? 0) > 0) continue;
    report.problem({ file: scope.contract.file, line: 1, rule: 'opaque-contract', message: `${surface.id} is declared "opaque": false, but no SurfaceHost or SurfaceCanvas in the app source renders it with isOpaque={false} (the exemption from opaque-background rests on that prop)`, fix: `Render ${surface.id} directly with <SurfaceHost ... isOpaque={false} /> (or SurfaceCanvas), importing its surface object from ${surface.dir}; or remove "opaque": false and start its draw() with drawColor.` });
  }
}

const FRAME_HOOKS = /\b(useDerivedValue|useFrameCallback|useAnimatedReaction|useAnimatedStyle|useAnimatedProps)\s*\(/g;

/** Creating Skia objects inside a callback that runs every frame allocates native memory 60-120 times a second. */
function checkFrameAlloc(ctx) {
  const { rel, code, report } = ctx;
  if (isTestFile(rel)) return;
  for (const hook of code.matchAll(FRAME_HOOKS)) {
    const open = hook.index + hook[0].length - 1;
    const args = balancedParens(code, open) ?? '';
    for (const call of args.matchAll(/\bSkia\.\w+(?:\.\w+)*\s*\(/g)) {
      report.problem({ file: rel, line: lineOf(code, open + 1 + call.index), rule: 'frame-alloc', message: `creates a Skia object (${call[0].replace(/\s*\($/, '')}) inside ${hook[1]}, which runs every frame`, fix: 'Create it once on the JS thread (the draw kit: makeDrawKit, buildPaths, makeCanvasColors; a recorder with useState(() => Skia.PictureRecorder())) and only use it inside the worklet.' });
    }
  }
}

const ROLE_IMAGE = /(?:\baccessibilityRole\s*=\s*\{?\s*["']image["']|\brole\s*=\s*\{?\s*["'](?:img|image)["'])/;
const ROLE_IMAGE_ALL = new RegExp(ROLE_IMAGE.source, 'g');
const A11Y_LABEL = /\b(?:accessibilityLabel|aria-label)\s*=/;
/**
 * `accessible` or `accessible={true}`. React Native 0.86 defaults accessible to false
 * (AccessibilityProps.h), Skia's Canvas spreads its props straight onto its native view (no View.js
 * processing), and iOS makes a view a VoiceOver element only when accessible is true: a label and a
 * role alone leave the canvas unreachable on iOS.
 */
const ACCESSIBLE = /\baccessible(?:\s*=\s*\{\s*true\s*\})?(?![\w$=])/;
const A11Y_OPT_OUT = /\baccessible\s*=\s*\{\s*false\s*\}|\bimportantForAccessibility\s*=\s*\{?\s*["']no-hide-descendants["']/;
const isImageElement = (tag) => ACCESSIBLE.test(tag) && ROLE_IMAGE.test(tag) && A11Y_LABEL.test(tag);

/**
 * True when the Canvas sits inside an element that is itself the screen reader's image (accessible,
 * accessibilityRole="image", accessibilityLabel), for example a View that measures the picture
 * before the Canvas exists: that element speaks for the whole picture.
 */
function hasImageWrapper(code, canvasIndex) {
  const before = code.slice(0, canvasIndex);
  const roles = [...before.matchAll(ROLE_IMAGE_ALL)];
  if (roles.length === 0) return false;
  const start = before.lastIndexOf('<', roles.at(-1).index);
  if (start === -1) return false;
  const tag = openingTag(code, start);
  const name = /^<([A-Za-z][\w.]*)/.exec(tag)?.[1];
  if (name === undefined || tag.endsWith('/>') || !isImageElement(tag)) return false;
  return !code.slice(start + tag.length, canvasIndex).includes(`</${name}>`);
}

/** The canvas-a11y problem of one <Canvas> opening tag, or null when it is an image or opts out. */
function canvasA11yProblem(code, tag, index) {
  if (isImageElement(tag) || hasImageWrapper(code, index) || A11Y_OPT_OUT.test(tag)) return null;
  const optOut = 'a purely decorative canvas opts out explicitly with accessible={false} or importantForAccessibility="no-hide-descendants"';
  if (ROLE_IMAGE.test(tag) && A11Y_LABEL.test(tag)) {
    return { message: 'canvas has an image role and a label but is not accessible: React Native 0.86 defaults accessible to false, and iOS makes a view a VoiceOver element only when accessible is true (TalkBack may still read it, so the gap shows on iOS only)', fix: `Add accessible (or accessible={true}) to the <Canvas>, next to its role and label; ${optOut}.` };
  }
  return { message: 'canvas is not an accessible image (accessible, accessibilityRole="image", accessibilityLabel): Skia content is invisible to VoiceOver and TalkBack', fix: `Add accessible accessibilityRole="image" accessibilityLabel={t(surface.describe(view))} to the <Canvas>; ${optOut}.` };
}

/** Hooks whose values change per frame (Reanimated and Skia): a name bound to one holds a per-frame value. */
const PER_FRAME_HOOKS = ['useDerivedValue', 'useFrameCallback', 'useClock', 'useSharedValue', 'useAnimatedReaction', 'usePathInterpolation', 'usePathValue', 'useVectorInterpolation', 'useRectBuffer', 'useRSXformBuffer'];
const ANIMATIONS = ['withRepeat', 'withTiming', 'withSpring', 'withDecay', 'withSequence', 'withDelay'];
/** A per-frame hook or animation called inside the canvas, or a per-frame type there (SharedValue<SkSize>, the onSize type, is layout). */
const PER_FRAME = new RegExp(`\\b(${[...PER_FRAME_HOOKS, ...ANIMATIONS].join('|')})\\s*\\(|\\b(SharedValue|DerivedValue)\\s*<(?!\\s*SkSize\\s*>)`);
/** Something that moves on its own: an animation, a clock or a frame callback (a size-derived value never contains one). */
const MOTION_CALL = new RegExp(`\\b(${[...ANIMATIONS, 'useClock', 'useFrameCallback'].join('|')})\\s*\\(`);
/** Imperative drawing: a canvas call, a recorder, or a picture made from draw calls. */
const DRAW_API = /\.\s*(draw[A-Z]\w*)\s*\(|\b(PictureRecorder|createPicture|drawAsPicture|drawAsImage)\s*\(/;
const DRAW_API_ALL = new RegExp(DRAW_API.source, 'g');
const NAME = '[A-Za-z_$][\\w$]*';
/** `const x = useSharedValue(...)` (and the other per-frame hooks), generics and annotations allowed. */
const PER_FRAME_DECLARATION = new RegExp(`\\b(?:const|let)\\s+(${NAME})\\s*(?::[^=;]*)?=\\s*(${PER_FRAME_HOOKS.join('|')})\\s*[<(]`, 'g');
/** A name typed as a shared value: a prop, a parameter, a wiring field. */
const PER_FRAME_TYPED = new RegExp(`(?<![\\w$])(${NAME})\\??\\s*:\\s*(?:Readonly<\\s*)?(SharedValue|DerivedValue)\\s*<`, 'g');
/** A name typed SharedValue<SkSize>: the canvas size Skia writes through onSize (a size prop handed to a child). */
const SIZE_TYPED = new RegExp(`(?<![\\w$])(${NAME})\\??\\s*:\\s*(?:Readonly<\\s*)?SharedValue\\s*<\\s*SkSize\\s*>`, 'g');
/** <Canvas onSize={size}>: the shared value Skia writes the canvas size into. */
const ON_SIZE = new RegExp(`\\bonSize\\s*=\\s*\\{\\s*(${NAME})\\s*\\}`, 'g');
const DECLARATION = new RegExp(`\\b(?:const|let)\\s+[\\[{]?\\s*(${NAME})[^=;]*?=(?![=>])`, 'g');
/** Top-level declarations start at column 0 in formatted code: function, const, let, class. */
const TOP_LEVEL = new RegExp(`^(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\b\\s*\\*?\\s*(${NAME})|(?:const|let|var|class)\\s+(${NAME}))`, 'gm');

/** Each <Canvas> element: where it starts and ends (its matching </Canvas>, or the tag itself when self-closing). */
function canvasElements(masked) {
  const elements = [];
  for (const match of masked.matchAll(/<Canvas\b/g)) {
    const start = match.index;
    const tag = openingTag(masked, start);
    const base = start + tag.length;
    let end = tag.endsWith('/>') ? base : masked.length;
    if (!tag.endsWith('/>')) {
      let depth = 1;
      for (const next of masked.slice(base).matchAll(/<Canvas\b|<\/Canvas\s*>/g)) {
        if (next[0].startsWith('</')) depth -= 1;
        else if (!openingTag(masked, base + next.index).endsWith('/>')) depth += 1;
        if (depth === 0) {
          end = base + next.index + next[0].length;
          break;
        }
      }
    }
    elements.push({ start, end });
  }
  return elements;
}

/** The text of a declaration's initializer that starts at `from`: up to the `;` that ends it, or its enclosing block. */
function initializerOf(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return code.slice(from, i);
    } else if (ch === ';' && depth === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

/**
 * The first of `names` the text reads, bare or as `props.<name>` (not another object's member, an
 * object key `name:` or a JSX attribute name `name=`), or null.
 */
function firstReference(text, names) {
  if (names.size === 0) return null;
  const re = new RegExp(`(?:(?<=\\bprops\\.)|(?<![\\w$.]))(${[...names].map(escapeName).join('|')})(?![\\w$]|:|=(?![=>]))`);
  return re.exec(text)?.[1] ?? null;
}

/** `names` plus every name declared from one of them, to a fixpoint (a derived value, a transform array). */
function taintedNames(file, names) {
  const tainted = new Set(names);
  let grew = tainted.size > 0;
  while (grew) {
    grew = false;
    for (const declaration of file.declarations) {
      if (tainted.has(declaration.name) || firstReference(declaration.init, tainted) === null) continue;
      tainted.add(declaration.name);
      grew = true;
    }
  }
  return tainted;
}

/**
 * The name a call's value is bound to: `const x = call(...)`, `x.set(call(...))`, `x.value = call(...)`
 * or `x = call(...)`, following enclosing calls, arrays, arrow bodies and parenthesised objects outwards
 * (`x.set(withSequence(withRepeat(...)))`, `useState(() => createPicture(...))`). Null when the value is
 * not bound (a JSX attribute, a returned style object).
 */
function boundName(code, index) {
  let at = index;
  for (let level = 0; level < 10; level += 1) {
    const start = statementStart(code, at);
    const head = code.slice(start, at);
    const declared = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+[\\[{]?\\s*(${NAME})`).exec(head);
    if (declared !== null) return declared[1];
    const assigned = new RegExp(`^\\s*(${NAME})\\s*(?:\\.\\s*set\\s*$|(?:\\.\\s*value\\s*)?=(?![=>]))`).exec(head);
    if (assigned !== null) return assigned[1];
    const opener = start === 0 ? '' : code[start - 1];
    const before = code.slice(Math.max(0, start - 40), Math.max(0, start - 1));
    const isArrowBody = opener === '{' && /=>\s*$/.test(before);
    const isWrappedObject = opener === '{' && /\(\s*$/.test(before);
    if (!(opener === '(' || opener === '[' || isArrowBody || isWrappedObject)) return null;
    at = start - 1;
  }
  return null;
}

/**
 * The per-frame names that only carry the canvas size, so they are layout, not motion: the shared value
 * a <Canvas onSize={size}> of the file writes (or a prop typed SharedValue<SkSize>, the size handed to a
 * child), when no JS code writes it, plus every useDerivedValue computed from those names alone with no
 * animation, clock or frame callback (a gradient end at the canvas corner). Skia sets the size on
 * layout, so a static backdrop that sizes itself this way never animates.
 */
function layoutNames(file) {
  const { masked, declarations, perFrameSources } = file;
  const isWritten = (name) => new RegExp(`(?<![\\w$.])${escapeName(name)}\\s*\\.\\s*(?:set|modify)\\s*\\(|(?<![\\w$.])${escapeName(name)}\\s*\\.\\s*value\\s*=(?![=>])`).test(masked);
  const onSize = new Set();
  for (const match of masked.matchAll(/<Canvas\b/g)) for (const attr of openingTag(masked, match.index).matchAll(ON_SIZE)) onSize.add(attr[1]);
  for (const match of masked.matchAll(SIZE_TYPED)) onSize.add(match[1]);
  const sizes = new Set([...onSize].filter((name) => ['useSharedValue', 'SharedValue'].includes(perFrameSources.get(name)) && !isWritten(name)));
  const layout = new Set(sizes);
  const derived = (name) => perFrameSources.get(name) === 'useDerivedValue';
  // Grow: derived values that read a size (or a size-derived value) and nothing that moves on its own.
  for (let grew = true; grew; ) {
    grew = false;
    for (const declaration of declarations) {
      if (layout.has(declaration.name) || !derived(declaration.name) || MOTION_CALL.test(declaration.init) || firstReference(declaration.init, layout) === null) continue;
      layout.add(declaration.name);
      grew = true;
    }
  }
  // Shrink: a derived value that also reads a motion value moves with it.
  for (let shrank = layout.size > sizes.size; shrank; ) {
    shrank = false;
    const motion = taintedNames(file, [...perFrameSources.keys()].filter((name) => !layout.has(name)));
    for (const name of [...layout].filter((entry) => !sizes.has(entry))) {
      const declaration = declarations.find((entry) => entry.name === name);
      if (declaration === undefined || firstReference(declaration.init, motion) === null) continue;
      layout.delete(name);
      shrank = true;
    }
  }
  return layout;
}

/**
 * What one .tsx file says about its canvases, computed once: each <Canvas> element, the same-file
 * components, and the names that hold per-frame values or pictures drawn with the Skia draw API.
 */
function canvasFileOf(ctx) {
  if (ctx.canvasFile !== undefined) return ctx.canvasFile;
  const masked = maskCode(ctx.source);
  const declarations = [...masked.matchAll(DECLARATION)].map((m) => ({ name: m[1], init: initializerOf(masked, m.index + m[0].length) }));
  const perFrameSources = new Map();
  for (const m of masked.matchAll(PER_FRAME_DECLARATION)) perFrameSources.set(m[1], m[2]);
  for (const m of masked.matchAll(PER_FRAME_TYPED)) if (!perFrameSources.has(m[1])) perFrameSources.set(m[1], m[2]);
  const file = { masked, declarations, components: [...masked.matchAll(TOP_LEVEL)].map((m) => ({ name: m[1] ?? m[2], start: m.index })) };
  file.perFrameSources = perFrameSources;
  file.layout = layoutNames(file);
  file.perFrame = taintedNames(file, [...perFrameSources.keys()].filter((name) => !file.layout.has(name)));
  file.drawn = taintedNames(file, [...masked.matchAll(DRAW_API_ALL)].map((m) => boundName(masked, m.index)).filter((name) => name !== null));
  file.elements = canvasElements(masked).map((element) => canvasRanges(file, element));
  ctx.canvasFile = file;
  return file;
}

/**
 * The source ranges a canvas renders: its own subtree plus each same-file component it renders (one
 * level), so `<Canvas><Pulse /></Canvas>` sees the hooks of a Pulse declared in the same file.
 */
function canvasRanges(file, element) {
  const own = file.masked.slice(element.start, element.end);
  const used = new Set([...own.matchAll(/<([A-Z][\w$]*)\b/g)].map((m) => m[1]).filter((name) => name !== 'Canvas'));
  const ranges = [[element.start, element.end]];
  file.components.forEach((component, index) => {
    if (used.has(component.name)) ranges.push([component.start, file.components[index + 1]?.start ?? file.masked.length]);
  });
  return { ...element, ranges, text: ranges.map(([from, to]) => file.masked.slice(from, to)).join('\n') };
}

/** Why one canvas is a computed picture: { perFrame, picture } (each null when it does not apply). */
function computedReasons(file, element) {
  const inline = PER_FRAME.exec(element.text);
  const name = firstReference(element.text, file.perFrame);
  const source = name === null ? null : file.perFrameSources.get(name) ?? 'derived from a shared value';
  const drawApi = DRAW_API.exec(element.text);
  const drawn = firstReference(element.text, file.drawn);
  return {
    perFrame: inline !== null ? `reads per-frame values (${inline[1] ?? inline[2]})` : name === null ? null : `reads per-frame values (${name}: ${source})`,
    picture: /<Picture\b/.test(element.text) ? 'renders a <Picture>' : drawApi !== null ? `calls the Skia draw API (${drawApi[1] ?? drawApi[2]})` : drawn === null ? null : `shows ${drawn}, drawn with the Skia draw API`,
  };
}

/**
 * A <Canvas> outside the kit and the surface folders, judged by what that element renders (not by the
 * rest of its file: a button may animate its own press scale beside a static gradient canvas). A static
 * declarative canvas (a gradient, a blur, a fixed shape) is fine anywhere: it has no draw(), no frame
 * loop and nothing to animate. A computed picture belongs in a surface folder, where the worklet,
 * opacity, budget and golden rules reach it. Static art recorded once is declared in "staticCanvases";
 * the declaration never excuses a per-frame value.
 */
function checkOutsideCanvas(ctx, element) {
  const { rel, code, report, scope } = ctx;
  const { perFrame, picture } = computedReasons(canvasFileOf(ctx), element);
  const isDeclaredStatic = scope.contract.staticCanvases.includes(rel);
  const reason = perFrame ?? (isDeclaredStatic ? null : picture);
  if (reason === null) return;
  const line = lineOf(code, element.start);
  const sizing = 'Static art that only needs its own size is layout, not motion: <Canvas onSize={size}> with values derived from size alone (useDerivedValue, no animation), or useCanvasSize() (React state, measured once).';
  const fix = isDeclaredStatic
    ? `A canvas declared in "staticCanvases" of ${scope.contract.file} is static art: remove the per-frame values, or make it a surface (<featuresDir>/<feature>/canvas/ from the templates, rendered with SurfaceHost) and drop the declaration. ${sizing}`
    : `Make it a surface: move the drawing into <featuresDir>/<feature>/canvas/ (draw-<id>.ts, layout-<id>.ts, <id>-surface.ts from the templates) and render it with SurfaceHost or SurfaceCanvas. Static art recorded once (createPicture) may stay: list the file in "staticCanvases" of ${scope.contract.file}. ${sizing}`;
  report.problem({ file: rel, line, rule: 'canvas-outside-surface', message: `<Canvas> outside the canvas kit and the surface folders ${reason}${isDeclaredStatic ? ', but the file is declared static art in "staticCanvases"' : ''} (its drawing escapes the worklet, opacity, budget and golden rules)`, fix });
}

/** The local names of the Skia element components a file imports as values (`import { Rect, Group } from Skia`). */
function skiaElementImports(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@shopify\/react-native-skia['"]/g)) {
    if (match[1] !== undefined) continue;
    for (const part of match[2].split(',').map((entry) => entry.trim()).filter((entry) => entry !== '' && !entry.startsWith('type '))) {
      const local = part.split(/\s+as\s+/).at(-1).trim();
      if (/^[A-Z]/.test(local) && local !== 'Canvas') names.add(local);
    }
  }
  return names;
}

/**
 * A file that renders Skia elements (<Rect>, <Path>, <Group> ...) with per-frame values but no <Canvas>
 * is the animated half of a computed canvas that another file renders (`<Canvas>{bars.map(...)}</Canvas>`
 * in bar-chart.tsx, the hooks in animated-bar.tsx). Judged per element, as checkOutsideCanvas judges a
 * canvas: a Skia element whose attributes read a per-frame value (or call a per-frame hook) counts; a
 * static shape exported for someone's canvas does not, nor an animated ordinary view beside it.
 */
function checkCanvasFeeder(ctx) {
  const { rel, code, report } = ctx;
  const elements = skiaElementImports(maskComments(ctx.source));
  if (elements.size === 0) return;
  const file = canvasFileOf(ctx);
  if (file.elements.length > 0) return;
  for (const match of file.masked.matchAll(/<([A-Z][\w$]*)\b/g)) {
    if (!elements.has(match[1]) || /[\w$)\].]/.test(file.masked[match.index - 1] ?? '')) continue;
    const tag = openingTag(file.masked, match.index);
    const inline = PER_FRAME.exec(tag);
    const name = firstReference(tag, file.perFrame);
    if (inline === null && name === null) continue;
    const why = inline !== null ? inline[1] ?? inline[2] : `${name}: ${file.perFrameSources.get(name) ?? 'derived from a shared value'}`;
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'canvas-outside-surface', message: `<${match[1]}> (a Skia element) reads per-frame values (${why}) in a file that renders no <Canvas>: it animates a computed canvas that another file renders, outside the canvas kit and the surface folders (its drawing escapes the worklet, opacity, budget and golden rules)`, fix: `Make the canvas that renders this component a surface: draw the bars, cells or marks in <featuresDir>/<feature>/canvas/draw-<id>.ts from the view and a timeline (the templates), and render it with SurfaceHost or SurfaceCanvas instead of animating Skia nodes in child components. A child that reads only the canvas size (a SharedValue<SkSize> prop, the value onSize writes) is layout and stays where it is.` });
    return;
  }
}

/** Entries of "staticCanvases" that name no file with a <Canvas> (a stale declaration hides nothing, but misleads). */
function checkStaticCanvases(root, scope, report) {
  for (const rel of scope.contract.staticCanvases) {
    const source = readRepoFile(root, rel);
    if (source !== null && /<Canvas\b/.test(maskComments(source))) continue;
    report.problem({ file: scope.contract.file, line: 1, rule: 'canvas-outside-surface', message: `"staticCanvases" lists ${rel}, which ${source === null ? 'does not exist' : 'renders no <Canvas>'}`, fix: `Remove the entry, or correct the path in ${scope.contract.file}.` });
  }
}

function checkComponents(ctx) {
  const { rel, code, report, isCanvasCode } = ctx;
  if (isTestFile(rel)) return;
  if (rel.endsWith('.tsx')) {
    for (const match of code.matchAll(/<Canvas\b/g)) {
      const tag = openingTag(code, match.index);
      const line = lineOf(code, match.index);
      if (/\bonLayout\s*=/.test(tag)) report.problem({ file: rel, line, rule: 'canvas-onlayout', message: '<Canvas onLayout> is not supported on the New Architecture (Skia 2.6.2 logs a console.error for it and types it @deprecated)', fix: 'Pass a shared value: <Canvas onSize={size}> (the kit\'s useSurfacePlayer creates it).' });
      const a11y = canvasA11yProblem(code, tag, match.index);
      if (a11y !== null) report.problem({ file: rel, line, rule: 'canvas-a11y', ...a11y });
    }
    if (!isCanvasCode) {
      for (const element of canvasFileOf(ctx).elements) checkOutsideCanvas(ctx, element);
      checkCanvasFeeder(ctx);
    }
  }
  // A call, not the hook's own definition (export function useSceneClock(...)).
  const calls = [...code.matchAll(/(\bfunction\s+)?\buseSceneClock\s*\(/g)].filter((match) => match[1] === undefined);
  if (calls.length > 0 && !/\buseCanvasLifecycle\s*\(/.test(code)) {
    report.problem({ file: rel, line: lineOf(code, calls[0].index), rule: 'lifecycle', message: 'runs a scene clock without useCanvasLifecycle (its timeline would keep playing under overlays and on an unfocused screen that stays mounted, and its cues and sounds would keep firing after the app leaves the foreground)', fix: 'Call useCanvasLifecycle({ isFocused, isInterrupted, onPause, onResume }) next to useSceneClock (as useSurfacePlayer does).' });
  }
}

/** Splits a call's argument text at top-level commas. */
function topLevelArgs(text) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

/**
 * True when the value made at `index` (a useClock() or withRepeat(..., -1) call) reaches a <Canvas> of
 * the file: the call sits inside a canvas (or a same-file component it renders), or the name it is bound
 * to, or a value derived from that name, is read there.
 */
function reachesCanvas(file, index) {
  if (file.elements.some((element) => element.ranges.some(([from, to]) => index >= from && index < to))) return true;
  const name = boundName(file.masked, index);
  if (name === null) return false;
  const tainted = taintedNames(file, [name]);
  return file.elements.some((element) => firstReference(element.text, tainted) !== null);
}

/**
 * Skia's useClock() runs a frame callback on every frame while the component is mounted (and reads
 * timeSinceFirstFrame); withRepeat(..., -1) never ends. Either keeps the display link and the picture
 * busy while nothing changes, for as long as the component is mounted: idle, on an unfocused screen
 * that stays mounted, under a modal or overlay. The kit's scene clock stops itself. In the kit and the
 * surface folders, and in a Skia file that renders no <Canvas> (a hook feeding one elsewhere), every
 * call counts; in any other .tsx file only a call whose value reaches one of its <Canvas> elements,
 * because the same file may animate an ordinary view (motion-and-animation's concern).
 */
function checkIdleClock(ctx) {
  const { rel, code, report, isCanvasCode } = ctx;
  if (isTestFile(rel)) return;
  const fix = "Drive canvas motion with the kit's scene clock: a committed change -> buildTimeline -> SurfaceHost (it stops when the timeline ends and under useCanvasLifecycle). A picture that truly moves all the time is a live surface (realtime-game-loop), paused by the same lifecycle.";
  const hits = [...code.matchAll(/(?<![\w$.])useClock\s*\(/g)].map((match) => ({ index: match.index, message: 'useClock() runs a frame callback on every frame for as long as the component is mounted (idle, on an unfocused screen that stays mounted, under a modal or overlay)' }));
  for (const match of code.matchAll(/(?<![\w$.])withRepeat\s*\(/g)) {
    const args = topLevelArgs(balancedParens(code, match.index + match[0].length - 1) ?? '');
    if (/^(-\s*1|Infinity|Number\.POSITIVE_INFINITY)$/.test(args[1] ?? '')) hits.push({ index: match.index, message: 'withRepeat(..., -1) repeats forever, so the canvas re-records every frame for as long as it is mounted, while nothing changes' });
  }
  if (hits.length === 0) return;
  const file = isCanvasCode || !rel.endsWith('.tsx') ? null : canvasFileOf(ctx);
  for (const hit of hits) {
    if (file !== null && file.elements.length > 0 && !reachesCanvas(file, hit.index)) continue;
    report.problem({ file: rel, line: lineOf(code, hit.index), rule: 'idle-clock', message: hit.message, fix });
  }
}

/** The surface contract types: a file that uses them is a surface object or a draw module. */
const SURFACE_TYPES = new Set(['CanvasSurface', 'DrawFrame']);

/**
 * A surface object or draw file outside every surface folder escapes the per-surface rules (worklet
 * directive, pure and opaque draw, required files, goldens) and the npm-test worklet gate.
 */
function checkSurfaceOutsideFolder(ctx) {
  const { rel, source, root, report, scope, outside } = ctx;
  for (const match of source.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = match[1].split(',').map((name) => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]);
    const used = names.filter((name) => SURFACE_TYPES.has(name));
    if (used.length === 0) continue;
    const target = resolveImport(rel, match[2], { root, aliases: scope.aliasesOf(rel) });
    if (target.kind !== 'local' || scope.kitOf(target.path) === null || !/(^|\/)canvas-types\.tsx?$/.test(target.path)) continue;
    outside.add(rel);
    report.problem({ file: rel, line: lineOf(source, match.index), rule: 'surface-outside-folder', message: `imports the kit's ${used.join(' and ')} type outside every surface folder (${scope.surfaceGlobs.join(', ')}), so its draw and surface files escape the worklet, pure-draw, opacity, file and golden rules`, fix: `Move the surface's files into <featuresDir>/<feature>/canvas/ (or <srcDir>/games/<game-id>/canvas/), or declare its folder as a surface in ${scope.contract.file} ("surfaces": [{ "id", "dir" }]).` });
  }
}

const CLOCK_DECISIONS = ['pushScene', 'stopClock', 'resumeClock', 'finishRun'];

/**
 * The clock's JS side keeps its own record (scene-clock-state) and asks it for every switch: a
 * scene pushed while the surface may not run waits, every resume runs at least one frame, and a
 * done message names its run, so a stale one cannot stop a newer scene.
 */
function checkClockRunnable(ctx) {
  const { rel, source, code, report, roles } = ctx;
  if (!roles.isClockHook) return;
  const imported = new Set(
    [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/scene-clock-state(?:\.ts)?['"]/g)].flatMap((m) =>
      m[1].split(',').map((name) => name.trim().replace(/^type\s+/, '')),
    ),
  );
  const missing = CLOCK_DECISIONS.filter((name) => !imported.has(name));
  if (missing.length > 0) {
    report.problem({ file: rel, line: 1, rule: 'clock-runnable', message: `the clock hook does not route its decisions through scene-clock-state (missing ${missing.join(', ')})`, fix: "Import pushScene, stopClock, resumeClock and finishRun from './scene-clock-state' and apply each step's setActive (the template's apply(step))." });
  }
  for (const match of code.matchAll(/\.setActive\(\s*(true|false)\s*\)/g)) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'clock-runnable', message: `switches the frame callback with a literal setActive(${match[1]}) instead of a scene-clock-state step`, fix: 'Call apply(pushScene(...)), apply(stopClock(...)), apply(resumeClock(...)) or apply(finishRun(...)); apply sets the run, then setActive(step.setActive).' });
  }
  for (const match of code.matchAll(/\bscene\s*\.\s*get\s*\(/g)) {
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'clock-runnable', message: 'reads the scene shared value on the JS thread (until the UI applies a push, the read returns the old scene, so a stale done stopped the new one)', fix: "Keep the last push in the clock driver's ClockControl (scene-clock-state) and let finishRun compare the done message's run with control.run." });
  }
}

/** Any import of the Skia package (a value or a type): the file draws or prepares Skia content. */
const SKIA_IMPORT = /(?:\bfrom|\bimport|\brequire\s*\()\s*['"]@shopify\/react-native-skia(?:\/[^'"]*)?['"]/;
/** A named import of the surface contract types (resolved against the kit in checkSurfaceOutsideFolder). */
const SURFACE_TYPE_IMPORT = /\bimport\s+(?:type\s+)?\{[^}]*\b(?:CanvasSurface|DrawFrame)\b[^}]*\}\s*from\s*['"][^'"]*canvas-types(?:\.tsx?)?['"]/;

/**
 * The files to check: everything in the kit and surface folders, plus every runtime file of the
 * app source that imports Skia (a sparkline in src/features/<f>/components, a src/ui primitive) or
 * the kit's surface contract types (a surface whose folder no glob matches).
 */
function canvasFiles(root, scope) {
  const files = [];
  for (const rel of walkRepo(root, { include: ['*.ts', '*.tsx'], ignore: ['**/*.d.ts'] })) {
    const isCanvasCode = scope.inScope(rel);
    if (!isCanvasCode && (!scope.isAppSource(rel) || isTestFile(rel))) continue;
    const source = readFileSync(join(root, rel), 'utf8');
    const code = maskComments(source);
    if (isCanvasCode || SKIA_IMPORT.test(code) || SURFACE_TYPE_IMPORT.test(code)) files.push({ rel, source, code, isCanvasCode });
  }
  return files;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-canvas-code', json: options.json });
  const scope = canvasScope(root, { kitDir: options['kit-dir'], surfaceDirs: options['surface-dir'] });
  if (!scope.hasSkia) return report.notApplicable(`${SKIA_PACKAGE} is not in package.json (the app draws no Skia canvas)`);
  const dirs = surfaceFolders(root, scope); // a configured glob that matches no folder is bad input, never a silent pass
  const files = canvasFiles(root, scope);
  const outside = new Set(); // surface files reported as surface-outside-folder (reported once)
  if (files.length === 0) {
    fail(`nothing to check: no canvas code in ${scope.kitDirs.join(', ')} or ${scope.surfaceGlobs.join(', ')}, and no app source file imports ${SKIA_PACKAGE}`, "Copy the kit from this skill's templates/src/canvas (references/architecture.md), or pass --kit-dir / --surface-dir for another layout.");
  }
  for (const { rel, source, code, isCanvasCode } of files) {
    const ctx = { rel, source, code, root, report, scope, isCanvasCode, outside, roles: rolesOf(scope, rel) };
    checkWorklet(ctx);
    checkSharedValues(ctx);
    checkPatterns(ctx);
    checkComponents(ctx);
    checkFrameAlloc(ctx);
    checkIdleClock(ctx);
    if (!isCanvasCode) {
      checkSurfaceOutsideFolder(ctx);
      continue;
    }
    checkFrameCallbacks(ctx);
    checkDraw(ctx);
    checkOpaqueBackground(ctx);
    checkClockRunnable(ctx);
  }
  checkStaticCanvases(root, scope, report);
  checkRenderSites(root, scope, report, dirs, outside);
  return report.finish({ checked: files.length, unit: 'canvas source files' });
});
