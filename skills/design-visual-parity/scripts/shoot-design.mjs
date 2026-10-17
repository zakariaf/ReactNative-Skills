#!/usr/bin/env node
// shoot-design.mjs: renders the design frames of the mockup at each device profile's geometry with
// the installed Google Chrome, and writes each frame's layout: the approved references every capture
// is compared with. --check proves the committed references are still what the mockup renders.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createReporter, decodePng, fail, makeTempDir, parseArgs, removeTempDir, run, sha256, toPosix } from './check-lib.mjs';
import { CONTRACT_METADATA_KEYS, contractMetadataOf, elementsForFacts, listOption, loadParity, referenceFiles, referenceName, referenceNames, referencePlan, selectFrames } from './lib/contract.mjs';
import { CHROME_ARGS, TOOLING_OPTION, launchChrome, loadPlaywright, playwrightVersion, toolingDirOf } from './lib/deps.mjs';
import { compactJson, encodeCompactPng } from './lib/images.mjs';
import { normText } from './lib/hierarchy.mjs';
import { referenceChangeProblems } from './lib/reference-changes.mjs';
import { openMockup, shootFrame } from './lib/render.mjs';

const SPEC = {
  name: 'shoot-design',
  summary:
    'Renders the design frames of the mockup (every frame by default) for every device x theme x language of the ' +
    'contract and writes <frame>.png (lossless) + <frame>.layout.json (testID rects, texts, styles, text runs), plus ' +
    'each reference variant a frame has for other app facts (<frame>--<variant>, derived from the rendered mockup by ' +
    'the DOM change the contract names; variants compose). --check renders into a temporary folder and fails on any ' +
    'pixel or layout difference from the committed references. --update-reference rewrites them, only for a change ' +
    'logged in the reference manifest.',
  usage: '[repo-root] (--out <dir> | --update-reference --change <id> | --check) [options]',
  options: {
    out: { type: 'string', value: 'dir', help: 'Write renders to <dir>/<device>/<theme>-<lang>/ (for a look; never the references)' },
    'update-reference': { type: 'boolean', help: 'Rewrite the committed references (only after a design change the reviewer approved)' },
    change: { type: 'string', value: 'id', help: 'With --update-reference: the id of the referenceChanges entry in the manifest that names the frames' },
    check: { type: 'boolean', help: 'Render to a temp folder and compare with the committed references; writes nothing' },
    frame: { type: 'string', multiple: true, value: 'key', help: 'Frame key(s) (default: every design frame)' },
    device: { type: 'string', multiple: true, value: 'id', help: 'Device profile(s) (default: every device of the contract)' },
    theme: { type: 'string', multiple: true, value: 'light|dark', help: "Theme(s) (default: the contract's)" },
    lang: { type: 'string', multiple: true, value: 'code', help: "Language(s) (default: the contract's)" },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
    tooling: TOOLING_OPTION,
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Chrome runs headless with --force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --disable-gpu',
    '(software raster: GPU raster is not repeatable), the device scale factor, reduced motion, animations at 0 s, every',
    'network request blocked (fonts come from local files next to the mockup). Each frame is pinned at (0,0), sized to the',
    'device (a phone frame to its screen, a tall frame to its full height, a state card to its content) and clipped.',
    '',
    'An element whose screen-contract "text" key exists in the app\'s catalog for the render language must show exactly',
    'that text (rule design-text): the design and the app\'s copy agree before anything is captured.',
    '',
    'Examples:',
    '  node shoot-design.mjs . --check                                   (prove the committed references are current)',
    '  node shoot-design.mjs . --out .parity/design --frame tasks-default  (renders to look at; not references)',
    '  node shoot-design.mjs . --update-reference --change D-12 --frame tasks-default',
    '',
    'NOT APPLICABLE when the app keeps no parity contract.',
  ].join('\n'),
};

