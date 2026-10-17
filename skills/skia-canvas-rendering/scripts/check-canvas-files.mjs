#!/usr/bin/env node
// check-canvas-files.mjs: checks that the canvas kit and every canvas surface of an Expo app are
// complete: required files, palette sets, timeline and draw-call tests, pixel goldens with
// baselines, the layout probe's containment, the iOS 120 Hz key and the Jest golden project.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-canvas-files.mjs [repo-root] [--surface <id>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, run, walk } from './check-lib.mjs';
import { canvasScope, DEFAULT_GOLDENS_DIR, SKIA_PACKAGE, surfaceFolders } from './lib/canvas-scope.mjs';
import { CONTRAST_KEYS, contrastFailures, contrastFileProblems, contrastThresholds } from './lib/canvas-contrast.mjs';
import { readPlist } from './lib/plist.mjs';
import { resolveImport } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-canvas-files',
  summary: 'Checks that the canvas kit (default src/canvas) and each canvas surface (default src/features/<feature>/canvas, or contracts/canvas-surfaces.json) have every file, palette set, test and pixel golden the skia-canvas-rendering skill requires.',
  usage: '[repo-root] [options]',
  options: {
    surface: { type: 'string', multiple: true, value: 'id', help: 'Only check these surface ids (default: every surface)' },
    'kit-dir': { type: 'string', multiple: true, value: 'dir', help: 'The canvas kit folder (default: <srcDir>/canvas, or rn-skills.config.json "canvasKitDir")' },
    'surface-dir': { type: 'string', multiple: true, value: 'glob', help: 'Surface folders (default: <featuresDir>/*/canvas and <srcDir>/games/*/canvas, or "canvasSurfaceDirs"; "**/canvas" works)' },
    'goldens-dir': { type: 'string', value: 'dir', help: `Pixel goldens folder (default: the contract's "goldensDir", else ${DEFAULT_GOLDENS_DIR})` },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  kit-file-missing        the kit files and their tests exist (scene clock, clock decisions, frame runner, recorder,',
    '                          layout, timeline, text, kit, canvas, presenter, cues, lifecycle, player, host, probe,',
    '                          PNG painter), plus test/goldens/skia-golden.ts and the worklet-boundary gate in',
    '                          scripts/quality; a repo with a surface but no kit gets the whole list (exit 1)',
    '  kit-import-unresolved   every import of a present kit file resolves: a repo file that exists, or a package that',
    '                          a package.json declares (the fix names the skill that creates it)',
    '  surface-file-missing    a timeline surface has canvas-palettes.json/.ts, canvas-contrast.json, to-view,',
    '                          build-timeline (+ test), layout-* (+ test), draw-* (+ test) and <id>-surface.ts; a live',
    '                          surface has palettes, contrast pairs and a draw file',
    '  palette-sets            canvas-palettes.json holds exactly the palette sets (light and dark, plus the sets the',
    '                          contract lists) with identical tokens and #RRGGBB(AA) values',
    `  contrast-file           canvas-contrast.json (format 1, keys ${CONTRAST_KEYS.join(', ')}) is a JSON object with`,
    '                          known keys only, well-formed pairs, at least one text, graphics or shapes pair, an edge',
    '                          token for [fill, ground] shapes, an opaque base token (default background), and only',
    '                          tokens and sets canvas-palettes.json has',
    '  text-contrast           every "text" pair [fg, bg] reaches 4.5:1 in every palette set (WCAG 2.2 1.4.3)',
    '  non-text-contrast       every "graphics" pair [fg, bg] reaches 3:1 in every palette set (WCAG 2.2 1.4.11)',
    '  shape-contrast          every "shapes" entry [fill, ground] or [fill, ground, edge] stands 3:1 off its edge (the',
    '                          "edge" token by default) or off its ground, whichever is higher, in every set',
    '  cvd-separation          every "distinct" list stays at least 0.07 apart in OKLab under protanopia, deuteranopia',
    '                          and tritanopia (Machado 2009) in every set, or in the sets "distinctSets" names',
    '                          (translucent tokens are composited over their ground, a translucent ground over the base;',
    '                          quality-gates.json "a11y" may raise the thresholds, never lower them; the same formulas,',
    "                          keys and thresholds as accessibility-as-code's check-contrast, whose canvas-contrast rule",
    '                          measures the same two files)',
    '  contrast-declared-once  no palette entry of contracts/contrast.json (or rn-skills.config.json "contrastContract")',
    "                          names a surface's canvas-palettes.json/.ts: its pairs live only in canvas-contrast.json,",
    '                          and a second pair table drifts (nothing to check while that contract does not exist)',
    "  timeline-reduced        build-timeline.test.ts builds the reduced-motion timeline (buildTimeline and 'reduced' in",
    '                          code, not only in a comment)',
    '  draw-budget             the draw test asserts a draw-call budget (toBeLessThanOrEqual(<n or *BUDGET*>), Prettier\'s',
    '                          wrapped form with a trailing comma included) of at most 1000 and records drawText',
    '  surface-object          <id>-surface.ts sets isMirroredInRtl, toView, layout, draw, buildPaths and describe',
    '  golden-test             <goldens>/<id>.golden.test.ts renders paintSurfacePng at >= 3 sizes and moments 0, 0.5, 1',
    '  golden-baselines        <goldens>/__image_snapshots__ holds >= 9 reviewed <id>-*.png baselines',
    '  probe-contained         <kit>/canvas-layout-probe.tsx clips its frame (overflow hidden) and spans its text box',
    '                          across it (absolute, insetInlineStart 0, insetInlineEnd 0), so a screenshot mask over the',
    '                          canvas also hides the probe text',
    '  plist-120hz             CADisableMinimumFrameDurationOnPhone stays true on iOS: no Expo config or config plugin',
    "                          sets it to false or deletes it (Expo's prebuild template sets it true), and a committed",
    '                          ios/<App>/Info.plist (bare native folders) holds it as true',
    '  jest-golden-project     the Jest config has a golden project on @shopify/react-native-skia/jestEnv.js',
    '',
    'Surfaces: contracts/canvas-surfaces.json when present (id, dir, kind timeline|live, opaque, paletteSets, goldensDir),',
    'plus every folder the surface globs match (kit folders and the goldens folder never count). A malformed contract,',
    'or a configured surface glob that matches no folder, is bad input (exit 2).',
    `NOT APPLICABLE when no package.json declares ${SKIA_PACKAGE}.`,
    'Example: node check-canvas-files.mjs . --surface progress-grid',
  ].join('\n'),
};

