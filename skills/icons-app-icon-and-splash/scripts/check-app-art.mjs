#!/usr/bin/env node
// check-app-art.mjs: proves the app icon, splash and store images that scripts/art/render-app-art.ts drew
// from the brand mark meet the platform rules: iOS light (opaque, full bleed), dark (transparent) and
// tinted (opaque grayscale) appearances inside the central safe area; Android adaptive foreground and
// themed monochrome inside the 66 dp safe circle on an opaque background layer; splash images on
// transparency inside Android 12's icon circle; the Play icon and feature graphic opaque and to size;
// the app config naming every image; and the brand mark itself well formed.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-app-art.mjs [app-root] [options]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

import { createReporter, lineOf, maskComments, notYetCreated, parseArgs, readPng, requireDir, resolveLayout, run, toPosix } from './check-lib.mjs';
import { forEachExpoApp } from './lib/expo-apps.mjs';
import { readArtContract } from './lib/art-contract.mjs';
import { enableAppImports, errorText } from './lib/app-modules.mjs';
import { pathBounds } from './lib/svg-path.mjs';

const SPEC = {
  name: 'check-app-art',
  summary: 'Checks the code-drawn app icon (iOS appearances, Android adaptive and themed layers), splash images, Play store art, their wiring in the app config, and the brand mark they are drawn from.',
  usage: '[app-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The art contract (default: <contractsDir>/app-art.json)' },
    'brand-mark': { type: 'string', value: 'file', help: 'The brand mark module (default: <uiDir>/icons/brand-mark.ts)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  art-missing             an image of contracts/app-art.json outputs is missing (and not listed in "optional";',
    '                          an optional image is made by hand: never rendered, required or checked for wiring)',
    '  art-format              not a readable PNG, or the wrong size: 1024 x 1024 (icons, layers, splash), 512 x 512',
    '                          and at most 1024 KB (Play icon), 1024 x 500 (feature graphic)',
    '  art-light-opaque        the iOS light icon has transparent pixels (Expo would flatten them onto white)',
    '  art-dark-clear          the iOS dark icon has no transparent background',
    '  art-tinted-gray         the iOS tinted icon is not opaque grayscale',
    '  art-safe-area           the mark leaves its safe area: the central glyphArea (+2 %) of an iOS icon, the 66 dp',
    '                          circle of a 108 dp Android layer, the Android 12 icon circle of a splash image (radius',
    '                          96 / imageWidth of the image, at most 0.5; 1/3 when no imageWidth is found); or the',
    '                          image is empty',
    '  art-android-foreground  the adaptive foreground has no transparent background (the launcher mask cuts it)',
    '  art-android-background  the adaptive background layer is not opaque',
    '  art-android-monochrome  the themed (monochrome) layer has no transparent background',
    '  art-splash-clear        a splash image has no transparent background (the splash plugin paints the ground)',
    '  art-store-opaque        the Play icon or feature graphic has transparent pixels',
    '  art-unwired             the app config never names an icon or splash image by its contract path (or its folder',
    '                          plus file name), production ios.icon is not iosAppearanceIcon(), or expo-splash-screen',
    '                          is not a dependency. Textual: npx expo config --type public is the real proof',
    '  art-splash-width        the splash imageWidth (SPLASH_IMAGE_WIDTH in scripts/art/app-art-config.ts, or an',
    '                          imageWidth literal in the app config) is over 288: Android draws the image on a 288 dp icon',
    '  brand-mark-missing      the brand mark module the renderer draws from does not exist',
    '  brand-mark-shape        BRAND_MARK has no layers or more than 8, a layer with neither fill nor stroke, a colour',
    '                          that is not a theme role (ColorTokens), bad path data, or a layer (with half its stroke',
    '                          width) outside 2..46: 2 units clear at the edges of the 48 grid',
    '',
    'NOT APPLICABLE when the app does not render its art in code: no scripts/art/render-app-art.ts, and',
    'contracts/app-art.json is absent or holds only check-icons\' allow-lists ("icons"; no outputs, optional',
    'or glyphArea). SKIP: brand-mark-shape colour roles while src/theme/theme-types.ts is not yet created',
    '(design-system-structure creates it). Whether the PNGs are current is render-app-art.ts --check (it',
    're-renders). Hand-made art is not checked here (references/app-icon-and-splash.md, "Hand-made art").',
    'In a workspace repo each Expo app workspace (apps/mobile) is checked from the repo root. Regenerate with: node scripts/art/render-app-art.ts',
  ].join('\n'),
};

