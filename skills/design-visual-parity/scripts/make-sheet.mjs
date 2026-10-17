#!/usr/bin/env node
// make-sheet.mjs: the images read in the look pass: design | app | diff side by side, zoomed bands,
// a crop for every failing element and a contact sheet of the eye-check elements.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run, sha256 } from './check-lib.mjs';
import { isCropOnly, loadParity, withContractMetadata, withModal } from './lib/contract.mjs';
import { TOLERANCES, frameGeometry, layoutFactsOf } from './lib/gates.mjs';
import { parseAppLayout, parseMaestroHierarchy } from './lib/hierarchy.mjs';
import { blank, blit, cloneImage, crop, downscale, encodeCompactPng, hatch, outline, readImage, resample } from './lib/images.mjs';
import { pixelDiff } from './lib/pixel-diff.mjs';
import { RUN_FILES, findRunDirs, readRun } from './lib/runs.mjs';

const SPEC = {
  name: 'make-sheet',
  summary:
    'Builds the look-pass images for run folders: sheet.png (design | app | diff at 1 px per pt, failing elements ' +
    'outlined in magenta, masks hatched), zoom-1..n.png (design | app bands at 2x), crops/<testID>.png (design | app | ' +
    'diff at the capture scale for every failing element) and eye-<n>.png (every icon, logo and picture as design | app ' +
    'pairs). Writes sheets.json with the sha256 of each image for the sign-off ledger.',
  usage: '[repo-root] [--run <dir>]... [options]',
  options: {
    run: { type: 'string', multiple: true, value: 'dir', help: "A run folder (default: every run folder under the contract's runsDir)" },
    frame: { type: 'string', multiple: true, value: 'key', help: 'Only the runs of these frames' },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Read sheet.png first (whole screen), then each zoom band, then the crops of failing elements, then',
    'eye-*.png. Colours in the diff panel: red = the app is lighter or different, blue = the app is darker,',
    'grey hatching = masked (status bar, home indicator or navigation bar, masked elements, a probed region).',
    'Run check-parity.mjs first so the failing elements are outlined. A scrolled capture of a tall frame is',
    'compared with the design window it should show (fixed header, scrolled body, pinned parts); sheet.png adds',
    'the full-height design with that window between cyan lines.',
    '',
    'NOT APPLICABLE when the app keeps no parity contract.',
    '',
    'Example: node make-sheet.mjs . --run .parity/iphone-16-pro/tasks-default/light-en',
  ].join('\n'),
};

const GUTTER = 12;
const BG = [40, 40, 48, 255];
const MAGENTA = [255, 0, 200];
const CYAN = [0, 200, 255];
const DIFF_COLOURS = { alpha: 0.3, diffColor: [230, 30, 30], diffColorAlt: [30, 90, 230] };

/** Side by side panels with gutters; panels may differ in height. */
function row(panels) {
  const w = panels.reduce((s, p) => s + p.width, 0) + GUTTER * (panels.length + 1);
  const h = Math.max(...panels.map((p) => p.height)) + GUTTER * 2;
  const out = blank(w, h, BG);
  let x = GUTTER;
  for (const p of panels) {
    blit(p, out, x, GUTTER);
    x += p.width + GUTTER;
  }
  return out;
}

function stack(rows) {
  const w = Math.max(...rows.map((r) => r.width));
  const h = rows.reduce((s, r) => s + r.height, 0);
  const out = blank(w, h, BG);
  let y = 0;
  for (const r of rows) {
    blit(r, out, 0, y);
    y += r.height;
  }
  return out;
}

/**
 * The design as one capture of a tall frame shows it: the fixed header, the body scrolled by the
 * measured shift (clipped at the end of the body) and the pinned parts at the bottom. The diff and
 * the zoom bands compare this window with the app; other frames use the design as it is.
 */
