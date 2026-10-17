// make-variant-icons.mjs: draws the development and preview app icons from the store icon.
// Reads the PNGs in assets/icons/production/ (the app's own icons, moved there in Workflow step 2) and
// writes badged copies to assets/icons/development/ and assets/icons/preview/: an amber band for
// development, a violet band with white hatching for preview (told apart without colour too). On the
// Android 13+ themed icon (android-monochrome.png), where launchers draw only the alpha channel, the
// preview hatching is cut out of the band, so the two badges differ there as well. Every
// variant then builds (a missing icon file stops prebuild with ENOENT) and check-variants' variant-icon
// rule passes. icons-app-icon-and-splash may redraw the badges at the same paths. Zero dependencies.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createReporter, decodePng, encodePng, parseArgs, parseColor, requireDir, run, toPosix, UsageError } from './check-lib.mjs';
import { resolveAppDir } from './lib/env-scan.mjs';

const SPEC = {
  name: 'make-variant-icons',
  summary: 'Writes badged development and preview icons from the store icons in assets/icons/production/, so every variant has its own icon files and builds.',
  usage: '[repo-root] [options]',
  options: {
    'app-dir': { type: 'string', value: 'dir', help: 'Folder that holds app.config.ts and assets/, relative to the repo root (default: the root, or the one workspace with an app config)' },
    force: { type: 'boolean', help: 'Redraw icons that already exist (default: keep them)' },
    'dry-run': { type: 'boolean', help: 'Check the sources and print what would be written, without writing' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Reads (assets/icons/production/):  icon.png (required, square, at least 1024 x 1024; without it nothing is drawn, exit 2),',
    '  android-foreground.png, android-background.png, android-monochrome.png (optional, square).',
    'Writes the same names to assets/icons/development/ and assets/icons/preview/. Existing files are',
    'kept unless --force. An Icon Composer folder (*.icon) stays production-only: development and',
    'preview use their badged icon.png on iOS (templates/app.config.ts iconsFor does).',
    'Rules (exit 1):',
    '  icon-source  each source PNG decodes (not interlaced) and is square; icon.png is at least 1024 wide',
    '  icon-badge   the development and preview android-monochrome.png drawn now differ in their alpha mask',
    '               (Android 13+ themed icons draw only alpha); kept files with one mask get a note',
  ].join('\n'),
};

const SOURCE_DIR = 'assets/icons/production';
const SOURCES = Object.freeze([
  { name: 'icon.png', required: true, minWidth: 1024, what: 'the fallback icon and the iOS icon of development and preview' },
  { name: 'android-foreground.png', required: false, minWidth: 0, what: 'the adaptive icon foreground' },
  { name: 'android-background.png', required: false, minWidth: 0, what: 'the adaptive icon background' },
  { name: 'android-monochrome.png', required: false, minWidth: 0, what: 'the Android 13+ themed icon' },
]);
// The band sits inside the part of an adaptive icon every launcher mask shows (the 66 dp safe zone of
// the 108 dp canvas spans 19 % to 81 %), and low enough on a full-bleed iOS icon to leave the art.
const BAND = Object.freeze({ top: 0.6, bottom: 0.78, rim: 0.012 });
const BADGES = Object.freeze({
  development: { color: '#D97706', hatch: false },
  preview: { color: '#7C3AED', hatch: true },
});
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];
// Launchers draw the themed icon from this layer's alpha channel alone.
const MONOCHROME = 'android-monochrome.png';

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  const appDir = requireDir(resolve(root, resolveAppDir(root, options['app-dir'])), 'app folder');
  const appRel = (path) => toPosix(relative(root, join(appDir, path)));
  const report = createReporter({ name: 'make-variant-icons', json: options.json });
  const sourceDir = join(appDir, SOURCE_DIR);
  if (!isFile(join(sourceDir, 'icon.png'))) {
    throw new UsageError(`nothing to draw from: ${appRel(`${SOURCE_DIR}/icon.png`)} does not exist`, `Move the app's store icons into ${appRel(SOURCE_DIR)}/ first (icon.png, the android-*.png layers, an .icon folder if the app has one), then rerun.`);
  }
  const iconFolders = readdirSync(sourceDir).filter((name) => name.endsWith('.icon') && statSync(join(sourceDir, name)).isDirectory());
  if (iconFolders.length > 0) {
    report.note(`note: ${appRel(`${SOURCE_DIR}/${iconFolders[0]}`)} (Icon Composer) stays the production iOS icon; development and preview use their badged icon.png on iOS`);
  }

  let checked = 0;
  for (const source of SOURCES) {
    const sourcePath = join(sourceDir, source.name);
    if (!isFile(sourcePath)) continue;
    checked += 1;
    const sourceRel = appRel(`${SOURCE_DIR}/${source.name}`);
    const image = readSource({ report, sourcePath, sourceRel, source });
    if (image === null) continue;
    const results = {};
    for (const [variant, badge] of Object.entries(BADGES)) {
      const targetRel = appRel(`assets/icons/${variant}/${source.name}`);
      const targetPath = join(root, targetRel);
      if (existsSync(targetPath) && !options.force) {
        report.note(`kept ${targetRel} (it exists; --force redraws it)`);
        results[variant] = { rel: targetRel, drawn: false, image: readExisting(targetPath) };
        continue;
      }
      const drawn = badged(image, badge, { alphaOnly: source.name === MONOCHROME });
      if (!options['dry-run']) {
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, encodePng(drawn));
      }
      report.note(`${options['dry-run'] ? 'would write' : 'wrote'} ${targetRel} (${variant} badge, ${image.width} x ${image.height}, ${source.what})`);
      results[variant] = { rel: targetRel, drawn: true, image: drawn };
    }
    if (source.name === MONOCHROME) compareThemedBadges({ report, ...results });
  }
  return report.finish({ checked, unit: 'source icons' });
});