const ICON_PX = 1024;
const PLAY_PX = 512;
const PLAY_MAX_BYTES = 1024 * 1024;
const FEATURE = { width: 1024, height: 500 };
/** Android adaptive icons: a 108 dp layer whose 66 dp centre circle survives every launcher mask. */
const ANDROID_SAFE_RADIUS = 33 / 108;
/**
 * Android 12+ splash (expo-splash-screen 57.0.9, withAndroidSplashImages.js): the image is resized to
 * imageWidth dp and centred on a transparent 288 dp canvas, that canvas is windowSplashScreenAnimatedIcon,
 * and Android masks the icon to a 192 dp circle. The safe radius in image units is 96 / imageWidth
 * (0.48 at the shipped 200); 1/3 is the bound for every imageWidth up to the 288 dp canvas.
 */
const SPLASH_SAFE_RADIUS = 1 / 3;
/** The radius of the Android 12+ splash icon mask (a 192 dp circle on the 288 dp icon). */
const SPLASH_MASK_RADIUS_DP = 96;
/** The Android 12+ splash icon canvas (dp); a wider splash image overflows it. */
const SPLASH_CANVAS_DP = 288;
/** Slack for anti-aliasing at the edge of a circle or box. */
const EDGE_SLACK = 0.02;
/** Colour distance (0-255, max channel) that counts as "not background". */
const INK_DELTA = 24;
const RENDERER = 'scripts/art/render-app-art.ts';
const REGENERATE = `Run: node ${RENDERER}, look at the PNGs at 1024 and 256 px, commit them.`;
const GRID = 48;
/** Units the mark keeps clear at each edge of its grid, and the anti-aliasing slack on that bound. */
const MARK_MARGIN = 2;
const MARK_SLACK = 0.25;
const MARK_MAX_LAYERS = 8;
const MARK_STROKE_WIDTH = 2.6;

const pixel = (img, x, y) => {
  const at = (y * img.width + x) * 4;
  return [img.data[at], img.data[at + 1], img.data[at + 2], img.data[at + 3]];
};

function isOpaque(img) {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return false;
  return true;
}

function isGray(img) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i] - img.data[i + 1]) > 1 || Math.abs(img.data[i + 1] - img.data[i + 2]) > 1) return false;
  }
  return true;
}

function cornersClear(img) {
  const last = img.width - 1;
  return [[0, 0], [last, 0], [0, last], [last, last]].every(([x, y]) => pixel(img, x, y)[3] === 0);
}

const byAlpha = (p) => p[3] > 0;
function differsFrom(background) {
  return (p) => Math.max(Math.abs(p[0] - background[0]), Math.abs(p[1] - background[1]), Math.abs(p[2] - background[2])) > INK_DELTA;
}

/** Content box and the content pixel farthest from the centre (as a share of the width). */
function contentExtent(img, isContent) {
  let box = null;
  let reach = 0;
  const c = (img.width - 1) / 2;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!isContent(pixel(img, x, y))) continue;
      box = box ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
      reach = Math.max(reach, Math.hypot(x - c, y - c));
    }
  }
  return box ? { box, reach: reach / img.width } : null;
}

function safeBox(report, { file, img, isContent, area }) {
  const extent = contentExtent(img, isContent);
  if (!extent) return report.problem({ file, rule: 'art-safe-area', message: 'the image is empty (no mark)', fix: REGENERATE });
  const lo = Math.floor((img.width * (1 - area - EDGE_SLACK)) / 2);
  const hi = img.width - 1 - lo;
  const { box } = extent;
  if (box.minX < lo || box.minY < lo || box.maxX > hi || box.maxY > hi) {
    report.problem({ file, rule: 'art-safe-area', message: `the mark spans ${box.minX},${box.minY} to ${box.maxX},${box.maxY}; the safe area is ${lo}..${hi}`, fix: `Keep the mark inside the central ${Math.round(area * 100)} % (contracts/app-art.json glyphArea), then regenerate.` });
  }
}

function safeCircle(report, { file, img, isContent, radius, what }) {
  const extent = contentExtent(img, isContent);
  if (!extent) return report.problem({ file, rule: 'art-safe-area', message: 'the image is empty (no mark)', fix: REGENERATE });
  if (extent.reach > radius + EDGE_SLACK / 2) {
    report.problem({ file, rule: 'art-safe-area', message: `the mark reaches ${(extent.reach * 100).toFixed(1)} % of the width from the centre; ${what} keeps ${(radius * 100).toFixed(1)} %`, fix: `Draw the mark smaller in ${RENDERER} (it is cut off on round launcher masks), then regenerate.` });
  }
}