/** Layouts are equal in everything the render measured; contract metadata is the contract's. */
function sameLayout(a, b) {
  const measured = (layout) => ({ ...layout, elements: (layout.elements ?? []).map((el) => Object.fromEntries(Object.entries(el).filter(([k]) => !CONTRACT_METADATA_KEYS.includes(k)))) });
  const walk = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= 0.01;
    if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => walk(v, y[i]));
    if (x && typeof x === 'object') {
      if (!y || typeof y !== 'object') return false;
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      return [...keys].every((k) => walk(x[k], y[k]));
    }
    return x === y;
  };
  return walk(measured(a), measured(b));
}

/** sha256 of every file in a folder (sorted names), or null when it does not exist. */
function folderHash(dir) {
  if (!existsSync(dir)) return null;
  const parts = [];
  const walkDir = (d, prefix) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((p, q) => (p.name < q.name ? -1 : 1))) {
      if (entry.isDirectory()) walkDir(join(d, entry.name), `${prefix}${entry.name}/`);
      else parts.push(`${prefix}${entry.name}:${sha256(readFileSync(join(d, entry.name)))}`);
    }
  };
  walkDir(dir, '');
  return sha256(parts.join('\n'));
}

/** The app's catalog for a language (flat key -> message), or null. */
function readCatalog(root, layout, lang) {
  const path = join(root, layout.i18nDir, 'catalogs', `${lang}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const modes = [options.out ? 'out' : null, options['update-reference'] ? 'update' : null, options.check ? 'check' : null].filter(Boolean);
  const report = createReporter({ name: 'shoot-design' });
  const parity = loadParity(root, { contract: options.contract ?? null });
  if (parity.missing) return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references`);
  if (modes.length !== 1) fail('nothing to do: pass exactly one of --out <dir>, --update-reference or --check', 'Run: node shoot-design.mjs --help');
  if (options.change && modes[0] !== 'update') fail('--change belongs to --update-reference', 'Pass it as: --update-reference --change <id>.');
  const mockupPath = join(root, parity.paths.mockup);
  if (!existsSync(mockupPath)) fail(`the mockup ${parity.paths.mockup} does not exist`, 'Put the approved mockup there, or fix mockup.file in the contract (check-mockup.mjs explains the conventions).');
  const keys = options.frame?.length ? selectFrames(parity, { frame: options.frame }) : [...parity.frames.keys()];
  const devices = listOption(options.device, [...parity.devices.keys()]);
  for (const d of devices) if (!parity.devices.has(d)) fail(`unknown device "${d}"`, `The contract lists ${[...parity.devices.keys()].join(', ')}.`);
  const themes = listOption(options.theme, parity.contract.themes);
  const langs = listOption(options.lang, parity.contract.languages);
  for (const t of themes) if (!parity.contract.themes.includes(t)) fail(`unknown theme "${t}"`, `The contract lists ${parity.contract.themes.join(', ')}.`);
  for (const l of langs) if (!parity.contract.languages.includes(l)) fail(`unknown language "${l}"`, `The contract lists ${parity.contract.languages.join(', ')}.`);
  const everything = keys.length === parity.frames.size && devices.length === parity.devices.size && themes.length === parity.contract.themes.length && langs.length === parity.contract.languages.length;

  const manifestPath = join(root, parity.paths.manifest);
  let previous = null;
  try {
    previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  } catch (error) {
    fail(`${parity.paths.manifest} is not valid JSON: ${error.message}`, 'Restore it from git.');
  }
  // The references are the reviewer's: they change only for a design change logged first.
  if (modes[0] === 'update' && previous) {
    const entry = (previous.referenceChanges ?? []).find((c) => c.id === options.change);
    if (!options.change || !entry) {
      report.problem({ file: parity.paths.manifest, rule: 'reference-change-unlogged', message: `--update-reference ${options.change ? `--change ${options.change} names no entry of referenceChanges` : 'needs --change <id>'}`, fix: 'Add the change to referenceChanges first ({ id, date, frames, variants, what, why }: the approved design change and who approved it), then pass its id.' });
      return report.finish({ checked: 1, unit: 'frames' });
    }
    const unnamed = keys.filter((k) => !(entry.frames ?? []).includes(k));
    if (unnamed.length) {
      report.problem({ file: parity.paths.manifest, rule: 'reference-change-unlogged', message: `the change ${entry.id} does not name ${unnamed.join(', ')}, which this run would re-render`, fix: `Pass --frame for the frames ${entry.id} names, or add the frames to the entry (only when the approved change really touches them).` });
      return report.finish({ checked: 1, unit: 'frames' });
    }
  }

  // --check and --update-reference render into a temporary folder: the references change only when
  // every render of the run succeeded.
  const tempRoot = modes[0] !== 'out' ? makeTempDir('shoot-design-') : null;
  const outRoot = modes[0] === 'out' ? resolve(options.out) : tempRoot;
  const where = (file) => toPosix(relative(root, file)) || file;
  const tooling = toolingDirOf(options);
  const pw = await loadPlaywright(tooling);
  const browser = await launchChrome(pw);
  const files = {};
  let shots = 0;
  const started = Date.now();
  try {
    const combos = devices.flatMap((device) => themes.flatMap((theme) => langs.map((lang) => ({ device, theme, lang }))));
    for (const { device: deviceId, theme, lang } of combos) {
      const device = parity.devices.get(deviceId);
      const dir = parity.rtl.has(lang) ? 'rtl' : 'ltr';
      const tag = `${deviceId}/${theme}-${lang}`;
      const { context, page, blocked, errors, fonts } = await openMockup(browser, { mockupPath, mockup: parity.contract.mockup, theme, lang, dir, device });
      try {
        for (const url of blocked) report.problem({ file: where(mockupPath), rule: 'mockup-offline', message: `[${tag}] the mockup requested ${url}`, fix: 'The mockup must load nothing from the network: copy the file next to it (check-mockup.mjs).' });
        for (const message of errors) report.problem({ file: where(mockupPath), rule: 'design-error', message: `[${tag}] the mockup threw: ${message}`, fix: 'Fix the mockup script (or drop it: a static mockup is the default).' });
        for (const f of fonts.filter((face) => face.status !== 'loaded')) report.problem({ file: where(mockupPath), rule: 'fonts', message: `[${tag}] ${f.family} ${f.weight} did not load (${f.status})`, fix: 'Point its @font-face at the exact font file the app bundles, next to the mockup.' });
        const catalog = readCatalog(root, parity.layout, lang);
        for (const frameKey of keys) {
          const frame = parity.frames.get(frameKey);
          for (const variant of referencePlan(frame, parity.designFacts)) {
            const stem = referenceName(frameKey, variant?.id);
            const elements = elementsForFacts(frame.elements, variant?.facts ?? parity.designFacts);
            const shot = await shootFrame(page, { frame, elements, checkElements: frame.elements, device, variant, lang });
            const fixes = {
              'variant-derive': `Fix the derive of frames.${frameKey}.variants in the contract: each step matches exactly one element, and it hides exactly the elements whose "when" the variant's facts do not match.`,
              'design-mask': `Fix frames.${frameKey}.designMasks in the contract (each selector matches exactly one element).`,
              'frame-missing': `Draw the frame once in the mockup with data-frame="${frameKey}" (check-mockup.mjs).`,
            };
            for (const p of shot.problems) report.problem({ file: `${tag}/${stem}`, rule: p.rule, message: `[${tag}] ${p.message}`, fix: fixes[p.rule] ?? 'Run check-mockup.mjs and fix what it names.' });
            if (!shot.png) continue;
            const decoded = decodePng(shot.png);
            const expectW = shot.size.w * device.scale;
            const expectH = shot.size.h * device.scale;
            if (decoded.width !== expectW || decoded.height !== expectH) {
              report.problem({ file: `${tag}/${stem}`, rule: 'render-size', message: `[${tag}] rendered ${decoded.width} x ${decoded.height}, expected ${expectW} x ${expectH}`, fix: 'The frame must be pinned at (0,0) at the device scale; check the mockup for a transform or zoom on the frame.' });
              continue;
            }
            const byId = new Map(elements.map((el) => [el.testID, el]));
            const layoutElements = shot.layout.elements.map((found) => {
              const el = byId.get(found.testID);
              if (found.count !== 1) report.problem({ file: `${tag}/${stem}`, rule: 'exactly-one-match', message: `[${tag}] ${found.testID}: data-testid matched ${found.count} visible elements`, fix: 'Run check-mockup.mjs; give exactly one visible element of the frame this data-testid.' });
              return { ...found, ...contractMetadataOf(el) };
            });
            // The design's copy and the app's catalog agree (plain messages only).
            if (catalog) {
              for (const el of elements) {
                const message = el.text ? catalog[el.text] : undefined;
                if (typeof message !== 'string' || /[{}]/.test(message)) continue;
                const found = shot.layout.elements.find((f) => f.testID === el.testID);
                if (found?.count === 1 && normText(found.text) !== normText(message)) {
                  report.problem({ file: `${tag}/${stem}`, rule: 'design-text', message: `[${tag}] ${el.testID} shows "${normText(found.text).slice(0, 60)}" but the catalog's ${el.text} is "${normText(message).slice(0, 60)}"`, fix: 'Ask the reviewer which one is right; change the catalog (i18n-strings-and-catalogs) or the mockup, never the reference by hand.' });
                }
              }
            }
            const layout = {
              version: 1,
              frame: frameKey,
              variant: variant?.id ?? null,
              facts: variant?.facts ?? parity.designFacts,
              kind: frame.kind,
              screen: frame.screen,
              state: frame.state,
              root: frame.root,
              device: deviceId,
              theme,
              lang,
              scale: device.scale,
              size: shot.size,
              image: `${stem}.png`,
              elements: layoutElements,
              texts: shot.layout.texts,
              ...(shot.layout.masks ? { masks: shot.layout.masks } : {}),
            };
            const png = encodeCompactPng(decoded);
            const layoutText = compactJson(layout);
            const ref = referenceFiles({ paths: { references: outRoot } }, { device: deviceId, theme, lang, frame: frameKey, variant: variant?.id });
            mkdirSync(ref.dir, { recursive: true });
            writeFileSync(ref.image, png);
            writeFileSync(ref.layout, layoutText);
            files[`${tag}/${stem}.png`] = { sha256: sha256(png), bytes: png.length, width: decoded.width, height: decoded.height };
            files[`${tag}/${stem}.layout.json`] = { sha256: sha256(layoutText), bytes: Buffer.byteLength(layoutText) };
            shots += 1;
          }
        }
      } finally {
        await context.close();
      }
    }
    // The screen contract's own reference image of each frame (screen-contracts checks that
    // <screens.json references>/<frame>.png exists): the first device of the contract, the light
    // theme, the source language, 1 pt = 1 px. Rendered with the references, proven with them.
    const screenShots = {};
    const screenDir = parity.paths.screenReferences;
    const screenInParity = screenDir === parity.paths.references || screenDir.startsWith(`${parity.paths.references}/`);
    if (modes[0] !== 'out' && !screenInParity && report.count === 0) {
      const sDevice = { ...parity.devices.get([...parity.devices.keys()][0]), scale: 1 };
      const sTheme = parity.contract.themes.includes('light') ? 'light' : parity.contract.themes[0];
      const sLang = parity.contract.languages[0];
      const { context, page } = await openMockup(browser, { mockupPath, mockup: parity.contract.mockup, theme: sTheme, lang: sLang, dir: parity.rtl.has(sLang) ? 'rtl' : 'ltr', device: sDevice });
      try {
        for (const frameKey of keys) {
          const frame = parity.frames.get(frameKey);
          const shot = await shootFrame(page, { frame, elements: elementsForFacts(frame.elements, parity.designFacts), checkElements: frame.elements, device: sDevice, lang: sLang });
          if (!shot.png) continue;
          const file = `screens/${frameKey}.png`;
          mkdirSync(join(outRoot, 'screens'), { recursive: true });
          writeFileSync(join(outRoot, file), encodeCompactPng(decodePng(shot.png)));
          screenShots[frameKey] = file;
        }
      } finally {
        await context.close();
      }
    } else if (modes[0] !== 'out' && screenInParity) {
      report.note(`the screen contract's references folder ${screenDir} is inside ${parity.paths.references}: no separate 1 pt = 1 px image is written`);
    }
    const inputs = {
      mockup: sha256(readFileSync(mockupPath)),
      fonts: parity.contract.mockup.fonts ? folderHash(join(root, parity.contract.mockup.fonts)) : null,
      devices: Object.fromEntries(devices.map((d) => [d, sha256(readFileSync(join(root, parity.devices.get(d).file)))])),
      contract: sha256(readFileSync(join(root, parity.contractRel))),
      screens: sha256(readFileSync(join(root, parity.screensRel))),
    };
    const manifest = {
      version: 1,
      rendered: new Date().toISOString().slice(0, 10),
      renderer: { chrome: browser.version(), playwright: playwrightVersion(tooling), flags: CHROME_ARGS.join(' ') },
      inputs,
      devices,
      themes,
      langs,
      frames: keys,
      variants: keys.flatMap((key) => referenceNames(parity.frames.get(key), parity.designFacts).slice(1)),
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
    };
    if (modes[0] === 'update' && report.count > 0) {
      report.note(`nothing written: ${report.count} problem${report.count === 1 ? '' : 's'} in the renders, so the references stay as they were`);
    } else if (modes[0] !== 'check') {
      if (modes[0] === 'update') {
        for (const file of Object.keys(files)) {
          mkdirSync(dirname(join(root, parity.paths.references, file)), { recursive: true });
          cpSync(join(outRoot, file), join(root, parity.paths.references, file));
        }
        for (const [frameKey, file] of Object.entries(screenShots)) {
          mkdirSync(join(root, screenDir), { recursive: true });
          cpSync(join(outRoot, file), join(root, screenDir, `${frameKey}.png`));
        }
        if (Object.keys(screenShots).length) report.note(`wrote ${Object.keys(screenShots).length} screen-contract references to ${screenDir} (1 pt = 1 px, the first device, light, the source language)`);
      }
      const target = modes[0] === 'update' ? manifestPath : join(outRoot, 'manifest.json');
      const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
      if (modes[0] === 'update' && previous && !everything) {
        manifest.files = sortKeys({ ...previous.files, ...files });
        manifest.devices = previous.devices ?? manifest.devices;
        manifest.themes = previous.themes ?? manifest.themes;
        manifest.langs = previous.langs ?? manifest.langs;
        manifest.frames = previous.frames ?? manifest.frames;
        manifest.variants = previous.variants ?? manifest.variants;
      }
      // The log of deliberate reference changes is the reviewer's record: a re-render never drops it.
      if (modes[0] === 'update') manifest.referenceChanges = previous?.referenceChanges ?? [];
      writeFileSync(target, `${JSON.stringify(manifest, null, 1)}\n`);
      report.note(`wrote ${shots} renders to ${where(modes[0] === 'update' ? join(root, parity.paths.references) : outRoot)} in ${((Date.now() - started) / 1000).toFixed(1)} s (Chrome ${browser.version()})`);
    } else {
      if (!previous) fail(`no committed references (${where(manifestPath)} is missing)`, 'Render them once with --update-reference after the reviewer approved the design.');
      for (const message of referenceChangeProblems(previous, { frames: parity.frames, designFacts: parity.designFacts })) {
        report.problem({ file: where(manifestPath), rule: 'reference-changes', message, fix: 'Each entry is { id, date (YYYY-MM-DD), frames, variants, what, why } naming frames and variants of this set (references/mockup-and-references.md).' });
      }
      // The mockup, its fonts and the device profiles decide pixels: any change makes the set stale.
      // The contracts also carry metadata no render reads (checks, component names): a change there is
      // judged by the re-render itself, which compares every checked frame's pixels and layout.
      const metadataOnly = [];
      for (const [input, hash] of Object.entries(inputs)) {
        const was = previous.inputs?.[input];
        const same = JSON.stringify(was ?? null) === JSON.stringify(hash ?? null) || (input === 'devices' && Object.entries(hash).every(([d, h]) => was?.[d] === h));
        if (same) continue;
        if (input === 'contract' || input === 'screens') {
          metadataOnly.push(input);
          continue;
        }
        report.problem({ file: where(manifestPath), rule: 'stale-reference', message: `the ${input} changed since the references were rendered`, fix: 'If the design changed on purpose, log it in referenceChanges and run --update-reference --change <id>; otherwise restore the input.' });
      }
      for (const [file, info] of Object.entries(files)) {
        const refPath = join(root, parity.paths.references, file);
        if (!existsSync(refPath)) {
          report.problem({ file: where(refPath), rule: 'reference-missing', message: 'no committed reference for this render', fix: 'Render it with --update-reference (for an approved design, logged in referenceChanges).' });
          continue;
        }
        if (file.endsWith('.png')) {
          const ref = decodePng(readFileSync(refPath));
          const fresh = decodePng(readFileSync(join(outRoot, file)));
          if (ref.width !== fresh.width || ref.height !== fresh.height) {
            report.problem({ file: where(refPath), rule: 'reference-drift', message: `size ${ref.width} x ${ref.height}, fresh render ${fresh.width} x ${fresh.height}`, fix: 'Find out what changed (Chrome, fonts, mockup); never commit a drifted set silently.' });
            continue;
          }
          let differing = 0;
          for (let i = 0; i < ref.data.length; i += 4) if (ref.data[i] !== fresh.data[i] || ref.data[i + 1] !== fresh.data[i + 1] || ref.data[i + 2] !== fresh.data[i + 2]) differing += 1;
          if (differing > 0) report.problem({ file: where(refPath), rule: 'reference-drift', message: `${differing} pixels differ from a fresh render (sha256 ${info.sha256.slice(0, 12)})`, fix: 'A renderer, font or mockup change moved pixels: compare the two images; update the set only when the change is understood, approved and logged.' });
        } else {
          const ref = JSON.parse(readFileSync(refPath, 'utf8'));
          const fresh = JSON.parse(readFileSync(join(outRoot, file), 'utf8'));
          if (!sameLayout(ref, fresh)) report.problem({ file: where(refPath), rule: 'reference-drift', message: 'the layout differs from a fresh render', fix: 'Diff the two layout.json files to see which element moved.' });
        }
      }
      for (const [frameKey, file] of Object.entries(screenShots)) {
        const refRel = `${screenDir}/${frameKey}.png`;
        const refPath = join(root, refRel);
        const fix = 'Render it with --update-reference (it writes the screen-contract image beside the parity references); never export or edit it by hand.';
        if (!existsSync(refPath)) {
          report.problem({ file: refRel, rule: 'reference-missing', message: `no screen-contract reference for ${frameKey} (screen-contracts reads it)`, fix });
          continue;
        }
        const ref = decodePng(readFileSync(refPath));
        const fresh = decodePng(readFileSync(join(outRoot, file)));
        const same = ref.width === fresh.width && ref.height === fresh.height && ref.data.every((v, i) => i % 4 === 3 || v === fresh.data[i]);
        if (!same) report.problem({ file: refRel, rule: 'reference-drift', message: `the screen-contract reference of ${frameKey} differs from a fresh render (1 pt = 1 px, light, ${parity.contract.languages[0]})`, fix });
      }
      report.note(`rendered ${shots} frames in ${((Date.now() - started) / 1000).toFixed(1)} s and compared them with ${where(join(root, parity.paths.references))}`);
      for (const input of metadataOnly) {
        report.note(everything
          ? `the ${input} changed since the references were rendered; every reference rendered the same (pixels and measured layout) unless a problem above says otherwise, so the change is metadata only`
          : `the ${input} changed since the references were rendered; only the frames rendered here are proven unaffected: run --check with no --frame, --device, --theme or --lang to prove the rest`);
      }
    }
  } finally {
    await browser.close();
    if (tempRoot) removeTempDir(tempRoot);
  }
  return report.finish({ checked: shots, unit: 'frames' });
});