function designWindow(design, geo, shiftPt, height, S) {
  const out = blank(design.width, height, [0, 0, 0, 255]);
  const hb = Math.round(geo.headerBottom * S);
  const bb = Math.min(height, Math.round(geo.bodyBottom * S));
  blit(crop(design, 0, 0, design.width, hb), out, 0, 0);
  blit(crop(design, 0, hb - Math.round(shiftPt * S), design.width, bb - hb), out, 0, hb);
  if (bb < height) blit(crop(design, 0, bb - Math.round(geo.pinShift * S), design.width, height - bb), out, 0, bb);
  return out;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const report = createReporter({ name: 'make-sheet' });
  const parity = loadParity(root, { contract: options.contract ?? null });
  if (parity.missing) return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references`);
  const show = (p) => relative(process.cwd(), p) || '.';
  const runsRoot = join(root, parity.paths.runs);
  let dirs = (options.run ?? []).map((p) => resolve(p));
  if (dirs.length === 0) {
    if (!existsSync(runsRoot)) fail(`nothing to draw: no run folders (${show(runsRoot)} does not exist)`, 'Capture and check first (run-parity.mjs).');
    dirs = findRunDirs(runsRoot);
  }
  const frameFilter = new Set((options.frame ?? []).flatMap((f) => f.split(',')));
  const facts = layoutFactsOf(parity.contract);
  let made = 0;
  let considered = 0;
  for (const dir of dirs) {
    const r = readRun(dir, parity);
    if (frameFilter.size && !frameFilter.has(r.info.frame)) continue;
    considered += 1;
    const file = show(r.app);
    const device = parity.devices.get(r.info.device);
    if (!device) {
      report.problem({ file, rule: 'reference-mismatch', message: `run.json names the device "${r.info.device}", which the contract does not list`, fix: 'Capture on a device profile of the contract.' });
      continue;
    }
    const S = device.scale;
    if (!existsSync(r.reference.image) || !existsSync(r.reference.layout)) {
      report.problem({ file, rule: 'reference-missing', message: `no design reference at ${show(r.reference.image)}`, fix: 'Render it with shoot-design.mjs (only for an approved design).' });
      continue;
    }
    // Measurements from the reference, element metadata (component, checks, reach) from the current contract.
    const frame = parity.frames.get(r.info.frame);
    const layout = withModal(withContractMetadata(JSON.parse(readFileSync(r.reference.layout, 'utf8')), frame), frame);
    const design = readImage(r.reference.image, 'design reference');
    const app = readImage(r.app, 'app capture');
    const isPhone = layout.kind === 'phone' || layout.kind === 'phone-tall';
    const sizeOk = isPhone ? app.width === device.pixels.width && app.height === device.pixels.height : app.width === device.pixels.width;
    if (!sizeOk) {
      report.problem({ file, rule: 'capture-size', message: `app.png is ${app.width} x ${app.height} px, not the parity device's ${device.pixels.width} x ${device.pixels.height}`, fix: `Capture again on this session's parity device for ${device.id} (capture-app.mjs).` });
      continue;
    }
    const reportPath = join(dir, RUN_FILES.report);
    const runReport = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
    if (runReport && runReport.app?.imageSha256 !== sha256(readFileSync(r.app))) {
      report.problem({ file: show(reportPath), rule: 'stale-report', message: 'report.json was made from a different app.png', fix: 'Run check-parity.mjs on this run folder again, then make the sheet.' });
      continue;
    }
    if (!runReport) report.note(`note  ${show(dir)}: no report.json yet, so nothing is outlined (run check-parity.mjs first)`);
    // Problem rects are page coordinates with a viewRect for the screen; an older report mixed the two.
    if (runReport && (runReport.problems ?? []).some((p) => p.rect && !p.viewRect)) {
      report.problem({ file: show(reportPath), rule: 'stale-report', message: 'report.json was written by an older check-parity.mjs (problem rects without viewRect, so a scrolled capture would crop the wrong design element)', fix: 'Run check-parity.mjs on this run folder again, then make the sheet.' });
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const failing = (runReport?.problems ?? []).filter((p) => p.rect);
    const boundsPath = r.appLayout ?? r.hier;
    const boundsJson = boundsPath ? JSON.parse(readFileSync(boundsPath, 'utf8')) : null;
    const bounds = boundsJson ? (r.appLayout ? parseAppLayout(boundsJson) : parseMaestroHierarchy(boundsJson, { unitScale: device.platform === 'android' ? S : 1 })) : { elements: new Map() };

    // Tall frames: the part of the design this capture shows (header, scrolled body, pinned parts).
    const geo = frameGeometry(layout, device, facts);
    const shiftPt = geo.tall ? (runReport?.stats?.scrollShiftPt ?? -(r.info.scrollY ?? 0)) : 0;
    const view = geo.tall ? designWindow(design, geo, shiftPt, app.height, S) : design;
    const byId = new Map(layout.elements.filter((el) => el.rect).map((el) => [el.testID, el]));
    const toView = (rect, testID) => {
      if (!geo.tall) return rect;
      const el = byId.get(testID);
      const dy = el && geo.isPinned(el) ? geo.pinShift : (el ? geo.inBody(el) : testID === layout.root && rect.y >= geo.topBarBottom) ? shiftPt : 0;
      return { ...rect, y: rect.y + dy };
    };

    // Diff (full width, common height) with masks hatched.
    const common = Math.min(view.height, app.height);
    const width = Math.min(view.width, app.width);
    const d0 = crop(view, 0, 0, width, common);
    const a0 = crop(app, 0, 0, width, common);
    const diff = blank(width, common);
    pixelDiff(d0.data, a0.data, diff.data, width, common, { threshold: TOLERANCES.pixelDiffThreshold, ...DIFF_COLOURS });
    const maskRects = [
      ...(isPhone ? device.masks.map((m) => ({ x: m.x, y: m.y, w: m.width, h: m.height })) : []),
      ...layout.elements.filter((el) => el.mask && el.rect).map((el) => toView(el.rect, el.testID)),
      // A probed region the app draws itself, minus what is drawn over it.
      ...(runReport?.stats?.regionMask?.pieces ?? []),
    ];
    for (const m of maskRects) hatch(diff, Math.round(m.x * S), Math.round(m.y * S), Math.round(m.w * S), Math.round(m.h * S));
    const designMarked = cloneImage(design);
    const viewMarked = geo.tall ? cloneImage(view) : designMarked;
    const appMarked = cloneImage(app);
    const box = (img, rr, rgb) => outline(img, Math.round(rr.x * S), Math.round(rr.y * S), Math.round(rr.w * S), Math.round(rr.h * S), rgb, 6);
    for (const p of failing) {
      const vr = p.viewRect ?? toView(p.rect, p.testID);
      box(designMarked, p.rect, MAGENTA);
      if (viewMarked !== designMarked) box(viewMarked, vr, MAGENTA);
      box(appMarked, p.appRect ?? (p.testID && bounds.elements.get(p.testID)) ?? vr, MAGENTA);
      box(diff, vr, MAGENTA);
    }
    if (geo.tall) {
      // The body window this capture shows, on the full-height design.
      box(designMarked, { x: 0, y: geo.headerBottom - shiftPt, w: design.width / S, h: geo.bodyBottom - geo.headerBottom }, CYAN);
    }
    const files = {};
    const save = (name, img) => {
      const buf = encodeCompactPng(img);
      writeFileSync(join(dir, name), buf);
      files[name] = sha256(buf);
    };
    for (const name of ['sheet.png', ...Array.from({ length: 40 }, (_, i) => `zoom-${i + 1}.png`), ...Array.from({ length: 40 }, (_, i) => `eye-${i + 1}.png`)]) rmSync(join(dir, name), { force: true });
    // 1. Overview at 1 px per pt. Tall frames: design window | app | diff, then the full-height design.
    const panels = geo.tall ? [viewMarked, appMarked, diff, designMarked] : [designMarked, appMarked, diff];
    save('sheet.png', row(panels.map((img) => downscale(img, S))));
    // 2. Zoomed bands at 2x: design | app, about 220 pt tall each.
    const bandPt = 220;
    const bands = Math.ceil(common / S / bandPt);
    for (let i = 0; i < bands; i += 1) {
      const y = Math.round(i * bandPt * S);
      const h = Math.min(Math.round(bandPt * S), common - y);
      const half = (img) => {
        const c = crop(img, 0, y, img.width, h);
        return resample(c, Math.floor((c.width * 2) / S), Math.floor((c.height * 2) / S));
      };
      save(`zoom-${i + 1}.png`, row([half(viewMarked), half(appMarked)]));
    }
    // 3. Crops of failing elements at the capture scale with 4 pt of context.
    const cropDir = join(dir, 'crops');
    rmSync(cropDir, { recursive: true, force: true });
    const ctx = 4 * S;
    const seen = new Set();
    for (const p of failing) {
      if (!p.testID || seen.has(p.testID)) continue;
      seen.add(p.testID);
      // The design side comes from the window this capture shows, at the problem's screen rect, so a
      // scrolled capture shows the same element on both sides. A state card is a fragment, not a
      // screen: its design side is cut at the fragment's own coordinates, and the app side where the
      // app draws the element (a text run: its screen rect; anything else: its bounds).
      const isCard = layout.kind === 'state-card';
      const rr = isCard ? p.rect : (p.viewRect ?? toView(p.rect, p.testID));
      const ar = isCard
        ? (p.appRect ?? (p.rule === 'text-ink' ? p.viewRect : bounds.elements.get(p.testID)) ?? p.viewRect ?? rr)
        : (p.appRect ?? bounds.elements.get(p.testID) ?? rr);
      const w = Math.min(Math.round(rr.w * S) + 2 * ctx, 1400);
      const h = Math.min(Math.round(rr.h * S) + 2 * ctx, 1400);
      const dc = crop(view, Math.round(rr.x * S) - ctx, Math.round(rr.y * S) - ctx, w, h);
      const ac = crop(app, Math.round(ar.x * S) - ctx, Math.round(ar.y * S) - ctx, w, h);
      const dd = blank(w, h);
      pixelDiff(dc.data, ac.data, dd.data, w, h, { threshold: TOLERANCES.pixelDiffThreshold, ...DIFF_COLOURS });
      mkdirSync(cropDir, { recursive: true });
      save(`crops/${p.testID}.png`, row([dc, ac, dd]));
      report.note(`      crops/${p.testID}.png: design ${Math.round(rr.x)},${Math.round(rr.y)}${geo.tall ? ` of the window this capture shows (page y ${Math.round(p.rect.y)})` : ''} | app ${Math.round(ar.x)},${Math.round(ar.y)}`);
    }
    // 4. Eye-check pages: icons, logos, pictures (checks include "crop"), design | app at capture scale.
    // Crop-only texts are judged by their ink (text-ink gate); the eye pages keep to pictures.
    const isInkOnly = (el) => isCropOnly(el) && (el.role === 'text' || el.role === 'header');
    const eyes = layout.elements.filter((el) => el.rect && el.checks?.includes('crop') && !isInkOnly(el) && !el.mask && el.rect.w * el.rect.h > 0);
    const pairs = [];
    const pairIds = [];
    // A crop-only part is placed through its cover: the cover's measured offset applied to its box.
    const placedPart = (el) => {
      if (!isCropOnly(el)) return { a: bounds.elements.get(el.testID), key: el.testID };
      const coverId = el.coveredBy ?? el.parent;
      const cover = coverId ? layout.elements.find((c) => c.testID === coverId && c.rect) : null;
      const ca = coverId ? bounds.elements.get(coverId) : null;
      if (!cover || !ca) return { a: undefined, key: coverId };
      return { a: { x: el.rect.x + ca.x - cover.rect.x, y: el.rect.y + ca.y - cover.rect.y }, key: coverId };
    };
    for (const el of eyes) {
      const { a, key } = placedPart(el);
      if (!a) continue;
      // A tall frame's element partly hidden in this capture is paired in the capture that shows it whole.
      if (geo.tall && runReport && !(runReport.coverage ?? []).includes(key)) continue;
      pairIds.push(el.testID);
      const w = Math.min(Math.round(el.rect.w * S), 1100);
      const h = Math.min(Math.round(el.rect.h * S), 700);
      pairs.push(row([crop(design, Math.round(el.rect.x * S), Math.round(el.rect.y * S), w, h), crop(app, Math.round(a.x * S), Math.round(a.y * S), w, h)]));
    }
    let page = 0;
    const eyePages = [];
    for (let i = 0; i < pairs.length; ) {
      const group = [];
      const ids = [];
      let height = 0;
      while (i < pairs.length && (group.length === 0 || height + pairs[i].height <= 2400)) {
        height += pairs[i].height;
        group.push(pairs[i]);
        ids.push(pairIds[i]);
        i += 1;
      }
      page += 1;
      save(`eye-${page}.png`, stack(group));
      eyePages.push({ file: `eye-${page}.png`, testIDs: ids });
      report.note(`      eye-${page}.png, top to bottom (design | app): ${ids.join(', ')}`);
    }
    writeFileSync(join(dir, RUN_FILES.sheets), `${JSON.stringify({ version: 1, frame: r.info.frame, device: r.info.device, theme: r.info.theme, lang: r.info.lang, scrollY: r.info.scrollY, reportSha256: runReport ? sha256(readFileSync(reportPath)) : null, files, eyePages }, null, 1)}\n`);
    made += 1;
    report.note(`sheet ${show(join(dir, 'sheet.png'))}  (+ ${bands} zoom band${bands === 1 ? '' : 's'}, ${seen.size} failing-element crop${seen.size === 1 ? '' : 's'}, ${page} eye-check page${page === 1 ? '' : 's'} for ${pairs.length} element${pairs.length === 1 ? '' : 's'})`);
  }
  return report.finish({ checked: made || considered, unit: 'runs' });
});