const KIT_FILES = [
  'canvas-types.ts', 'canvas-layout.ts', 'canvas-layout.test.ts',
  'timeline/track.ts', 'timeline/sample.ts', 'timeline/sample.test.ts', 'timeline/particles.ts', 'timeline/particles.test.ts',
  'draw-kit.ts', 'draw-kit.test.ts', 'scene.ts', 'scene.test.ts',
  'scene-clock-state.ts', 'scene-clock-state.test.ts', 'scene-clock-traces.test.ts',
  'run-scene-frame.ts', 'run-scene-frame.test.ts', 'use-scene-clock.ts', 'record-picture.ts', 'record-picture.test.ts',
  'describe-error.ts', 'describe-error.test.ts', 'draw-text.ts', 'draw-text.test.ts',
  'surface-canvas.tsx', 'surface-canvas.test.tsx', 'present-change.ts', 'present-change.test.ts',
  'cue-scheduler.ts', 'cue-scheduler.test.ts', 'use-canvas-lifecycle.ts', 'use-canvas-lifecycle.test.ts',
  'use-surface-player.ts', 'use-surface-player.test.ts',
  'surface-host.tsx', 'surface-host.test.tsx', 'canvas-layout-probe.tsx', 'canvas-layout-probe.test.tsx', 'paint-surface-png.ts',
  'use-committed-change.ts', 'use-committed-change.test.ts',
];
/** Repo-level files: the golden matcher and the worklet-boundary gate that runs inside `npm test`. */
const REPO_FILES = ['test/goldens/skia-golden.ts', 'scripts/quality/check-worklet-boundary.ts', 'scripts/quality/check-worklet-boundary.test.ts', 'scripts/quality/worklet-transform.test.ts'];
/** Where a missing import comes from, for the fix text: [path or package pattern, owner]. */
const IMPORT_OWNERS = [
  [/(^|\/)ui\/app-text(\.tsx)?$|(^|\/)theme\//, 'design-system-structure (AppText and the theme)'],
  [/^@?test\/|(^|\/)test\/(render|test-)/, 'unit-and-component-tests (the test helpers)'],
  [/(^|\/)hooks\/use-is-app-active(\.ts)?$/, 'react-components-and-hooks (the shared foreground hook; this skill ships a synced copy in templates/src/hooks/)'],
  [/(^|\/)services\/(audio|haptics)\//, 'audio-and-haptics-feedback (the audio and haptics ports)'],
  [/(^|\/)canvas\/gestures\/|use-canvas-gestures/, 'canvas-gestures-and-hit-testing (the gesture layer)'],
  [/^@testing-library\/react-native$|^test-renderer$|^fast-check$/, 'unit-and-component-tests (RNTL 14 with test-renderer, fast-check; pinned with dependency-management)'],
  [/^jest-image-snapshot$/, 'golden-and-snapshot-tests (jest-image-snapshot, pinned with dependency-management)'],
  [/^@shopify\/react-native-skia$|^react-native-(reanimated|worklets|gesture-handler)$/, 'npx expo install <package> (the canonical stack; expo-project-bootstrap)'],
];
const NODE_BUILTIN = /^(node:|(assert|buffer|child_process|crypto|events|fs|os|path|process|stream|url|util|zlib)$)/;
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const MAX_DRAW_CALLS = 1000;
const MIN_BASELINES = 9;
const EXPO_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];
const JEST_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs'];

const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
/** Source with comments blanked: a rule is met by code, never by a mention in a comment. */
const readCode = (root, rel) => {
  const text = read(root, rel);
  return text === null ? null : maskComments(text);
};
const list = (root, rel) => (existsSync(join(root, rel)) ? readdirSync(join(root, rel)) : []);

function ownerOf(target) {
  return IMPORT_OWNERS.find(([pattern]) => pattern.test(target))?.[1] ?? 'the skill that owns that file (references/architecture.md, Prerequisites)';
}

/** Every import of a present kit file resolves: a repo file that exists, or a declared package. */
function checkImports(ctx, rel) {
  const { root, scope, report } = ctx;
  const code = readCode(root, rel);
  if (code === null) return;
  const specs = [
    ...code.matchAll(/^[ \t]*(?:import|export)\b[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/gm),
    ...code.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm),
  ];
  for (const match of specs) {
    const spec = match[1];
    if (NODE_BUILTIN.test(spec)) continue;
    const target = resolveImport(rel, spec, { root, aliases: scope.aliasesOf(rel) });
    const line = lineOf(code, match.index);
    if (target.kind === 'local') {
      if (!target.exists) report.problem({ file: rel, line, rule: 'kit-import-unresolved', message: `imports ${spec}, but ${target.path} does not exist (the kit would not compile)`, fix: `Build it first with ${ownerOf(target.path)}.` });
      continue;
    }
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!scope.packages.has(name)) report.problem({ file: rel, line, rule: 'kit-import-unresolved', message: `imports the package ${name}, which no package.json in the repo declares`, fix: `Add it the pinned way: ${ownerOf(name)}.` });
  }
}