/** The decoded PNG at `path`, or null when it cannot be read. */
function readExisting(path) {
  try {
    return decodePng(readFileSync(path));
  } catch {
    return null;
  }
}

function sameAlpha(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 3; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/**
 * icon-badge: the development and preview themed icons must differ in their alpha mask, the only
 * channel Android 13+ launchers draw. Drawn now, an equal mask is a problem; kept files get a note.
 */
function compareThemedBadges({ report, development, preview }) {
  if (!development?.image || !preview?.image) return;
  if (!sameAlpha(development.image, preview.image)) {
    if (development.drawn && preview.drawn) report.note(`note: ${development.rel} and ${preview.rel} differ in their alpha mask (Android 13+ themed icons draw only alpha)`);
    return;
  }
  if (development.drawn || preview.drawn) {
    report.problem({ file: preview.rel, line: 0, rule: 'icon-badge', message: `${development.rel} and ${preview.rel} have the same alpha mask: Android 13+ themed icons draw only alpha, so the two builds look identical there`, fix: 'Rerun with --force (the preview themed band then has transparent stripes), or give a hand-drawn monochrome badge a different shape for each variant.' });
    return;
  }
  report.note(`note: the kept ${development.rel} and ${preview.rel} have the same alpha mask, so Android 13+ themed icons show them identically; rerun with --force to redraw them`);
}

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** The decoded source, or null after reporting why it cannot be badged. */
function readSource({ report, sourcePath, sourceRel, source }) {
  let image;
  try {
    image = decodePng(readFileSync(sourcePath));
  } catch (error) {
    report.problem({ file: sourceRel, line: 0, rule: 'icon-source', message: `${sourceRel} cannot be read as a PNG (${error.message})`, fix: 'Export it again as a non-interlaced PNG (any image editor or Icon Composer export).' });
    return null;
  }
  if (image.width !== image.height) {
    report.problem({ file: sourceRel, line: 0, rule: 'icon-source', message: `${sourceRel} is ${image.width} x ${image.height}: an app icon is square, and the platform resize would stretch or crop it`, fix: 'Export a square image (1024 x 1024 for icon.png, the size Expo recommends and the App Store icon uses).' });
    return null;
  }
  if (image.width < source.minWidth) {
    report.problem({ file: sourceRel, line: 0, rule: 'icon-source', message: `${sourceRel} is ${image.width} x ${image.height}, smaller than ${source.minWidth} x ${source.minWidth}: the App Store icon would be upscaled and blurry`, fix: `Export it at ${source.minWidth} x ${source.minWidth}.` });
    return null;
  }
  return image;
}

/**
 * A copy of `image` with the variant's band: solid for development, hatched for preview. With
 * `alphaOnly` (the themed icon layer) the hatching is transparent, so the bands differ in alpha too.
 */
function badged(image, badge, { alphaOnly = false } = {}) {
  const { width, height } = image;
  const data = Uint8Array.from(image.data);
  const color = parseColor(badge.color);
  const top = Math.round(height * BAND.top);
  const bottom = Math.round(height * BAND.bottom);
  const rim = Math.max(1, Math.round(height * BAND.rim));
  const hatch = Math.max(2, Math.round((bottom - top) / 3));
  for (let y = top - rim; y < bottom + rim; y += 1) {
    if (y < 0 || y >= height) continue;
    const inRim = y < top || y >= bottom;
    for (let x = 0; x < width; x += 1) {
      const stripe = badge.hatch && Math.floor((x + y) / hatch) % 2 === 1;
      const pixel = inRim ? WHITE : stripe ? (alphaOnly ? CLEAR : WHITE) : color;
      data.set(pixel, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