/** The checks of one image by its role. */
const ROLES = {
  light: { size: [ICON_PX, ICON_PX], check(report, file, img, contract) {
    if (!isOpaque(img)) report.problem({ file, rule: 'art-light-opaque', message: 'the light icon has transparent pixels', fix: 'Paint the full-bleed tile colour first; iOS masks the corners itself.' });
    safeBox(report, { file, img, isContent: differsFrom(pixel(img, 0, 0)), area: contract.glyphArea });
  } },
  dark: { size: [ICON_PX, ICON_PX], check(report, file, img, contract) {
    if (!cornersClear(img)) report.problem({ file, rule: 'art-dark-clear', message: 'the dark icon has no transparent background', fix: 'Leave the background transparent; iOS draws the dark backdrop.' });
    safeBox(report, { file, img, isContent: byAlpha, area: contract.glyphArea });
  } },
  tinted: { size: [ICON_PX, ICON_PX], check(report, file, img, contract) {
    if (!isGray(img) || !isOpaque(img)) report.problem({ file, rule: 'art-tinted-gray', message: 'the tinted icon must be opaque grayscale', fix: 'Render it through the Rec. 709 luma colour filter over the dark ground (render-app-art.ts GRAYSCALE).' });
    safeBox(report, { file, img, isContent: differsFrom(pixel(img, 0, 0)), area: contract.glyphArea });
  } },
  androidForeground: { size: [ICON_PX, ICON_PX], check(report, file, img) {
    if (!cornersClear(img)) report.problem({ file, rule: 'art-android-foreground', message: 'the adaptive foreground has no transparent background', fix: 'Draw only the mark on transparency; the background layer carries the colour.' });
    safeCircle(report, { file, img, isContent: byAlpha, radius: ANDROID_SAFE_RADIUS, what: 'the 66 dp safe circle of a 108 dp layer' });
  } },
  androidBackground: { size: [ICON_PX, ICON_PX], check(report, file, img) {
    if (!isOpaque(img)) report.problem({ file, rule: 'art-android-background', message: 'the adaptive background layer has transparent pixels', fix: 'Fill the whole layer with the tile colour (launchers show transparency as black or white).' });
  } },
  androidMonochrome: { size: [ICON_PX, ICON_PX], check(report, file, img) {
    if (!cornersClear(img)) report.problem({ file, rule: 'art-android-monochrome', message: 'the themed icon layer has no transparent background', fix: 'Draw the white silhouette on transparency: Android 13+ reads only its alpha.' });
    safeCircle(report, { file, img, isContent: byAlpha, radius: ANDROID_SAFE_RADIUS, what: 'the 66 dp safe circle of a 108 dp layer' });
  } },
  splash: { size: [ICON_PX, ICON_PX], check: splashCheck },
  splashDark: { size: [ICON_PX, ICON_PX], check: splashCheck },
  playIcon: { size: [PLAY_PX, PLAY_PX], maxBytes: PLAY_MAX_BYTES, check(report, file, img, contract) {
    if (!isOpaque(img)) report.problem({ file, rule: 'art-store-opaque', message: 'the Play icon has transparent pixels (Play shows its own UI colour through them)', fix: 'Paint the full square; Google Play rounds the corners (30 %) and adds the shadow itself.' });
    safeBox(report, { file, img, isContent: differsFrom(pixel(img, 0, 0)), area: contract.glyphArea });
  } },
  featureGraphic: { size: [FEATURE.width, FEATURE.height], check(report, file, img) {
    if (!isOpaque(img)) report.problem({ file, rule: 'art-store-opaque', message: 'the feature graphic has transparent pixels', fix: 'Export it without alpha (a 24-bit PNG or a JPEG).' });
  } },
};

function splashCheck(report, file, img, contract, context) {
  if (!cornersClear(img)) report.problem({ file, rule: 'art-splash-clear', message: 'the splash image has no transparent background', fix: 'The splash plugin paints the ground colour; the image holds only the mark on transparency.' });
  const width = context.splashWidth;
  const what = width === null
    ? 'the Android 12+ splash icon circle (192 of 288 dp; no imageWidth found, so the 1/3 bound that holds at any imageWidth up to 288)'
    : `the Android 12+ splash icon circle (192 of 288 dp: 96 / imageWidth ${width})`;
  safeCircle(report, { file, img, isContent: byAlpha, radius: splashSafeRadius(width), what });
}