function checkKit(ctx) {
  const { root, scope, report } = ctx;
  const expected = [...scope.kitDirs.flatMap((dir) => KIT_FILES.map((file) => `${dir}/${file}`)), ...REPO_FILES];
  for (const rel of expected) {
    if (!existsSync(join(root, rel))) {
      report.problem({ file: rel, rule: 'kit-file-missing', message: 'canvas kit file is missing', fix: "Copy it verbatim from this skill's templates (the path its first line names) and run its tests." });
      continue;
    }
    checkImports(ctx, rel);
  }
}

function checkJestGolden(ctx) {
  const { root, report } = ctx;
  const config = JEST_CONFIGS.map((rel) => read(root, rel)).find((text) => text !== null) ?? null;
  if (config === null || !config.includes('@shopify/react-native-skia/jestEnv.js') || !/golden/.test(config)) {
    report.problem({ file: 'jest.config.js', rule: 'jest-golden-project', message: 'no Jest golden project on the Skia CanvasKit environment', fix: "Add a 'golden' project: testEnvironment '@shopify/react-native-skia/jestEnv.js', setupFilesAfterEnv ['@shopify/react-native-skia/jestSetup.js'], testMatch *.golden.test.ts (unit-and-component-tests owns jest.config.js)." });
  }
}

const PLUGIN_EXTENSIONS = ['', '.ts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'];
const isFile = (path) => existsSync(path) && statSync(path).isFile();

/** Local files an Expo config references (`plugins: ['./config/with-promotion']`, `import withX from './x'`). */
function referencedPlugins(root, configRel) {
  const code = readCode(root, configRel) ?? '';
  const dir = posix.dirname(configRel);
  const found = [];
  for (const match of code.matchAll(/['"](\.\.?\/[^'"]+)['"]/g)) {
    const base = posix.normalize(posix.join(dir, match[1]));
    if (base.startsWith('..')) continue;
    const rel = PLUGIN_EXTENSIONS.map((ext) => `${base}${ext}`).find((candidate) => isFile(join(root, candidate)));
    if (rel !== undefined && /\.[cm]?[jt]s$/.test(rel)) found.push(rel);
  }
  return found;
}

/** The Expo configs and config plugins of the app (and of each workspace that is an app). */
function expoConfigFiles(root, scope) {
  const bases = ['', ...scope.layout.workspaces.map((ws) => ws.dir)];
  return bases.flatMap((base) => {
    const prefix = base === '' ? '' : `${base}/`;
    const configs = EXPO_CONFIGS.map((name) => `${prefix}${name}`).filter((rel) => existsSync(join(root, rel)));
    const plugins = existsSync(join(root, `${prefix}plugins`)) ? walk(join(root, `${prefix}plugins`), { include: ['*.ts', '*.js', '*.mjs', '*.cjs'] }).map((rel) => `${prefix}plugins/${rel}`) : [];
    return [...new Set([...configs, ...configs.flatMap((rel) => referencedPlugins(root, rel)), ...plugins])];
  });
}