/**
 * The share of the splash image's width the mark may reach from the centre: Android 12+ centres the
 * image at imageWidth dp on the 288 dp window icon and masks it to a 192 dp circle, so 96 / imageWidth
 * (0.48 at splashPlugin's 200), at most half the image; 1/3 when no imageWidth can be read.
 */
function splashSafeRadius(width) {
  return width === null || width <= 0 ? SPLASH_SAFE_RADIUS : Math.min(0.5, SPLASH_MASK_RADIUS_DP / width);
}

function checkImages(report, root, contract, context) {
  let checked = 0;
  for (const [role, spec] of Object.entries(ROLES)) {
    const file = contract.outputs[role];
    if (!existsSync(join(root, file))) {
      if (!contract.optional.includes(role)) report.problem({ file, rule: 'art-missing', message: `the ${role} image is missing`, fix: REGENERATE });
      continue;
    }
    checked += 1;
    let img;
    try {
      img = readPng(join(root, file));
    } catch (error) {
      report.problem({ file, rule: 'art-format', message: `not a readable PNG: ${error.message}`, fix: REGENERATE });
      continue;
    }
    const [width, height] = spec.size;
    if (img.width !== width || img.height !== height) {
      report.problem({ file, rule: 'art-format', message: `${img.width} x ${img.height}, must be ${width} x ${height}`, fix: REGENERATE });
      continue;
    }
    const bytes = statSync(join(root, file)).size;
    if (spec.maxBytes && bytes > spec.maxBytes) report.problem({ file, rule: 'art-format', message: `${Math.ceil(bytes / 1024)} KB, Google Play takes at most ${spec.maxBytes / 1024} KB`, fix: 'Simplify the mark or flatten gradients, then regenerate.' });
    spec.check(report, file, img, contract, context);
  }
  return checked;
}

const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.json'];
/** The images the app config must name, and the helper call that names them for it. */
const WIRING = [
  { roles: ['light'], helper: null, where: 'icon' },
  { roles: ['dark', 'tinted'], helper: 'iosAppearanceIcon', where: 'ios.icon' },
  { roles: ['androidForeground', 'androidBackground', 'androidMonochrome'], helper: null, where: 'android.adaptiveIcon' },
  { roles: ['splash', 'splashDark'], helper: 'splashPlugin', where: 'the expo-splash-screen plugin' },
];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A per-variant icon folder: assets/icons/<variant>/<file>.png. */
const VARIANT_FOLDER = /^assets\/icons\/[^/]+\/[^/]+$/;

/**
 * Whether the config text names `file` (a contract path): the path itself, or its folder (a const such
 * as ICONS = './assets/icons/production') with `${...}/<name>`, or for a per-variant icon folder any
 * `assets/icons/` folder expression with `${...}/<name>`. A bare file name (the Expo template's
 * ./assets/images/icon.png) does not count. Textual, so `npx expo config --type public` stays the proof.
 */
function namesFile(text, file) {
  if (text.includes(file)) return true;
  const interpolated = new RegExp(`\\}/${escapeRegExp(basename(file))}\\b`).test(text);
  if (!interpolated) return false;
  return text.includes(posix.dirname(file)) || (VARIANT_FOLDER.test(file) && text.includes('assets/icons/'));
}

/** The helper call that names the images for the config, used where it belongs (`icon: …helper(` for iOS). */
function usesHelper(text, helper) {
  const call = `\\b${helper}\\s*\\(`;
  return helper === 'iosAppearanceIcon' ? new RegExp(`\\bicon\\s*:[^,\\n]*${call}`).test(text) : new RegExp(call).test(text);
}