const KEY_120HZ = 'CADisableMinimumFrameDurationOnPhone';
/** `CADisable…: false` (an infoPlist object), `.CADisable… = false` or `['CADisable…'] = false` (a withInfoPlist mod). */
const SETS_120HZ_FALSE = /CADisableMinimumFrameDurationOnPhone['"]?\s*\]?\s*[:=]\s*false\b/;
/** `delete next.modResults.CADisable…` or `delete plist['CADisable…']`. */
const DELETES_120HZ = /\bdelete\s+[\w$.]*(?:\.CADisableMinimumFrameDurationOnPhone\b|\[\s*['"]CADisableMinimumFrameDurationOnPhone['"]\s*\])/;

/** The app target's Info.plist of a native ios/ folder: ios/<Name>/Info.plist beside ios/<Name>.xcodeproj. */
function appInfoPlists(root, scope) {
  const bases = ['', ...scope.layout.workspaces.map((ws) => ws.dir)];
  return bases.flatMap((base) => {
    const ios = base === '' ? 'ios' : `${base}/ios`;
    return list(root, ios)
      .filter((name) => name.endsWith('.xcodeproj'))
      .map((name) => `${ios}/${name.replace(/\.xcodeproj$/, '')}/Info.plist`)
      .filter((rel) => isFile(join(root, rel)));
  });
}

/**
 * iOS caps an app at 60 fps on ProMotion iPhones unless Info.plist has
 * CADisableMinimumFrameDurationOnPhone = true. Expo's prebuild template already sets it (verified on
 * 2026-10-03: expo-template-bare-minimum 57.0.28's Info.plist and @expo/config-plugins 57.0.9's
 * default Info.plist both hold it), so a Continuous Native Generation app needs no key; the bug is an
 * override that turns it off, or committed native folders whose Info.plist lacks it.
 */
function check120Hz(ctx) {
  const { root, scope, report } = ctx;
  for (const rel of expoConfigFiles(root, scope)) {
    const code = readCode(root, rel) ?? '';
    const match = SETS_120HZ_FALSE.exec(code) ?? DELETES_120HZ.exec(code);
    if (match === null) continue;
    report.problem({ file: rel, line: lineOf(code, match.index), rule: 'plist-120hz', message: `turns ${KEY_120HZ} off (iOS then caps the app at 60 fps on ProMotion iPhones; Expo's prebuild template sets it true)`, fix: `Remove the override (or set it to true): Continuous Native Generation keeps the template's ${KEY_120HZ} = true. Android needs no key.` });
  }
  for (const rel of appInfoPlists(root, scope)) {
    const value = readPlist(join(root, rel))?.[KEY_120HZ];
    if (value === true) continue;
    const what = value === undefined ? `has no ${KEY_120HZ} key` : `sets ${KEY_120HZ} to ${JSON.stringify(value)}, not true`;
    report.problem({ file: rel, line: 1, rule: 'plist-120hz', message: `${what} (iOS caps the app at 60 fps on ProMotion iPhones)`, fix: `Add <key>${KEY_120HZ}</key><true/> to ${rel} (committed native folders are not regenerated), or regenerate it with npx expo prebuild --platform ios --clean when ios/ is generated and git-ignored.` });
  }
}

/**
 * The layout probe renders debug text over the canvas in end-to-end builds. Its frame clips and its
 * text box spans the frame from start to end, so the text wraps inside the canvas rectangle: a
 * screenshot comparison that masks the canvas (design-visual-parity) then also masks the probe.
 */
function checkProbeContained(ctx) {
  const { root, scope, report } = ctx;
  for (const kit of scope.kitDirs) {
    const rel = `${kit}/canvas-layout-probe.tsx`;
    const code = readCode(root, rel);
    if (code === null) continue;
    const frame = /\bframe\s*:\s*\{([^}]*)\}/.exec(code)?.[1] ?? '';
    const probe = /\bprobe\s*:\s*\{([^}]*)\}/.exec(code)?.[1] ?? '';
    const missing = [
      [/overflow\s*:\s*['"]hidden['"]/.test(frame), "the frame style has no overflow: 'hidden'"],
      [/position\s*:\s*['"]absolute['"]/.test(probe) && /insetInlineStart\s*:\s*0\b/.test(probe) && /insetInlineEnd\s*:\s*0\b/.test(probe), 'the probe style does not span the frame (absolute, insetInlineStart: 0, insetInlineEnd: 0)'],
    ].filter(([isMet]) => !isMet).map(([, what]) => what);
    if (missing.length > 0) report.problem({ file: rel, line: lineOf(code, Math.max(0, code.indexOf('StyleSheet.create'))), rule: 'probe-contained', message: `the layout probe's text can spill outside the canvas frame: ${missing.join('; ')}`, fix: "Copy templates/src/canvas/canvas-layout-probe.tsx and its test again: frame { flex: 1, overflow: 'hidden' }, probe { position: 'absolute', insetBlockStart: 0, insetInlineStart: 0, insetInlineEnd: 0 }. A screenshot mask covers only the canvas frame." });
  }
}

/** Checks canvas-palettes.json; returns its data when every set is complete and valid (contrast can be measured), else null. */
function checkPalettes(ctx, surface) {
  const { root, scope, report } = ctx;
  const rel = `${surface.dir}/canvas-palettes.json`;
  const text = read(root, rel);
  if (text === null) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'palette-sets', message: `not valid JSON: ${error.message}`, fix: 'Fix the JSON.' });
    return null;
  }
  const sets = scope.contract.paletteSets;
  const keysOf = (set) => Object.keys(data?.[set] ?? {}).sort().join(',');
  const reference = keysOf('light');
  for (const set of sets) {
    if (typeof data?.[set] !== 'object' || data[set] === null || Object.keys(data[set]).length === 0) {
      report.problem({ file: rel, line: 1, rule: 'palette-sets', message: `palette set "${set}" is missing or empty`, fix: `Add "${set}" with the same semantic tokens as "light".` });
      continue;
    }
    if (keysOf(set) !== reference) report.problem({ file: rel, line: 1, rule: 'palette-sets', message: `"${set}" tokens (${keysOf(set)}) differ from "light" (${reference})`, fix: 'Give every set exactly the same token names.' });
    for (const [token, value] of Object.entries(data[set])) {
      if (typeof value !== 'string' || !HEX.test(value)) report.problem({ file: rel, line: lineOf(text, text.indexOf(`"${token}"`, text.indexOf(`"${set}"`))), rule: 'palette-sets', message: `"${set}.${token}" is ${JSON.stringify(value)}, not #RRGGBB or #RRGGBBAA`, fix: 'Write the colour as a hex string, for example "#2f5fd0" or "#2f5fd080".' });
    }
  }
  const extra = Object.keys(data ?? {}).filter((key) => !sets.includes(key));
  if (extra.length > 0) report.problem({ file: rel, line: 1, rule: 'palette-sets', message: `palette sets not declared in ${scope.contract.file}: ${extra.join(', ')}`, fix: `Use exactly ${sets.join(', ')}, or list the extra sets in "paletteSets" of ${scope.contract.file} (an opt-in colour-blind or high-contrast setting).` });
  const isValid = sets.every((set) => typeof data?.[set] === 'object' && data[set] !== null && keysOf(set) === reference && Object.values(data[set]).every((value) => typeof value === 'string' && HEX.test(value)));
  return isValid && reference !== '' ? data : null;
}

/** The canvas-contrast.json list each failing rule reads its pairs from. */
const PAIR_KEY_OF = { 'text-contrast': 'text', 'non-text-contrast': 'graphics', 'shape-contrast': 'shapes', 'cvd-separation': 'distinct' };
const CONTRAST_FIX = {
  'contrast-file': "Fix canvas-contrast.json: format 1 keys only (base, edge, text, graphics, shapes, distinct, distinctSets, $comment), pairs of tokens canvas-palettes.json has (references/drawing.md, Contrast pairs).",
  'text-contrast': 'Move the lightness of one of the two tokens in canvas-palettes.json (keep the hue; take the value from the design tokens) until the pair reaches the ratio; never drop the pair or draw text on an undeclared ground.',
  'non-text-contrast': 'Raise the icon, mark or ring token to 3:1 against its ground in canvas-palettes.json.',
  'shape-contrast': 'Darken or lighten the fill, or outline it with an edge token that stands 3:1 off it (draw() strokes the edge).',
  'cvd-separation': 'Pick these tokens from a colour-blind-safe family (Okabe-Ito) or move them apart in lightness, and give each kind a shape, mark or label as well.',
};

/**
 * Measures the surface's declared pairs (canvas-contrast.json) in every palette set. The pairs are the
 * proof that the canvas is readable: a missing file is surface-file-missing, a broken one contrast-file,
 * and each failing pair names its set, tokens, ratio and threshold.
 */
function checkContrast(ctx, surface, palettes) {
  const { root, scope, report } = ctx;
  const rel = `${surface.dir}/canvas-contrast.json`;
  const text = read(root, rel);
  if (text === null || palettes === null) return;
  const lineAt = (needle) => (needle === null || text.indexOf(needle) === -1 ? 1 : lineOf(text, text.indexOf(needle)));
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'contrast-file', message: `not valid JSON: ${error.message}`, fix: CONTRAST_FIX['contrast-file'] });
    return;
  }
  const sets = scope.contract.paletteSets;
  const structural = contrastFileProblems(data, Object.keys(palettes.light ?? palettes[sets[0]] ?? {}), sets);
  for (const problem of structural) report.problem({ file: rel, line: lineAt(problem.needle), rule: 'contrast-file', message: problem.message, fix: CONTRAST_FIX['contrast-file'] });
  if (structural.length > 0) return;
  const thresholds = contrastThresholds(read(root, 'quality-gates.json'));
  for (const failure of contrastFailures(data, palettes, sets, thresholds)) {
    // The pair's own line: its tokens written out, searched after the list key that holds it.
    const from = Math.max(0, text.indexOf(`"${PAIR_KEY_OF[failure.rule] ?? 'base'}"`));
    const at = text.indexOf(failure.pair.map((name) => `"${name}"`).join(', '), from);
    report.problem({ file: rel, line: at === -1 ? lineAt(`"${failure.pair[0]}"`) : lineOf(text, at), rule: failure.rule, message: failure.message, fix: CONTRAST_FIX[failure.rule] });
  }
}