/** imageWidth values the splash is shown at: the helper's constant and any literal in the app config. */
function splashWidths(root, configFile, text) {
  const widths = [];
  const helperFile = 'scripts/art/app-art-config.ts';
  if (existsSync(join(root, helperFile))) {
    const source = maskComments(readFileSync(join(root, helperFile), 'utf8'));
    const match = /\bSPLASH_IMAGE_WIDTH\s*=\s*(\d+(?:\.\d+)?)/.exec(source);
    if (match) widths.push({ file: helperFile, line: lineOf(source, match.index), width: Number(match[1]) });
  }
  if (configFile && text.includes('expo-splash-screen')) {
    for (const match of text.matchAll(/["']?\bimageWidth["']?\s*:\s*(\d+(?:\.\d+)?)/g)) widths.push({ file: configFile, line: lineOf(text, match.index), width: Number(match[1]) });
  }
  return widths;
}

/** Checks the config names every rendered image; returns the widest splash imageWidth found, or null. */
function checkWiring(report, root, contract) {
  const configFile = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  let text = '';
  if (!configFile) {
    report.problem({ file: 'app.config.ts', rule: 'art-unwired', message: 'the app has no app config, so nothing shows the drawn icon or splash', fix: 'Create app.config.ts (app-variants-and-environment) and name the images there.' });
  } else {
    const raw = readFileSync(join(root, configFile), 'utf8');
    text = configFile.endsWith('.json') ? raw : maskComments(raw);
    for (const { roles, helper, where } of WIRING) {
      if (helper && usesHelper(text, helper)) continue;
      for (const role of roles) {
        const file = contract.outputs[role];
        // An optional image is made by hand or left out (an Icon Composer .icon folder holds the dark
        // and tinted art): the renderer never writes it, so the config need not name it.
        if (contract.optional.includes(role)) continue;
        const named = namesFile(text, file) && (role.startsWith('splash') ? text.includes('expo-splash-screen') : true);
        if (!named) report.problem({ file: configFile, line: 1, rule: 'art-unwired', message: `never names ${file} (${where})`, fix: helper ? `Use ${helper}(projectRoot) from scripts/art/app-art-config.ts${helper === 'iosAppearanceIcon' ? ' as the production ios.icon' : ''} (references/app-icon-and-splash.md, "Expo config and app variants"), then confirm with npx expo config --type public.` : `Point ${where} at ${file} (per variant: assets/icons/<variant>/${basename(file)}), then confirm with npx expo config --type public.` });
      }
    }
  }
  const widths = splashWidths(root, configFile, text);
  for (const { file, line, width } of widths) {
    if (width > SPLASH_CANVAS_DP) report.problem({ file, line, rule: 'art-splash-width', message: `the splash imageWidth is ${width}; Android 12+ draws the splash image on a ${SPLASH_CANVAS_DP} dp icon, so a wider image overflows it`, fix: `Keep imageWidth at most ${SPLASH_CANVAS_DP} (200 is the default of splashPlugin()); make the mark larger inside the image instead.` });
  }
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    // A missing or unreadable package.json is reported as a missing dependency below.
  }
  if (!pkg.dependencies?.['expo-splash-screen']) {
    report.problem({ file: 'package.json', line: 1, rule: 'art-unwired', message: 'expo-splash-screen is not a dependency, so the splash plugin entry stops npx expo config ("Failed to resolve plugin")', fix: 'Run: npx expo install expo-splash-screen (before the plugin entry lands).' });
  }
  return widths.length === 0 ? null : Math.max(...widths.map(({ width }) => width));
}

/**
 * A brand layer's box on the 48 grid: its path, grown by half its stroke width, and for a rotated layer
 * the box of the rotated corners (a conservative bound: a rotated circle may read slightly larger).
 */
function layerBox(layer) {
  const b = pathBounds(layer.d);
  const hw = layer.stroke === undefined ? 0 : (typeof layer.width === 'number' ? layer.width : MARK_STROKE_WIDTH) / 2;
  let corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
  const r = layer.rotate;
  if (r && typeof r.deg === 'number' && r.deg % 360 !== 0) {
    const a = (r.deg * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    corners = corners.map(([x, y]) => [r.cx + (x - r.cx) * cos - (y - r.cy) * sin, r.cy + (x - r.cx) * sin + (y - r.cy) * cos]);
  }
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { minX: Math.min(...xs) - hw, minY: Math.min(...ys) - hw, maxX: Math.max(...xs) + hw, maxY: Math.max(...ys) + hw };
}

/** The colour roles of the theme: the keys of `export type ColorTokens = { ... }`. */
function colorRoles(root, themeTypes) {
  const source = maskComments(readFileSync(join(root, themeTypes), 'utf8'));
  const start = source.search(/export\s+type\s+ColorTokens\s*=\s*\{/);
  if (start < 0) return null;
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('};', start));
  return new Set([...body.matchAll(/(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??\s*:/g)].map((m) => m[1]));
}

async function checkBrandMark(report, root, { file, themeTypes }) {
  if (!existsSync(join(root, file))) {
    report.problem({ file, rule: 'brand-mark-missing', message: `the renderer draws the app icon and splash from BRAND_MARK, and ${file} does not exist`, fix: 'Copy templates/src/ui/icons/brand-mark.ts and brand-mark-art.ts, then draw the app\'s own mark (references/brand-mark-and-pictures.md).' });
    return;
  }
  const problem = (message, fix = 'Fix BRAND_MARK (references/brand-mark-and-pictures.md, "The mark").') => report.problem({ file, line: 1, rule: 'brand-mark-shape', message, fix });
  let mark;
  try {
    mark = (await enableAppImports(root).load(file)).BRAND_MARK;
  } catch (error) {
    problem(`cannot be imported as plain data: ${errorText(error).split('\n')[0]}`, 'Keep brand-mark.ts data with type-only imports.');
    return;
  }
  const rolesReason = notYetCreated(root, { file: themeTypes, owner: 'design-system-structure' });
  if (rolesReason) report.skip({ file: themeTypes, rule: 'brand-mark-shape', message: `${rolesReason}; the colour roles are not checked` });
  const roles = rolesReason ? null : colorRoles(root, themeTypes);
  const isRole = (value) => typeof value === 'string' && (roles === null || roles.has(value));
  if (!mark || !Array.isArray(mark.layers) || mark.layers.length === 0) {
    problem('BRAND_MARK has no layers');
    return;
  }
  if (mark.layers.length > MARK_MAX_LAYERS) problem(`BRAND_MARK has ${mark.layers.length} layers; a mark read at 60 px on a home screen holds at most ${MARK_MAX_LAYERS} (about six is typical)`, 'Simplify the mark: one object, a light body with a dark edge, one accent (references/brand-mark-and-pictures.md, "Designing a mark").');
  if (!isRole(mark.tile)) problem(`tile "${mark.tile}" is not a theme colour role`, 'Use a ColorTokens key (primary, surface, ...): the scheme decides the colour, never a hex value.');
  mark.layers.forEach((layer, index) => {
    if (layer.fill === undefined && layer.stroke === undefined) problem(`layer ${index} has neither fill nor stroke`);
    for (const key of ['fill', 'stroke']) {
      if (layer[key] !== undefined && !isRole(layer[key])) problem(`layer ${index} ${key} "${layer[key]}" is not a theme colour role`, 'Use a ColorTokens key: a hex value would not follow dark mode or the palette.');
    }
    try {
      const box = layerBox(layer);
      const lo = MARK_MARGIN - MARK_SLACK;
      const hi = GRID - MARK_MARGIN + MARK_SLACK;
      if (box.minX < lo || box.minY < lo || box.maxX > hi || box.maxY > hi) problem(`layer ${index} reaches ${box.minX.toFixed(1)},${box.minY.toFixed(1)} to ${box.maxX.toFixed(1)},${box.maxY.toFixed(1)} with its stroke; the mark stays inside ${MARK_MARGIN}..${GRID - MARK_MARGIN}`, `Keep ${MARK_MARGIN} units clear at the edges of the 48 grid (half the stroke width counts), then regenerate.`);
    } catch (error) {
      problem(`layer ${index}: ${error.message}`, 'Fix the SVG path data.');
    }
  });
}

/** One Expo app: its own folder is the root its contract, renderer and images are read from. */
async function checkApp(root, options, report) {
  const layout = resolveLayout(root);
  const contract = readArtContract(root, layout.contractsDir, options.contract);
  // A contract that holds only check-icons' allow-lists ("icons") does not adopt the art pipeline.
  if (!contract.declaresArt && !existsSync(join(root, RENDERER))) {
    const why = contract.exists ? `${contract.file} declares no rendered art (no outputs, optional or glyphArea)` : `no ${contract.file}`;
    return { notApplicable: `the app does not render its app art in code (no ${RENDERER}; ${why})` };
  }
  await checkBrandMark(report, root, {
    file: toPosix(options['brand-mark'] ?? posix.join(layout.uiDir, 'icons', 'brand-mark.ts')),
    themeTypes: posix.join(layout.themeDir, 'theme-types.ts'),
  });
  const splashWidth = checkWiring(report, root, contract);
  const checked = checkImages(report, root, contract, { splashWidth });
  return { checked: checked + 1 };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'app root');
  const report = createReporter({ name: 'check-app-art', json: options.json });
  const result = await forEachExpoApp(root, report, (appRoot, appReport) => checkApp(appRoot, options, appReport));
  if (result.notApplicable !== null) return report.notApplicable(result.notApplicable);
  return report.finish({ checked: result.checked, unit: 'images and configs' });
});