/** The contrast contract accessibility-as-code owns: rn-skills.config.json "contrastContract", else <contractsDir>/contrast.json. */
function contrastContractPath(scope) {
  const configured = scope.layout.config?.contrastContract;
  return typeof configured === 'string' && configured.trim() !== '' ? configured.replace(/^\.\//, '') : `${scope.layout.contractsDir}/contrast.json`;
}

/**
 * A surface's pairs live once, in its canvas-contrast.json (which accessibility-as-code's check-contrast
 * measures too). A palette entry in the contrast contract that names the surface's palettes is a second
 * pair table for the same colours: one of the two goes stale. The contract itself belongs to
 * accessibility-as-code, so a missing or unreadable one is that skill's concern, not a problem here.
 */
function checkDeclaredOnce(ctx, surfaces) {
  const { root, scope, report } = ctx;
  const rel = contrastContractPath(scope);
  const text = read(root, rel);
  if (text === null) return;
  let palettes;
  try {
    palettes = JSON.parse(text)?.palettes;
  } catch {
    return;
  }
  if (!Array.isArray(palettes)) return;
  for (const entry of palettes) {
    const file = typeof entry?.file === 'string' ? posix.normalize(entry.file.replace(/\\/g, '/')).replace(/^\.\//, '') : null;
    const surface = file === null ? undefined : surfaces.find((candidate) => file === `${candidate.dir}/canvas-palettes.json` || file === `${candidate.dir}/canvas-palettes.ts`);
    if (surface === undefined) continue;
    const at = text.indexOf(JSON.stringify(entry.file));
    report.problem({ file: rel, line: at === -1 ? 1 : lineOf(text, at), rule: 'contrast-declared-once', message: `palette entry ${JSON.stringify(entry.name ?? file)} declares ${file}, the palettes of canvas surface ${surface.id}, whose pairs live in ${surface.dir}/canvas-contrast.json: two pair tables for one palette drift`, fix: `Remove this entry from ${rel} and keep the pairs in canvas-contrast.json only (accessibility-as-code's check-contrast measures that file too; if it reports canvas-palettes.json as an undeclared colour table, update that skill: references/drawing.md, Contrast pairs).` });
  }
}

function requireFiles(ctx, surface, names) {
  const files = list(ctx.root, surface.dir);
  // No surface folder yet: every file is listed, so the output is the copy list.
  for (const [label, test] of names) {
    if (!files.some((name) => test.test(name))) ctx.report.problem({ file: `${surface.dir}/${label}`, rule: 'surface-file-missing', message: `surface file ${label} is missing`, fix: "Copy it from this skill's templates/src/features/__FEATURE__/canvas, fill the placeholders, and make its tests pass." });
  }
}

function checkTests(ctx, surface) {
  const { root, report } = ctx;
  const timelineRel = `${surface.dir}/build-timeline.test.ts`;
  const timelineTest = readCode(root, timelineRel);
  const buildsReduced = timelineTest !== null && /\bbuildTimeline\s*\(/.test(timelineTest) && /['"`]reduced['"`]/.test(timelineTest);
  if (timelineTest !== null && !buildsReduced) report.problem({ file: timelineRel, line: 1, rule: 'timeline-reduced', message: 'the timeline test never builds the reduced-motion timeline', fix: "Assert that buildTimeline(events, 'reduced') has no burst tracks, no out-back easing and is shorter." });
  const drawTest = list(root, surface.dir).find((name) => /^draw[^/]*\.test\.ts$/.test(name));
  if (drawTest === undefined) return;
  const rel = `${surface.dir}/${drawTest}`;
  const text = readCode(root, rel) ?? '';
  // Prettier (printWidth 100, trailingComma "all") wraps a long assertion as toBeLessThanOrEqual(\n  BUDGET,\n).
  const budgets = [...text.matchAll(/toBeLessThanOrEqual\(\s*(\d[\d_]*)\s*,?\s*\)|\b[A-Z][A-Z0-9_]*BUDGET[A-Z0-9_]*\s*(?::\s*number\s*)?=\s*(\d[\d_]*)\b/g)].map((m) => ({ value: Number((m[1] ?? m[2]).replace(/_/g, '')), line: lineOf(text, m.index) }));
  // The budget must be asserted: toBeLessThanOrEqual(<number>) or toBeLessThanOrEqual(<...BUDGET...>); a bound on a
  // coordinate (toBeLessThanOrEqual(width)) or a declared but unused constant proves nothing.
  const hasBudget = /toBeLessThanOrEqual\(\s*(\d[\d_]*|[A-Z][A-Z0-9_]*BUDGET[A-Z0-9_]*)\s*,?\s*\)/.test(text);
  if (!hasBudget) report.problem({ file: rel, line: 1, rule: 'draw-budget', message: 'the draw test asserts no draw-call budget', fix: "Count canvas calls with a recording canvas on the busiest frame and assert total <= the surface's budget (<= 1000)." });
  for (const budget of budgets.filter((entry) => entry.value > MAX_DRAW_CALLS)) report.problem({ file: rel, line: budget.line, rule: 'draw-budget', message: `draw-call budget ${budget.value} is above the cap of ${MAX_DRAW_CALLS}`, fix: 'Reduce draw calls (an atlas for many sprites, fewer layers); raising a budget needs an on-device frame report.' });
  if (!/drawText/.test(text)) report.problem({ file: rel, line: 1, rule: 'draw-budget', message: 'the draw test does not record drawText, so a missing localised label goes unnoticed', fix: 'Record drawText strings in the recording canvas and assert the localised labels.' });
}

function checkSurfaceObject(ctx, surface) {
  const rel = `${surface.dir}/${surface.id}-surface.ts`;
  const text = readCode(ctx.root, rel);
  if (text === null) return;
  for (const member of ['isMirroredInRtl', 'toView', 'layout', 'draw', 'buildPaths', 'describe']) {
    if (!new RegExp(`\\b${member}\\b\\s*[:,(]|^\\s*${member},?\\s*$`, 'm').test(text)) ctx.report.problem({ file: rel, line: 1, rule: 'surface-object', message: `the CanvasSurface object has no ${member}`, fix: `Add ${member} to the exported CanvasSurface object.` });
  }
}

function checkGolden(ctx, surface) {
  const { root, report, goldensDir } = ctx;
  const rel = `${goldensDir}/${surface.id}.golden.test.ts`;
  const text = readCode(root, rel);
  if (text === null) {
    report.problem({ file: rel, rule: 'golden-test', message: 'the surface has no pixel golden test', fix: "Copy templates/test/goldens/canvas/__SURFACE__.golden.test.ts, fill it in, run 'npx jest <file> --selectProjects golden -u', and open every PNG." });
    return;
  }
  const sizes = (/SIZES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(text)?.[1].match(/\bwidth\s*:/g) ?? []).length;
  const moments = /MOMENTS\s*=\s*\[([^\]]*)\]/.exec(text)?.[1].split(',').map((v) => Number(v.trim())) ?? [];
  if (!/paintSurfacePng\s*\(/.test(text) || !/toMatchImageSnapshot\s*\(/.test(text)) report.problem({ file: rel, line: 1, rule: 'golden-test', message: 'the golden does not render through paintSurfacePng and toMatchImageSnapshot', fix: 'Render with paintSurfacePng(Skia, ...) (the device draw()) and assert toMatchImageSnapshot with the skia-golden matcher.' });
  if (sizes < 3) report.problem({ file: rel, line: 1, rule: 'golden-test', message: `the golden renders ${sizes} canvas size(s); 3 are required`, fix: 'Render phone-portrait 390x560, tablet-landscape 1024x700 and small 320x400.' });
  if (![0, 0.5, 1].every((m) => moments.includes(m))) report.problem({ file: rel, line: 1, rule: 'golden-test', message: 'the golden does not render the moments 0, 0.5 and 1 of the timeline', fix: 'Use const MOMENTS = [0, 0.5, 1] as const.' });
  const pngs = list(root, `${goldensDir}/__image_snapshots__`).filter((name) => name.startsWith(`${surface.id}-`) && name.endsWith('.png'));
  if (pngs.length < MIN_BASELINES) report.problem({ file: `${goldensDir}/__image_snapshots__/${surface.id}-*.png`, rule: 'golden-baselines', message: `${pngs.length} baseline PNG(s) for ${surface.id}; ${MIN_BASELINES} (3 sizes x 3 moments) are required`, fix: `Run npx jest ${rel} --selectProjects golden -u, open every PNG, and commit them on purpose.` });
}

const TIMELINE_FILES = (id) => [
  ['canvas-palettes.json', /^canvas-palettes\.json$/], ['canvas-palettes.ts', /^canvas-palettes\.ts$/], ['canvas-contrast.json', /^canvas-contrast\.json$/],
  ['to-view.ts', /^to-view\.ts$/], ['build-timeline.ts', /^build-timeline\.ts$/], ['build-timeline.test.ts', /^build-timeline\.test\.ts$/],
  ['layout-*.ts', /^layout[^.]*\.ts$/], ['layout-*.test.ts', /^layout[^.]*\.test\.ts$/], ['draw-*.ts', /^draw[^.]*\.ts$/], ['draw-*.test.ts', /^draw[^.]*\.test\.ts$/],
  [`${id}-surface.ts`, new RegExp(`^${id}-surface\\.ts$`)],
];
const LIVE_FILES = [['canvas-palettes.json', /^canvas-palettes\.json$/], ['canvas-palettes.ts', /^canvas-palettes\.ts$/], ['canvas-contrast.json', /^canvas-contrast\.json$/], ['draw-*.ts', /^draw[^.]*\.ts$/]];

function checkSurface(ctx, surface) {
  requireFiles(ctx, surface, surface.kind === 'live' ? LIVE_FILES : TIMELINE_FILES(surface.id));
  checkContrast(ctx, surface, checkPalettes(ctx, surface));
  if (surface.kind === 'live') return;
  checkTests(ctx, surface);
  checkSurfaceObject(ctx, surface);
  checkGolden(ctx, surface);
}

/** Contract surfaces first; then every surface folder on disk not declared there (<id>-surface.ts names it). */
function discoverSurfaces(root, scope) {
  const declared = scope.contract.surfaces;
  const found = surfaceFolders(root, scope)
    .filter((dir) => !declared.some((surface) => surface.dir === dir))
    .map((dir) => {
      const object = list(root, dir).find((name) => /^[a-z0-9-]+-surface\.ts$/.test(name));
      const id = object === undefined ? dir.split('/').at(-2) : object.replace(/-surface\.ts$/, '');
      const kind = existsSync(join(root, dir, '..', 'sim')) ? 'live' : 'timeline';
      return { id, dir, kind, declared: false };
    });
  return [...declared, ...found];
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app repo root');
  const report = createReporter({ name: 'check-canvas-files', json: options.json });
  const scope = canvasScope(root, { kitDir: options['kit-dir'], surfaceDirs: options['surface-dir'], goldensDir: options['goldens-dir'] });
  if (!scope.hasSkia) return report.notApplicable(`${SKIA_PACKAGE} is not in package.json (the app draws no Skia canvas)`);
  const all = discoverSurfaces(root, scope);
  for (const id of options.surface) if (!all.some((surface) => surface.id === id)) fail(`no canvas surface with id ${id}`, `Pass one of: ${all.map((surface) => surface.id).join(', ') || '(none found)'}; declare it in ${scope.contract.file} or add <id>-surface.ts to its folder.`);
  const surfaces = options.surface.length > 0 ? all.filter((surface) => options.surface.includes(surface.id)) : all;
  const hasKit = scope.kitDirs.some((dir) => existsSync(join(root, dir)));
  if (surfaces.length === 0 && !hasKit) fail(`nothing to check: no canvas kit in ${scope.kitDirs.join(', ')} and no canvas surface`, `Declare the first surface in ${scope.contract.file} (this skill's templates/contracts has the template) and rerun: the checker then lists every file to copy. Or pass --kit-dir / --surface-dir for another layout.`);
  const ctx = { root, scope, report, goldensDir: scope.goldensDir };
  // A missing kit or surface folder is not "nothing to check": every expected file is reported, so
  // the list of files to copy comes from this checker (exit 1).
  checkKit(ctx);
  checkProbeContained(ctx);
  checkJestGolden(ctx);
  check120Hz(ctx);
  for (const surface of surfaces) checkSurface(ctx, surface);
  checkDeclaredOnce(ctx, surfaces);
  return report.finish({ checked: surfaces.length + 1, unit: `items (kit + ${surfaces.length} surface${surfaces.length === 1 ? '' : 's'})` });
});
