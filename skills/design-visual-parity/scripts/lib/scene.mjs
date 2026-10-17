// Self-test only: draws a design reference and app captures from one small scene description, so the
// fixtures stay a few hundred bytes of JSON instead of megabytes of PNG, and every planted defect is
// one JSON change (a patch) that the self-test renders at run time. Never used on a real app.
//
// scene.json (in a fixture repo):
//   { "frame": "tasks-default", "device": "test-phone", "kind": "phone" | "phone-tall" | "state-card",
//     "size": { "w", "h" } (page size, pt), "background": "#FFFFFF",
//     "palettes": { "dark": { "#FFFFFF": "#111418", ... } },          colours swapped for a dark render
//     "renders": [{ "theme": "light", "lang": "en" }, ...],           references written (default light-en)
//     "variant": "<id>" (optional: the reference is <frame>--<id>),
//     "elements": [{ "testID", "rect": [x, y, w, h], "fill", "border": { "w", "color", "style" },
//                    "shadow": [dx, dy, "#colour"], "rotate": deg, "label",
//                    "runs": [{ "text", "box": [x, y, w, h], "ink": [x, y, w, h], "color", "font" }] }],
//     "texts": [ free runs without an owner ],
//     "captures": [{ "theme", "lang", "scrollY", "dir", "patch": { ... } }] }  default: one per render
//   An RTL language (contract rtlLanguages) mirrors every x. A patch changes the app side only:
//     { "elements": { "<testID>": { "dx", "dy", "dw", "dh", "fill", "border", "runs", "runDx", "runDy",
//       "inkDw", "color", "remove", "unlisted", "undrawn", "label", "count" } }, "add": [elements],
//       "size": { "w", "h" } (capture pixels / scale), "statusBar": "#colour" (the OS clock in the status bar), "region": { rect },
//       "hier": "layout" | "none" (app.layout.json instead, or no bounds), "variant": "<id>" (run.json), "frame", "device",
//       "source": "<run.json source>" }
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseColor, sha256 } from '../check-lib.mjs';
import { contractMetadataOf, isCropOnly, loadParity, referenceFiles } from './contract.mjs';
import { encodeCompactPng } from './images.mjs';
import { runDirName } from './runs.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const rectOf = (r) => ({ x: r[0], y: r[1], w: r[2], h: r[3] });

function paintRect(img, scale, r, colour) {
  const c = parseColor(colour);
  const x0 = Math.max(0, Math.round(r.x * scale));
  const y0 = Math.max(0, Math.round(r.y * scale));
  const x1 = Math.min(img.width, Math.round((r.x + r.w) * scale));
  const y1 = Math.min(img.height, Math.round((r.y + r.h) * scale));
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) img.data.set(c, (y * img.width + x) * 4);
}

/** Glyph-like ink: vertical strokes two pixels wide with one-pixel gaps, filling the ink box. */
function paintInk(img, scale, r, colour) {
  const c = parseColor(colour);
  const x0 = Math.max(0, Math.round(r.x * scale));
  const y0 = Math.max(0, Math.round(r.y * scale));
  const x1 = Math.min(img.width, Math.round((r.x + r.w) * scale));
  const y1 = Math.min(img.height, Math.round((r.y + r.h) * scale));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if ((x - x0) % 3 === 2 && x !== x1 - 1) continue;
      img.data.set(c, (y * img.width + x) * 4);
    }
  }
}

function paintBorder(img, scale, r, border) {
  const w = border.w;
  const dashed = border.style === 'dashed';
  const sides = [
    { x: r.x, y: r.y, w: r.w, h: w },
    { x: r.x, y: r.y + r.h - w, w: r.w, h: w },
    { x: r.x, y: r.y, w, h: r.h },
    { x: r.x + r.w - w, y: r.y, w, h: r.h },
  ];
  for (const s of sides) {
    if (!dashed) {
      paintRect(img, scale, s, border.color);
      continue;
    }
    // A dash pattern of 4 pt on, 3 pt off, starting at the phase the border names.
    const horizontal = s.w > s.h;
    const length = horizontal ? s.w : s.h;
    for (let t = border.phase ?? 0; t < length; t += 7) {
      const on = Math.min(4, length - t);
      paintRect(img, scale, horizontal ? { x: s.x + t, y: s.y, w: on, h: s.h } : { x: s.x, y: s.y + t, w: s.w, h: on }, border.color);
    }
  }
}

function mapColour(colour, palette) {
  if (!colour) return colour;
  return palette?.[colour.toUpperCase()] ?? palette?.[colour] ?? colour;
}

/** The scene's elements for one render: colours through the theme palette, x mirrored for RTL. */
function placed(scene, { theme, rtl }) {
  const palette = theme === 'dark' ? scene.palettes?.dark : null;
  const W = scene.size.w;
  const mirror = (r) => (rtl ? [W - r[0] - r[2], r[1], r[2], r[3]] : [...r]);
  const run = (t) => ({ ...t, box: mirror(t.box), ink: mirror(t.ink ?? [t.box[0], t.box[1] + 1, t.box[2], t.box[3] - 2]), color: mapColour(t.color ?? '#000000', palette) });
  return {
    background: mapColour(scene.background ?? '#FFFFFF', palette),
    elements: scene.elements.map((el) => ({
      ...el,
      rect: mirror(el.rect),
      fill: mapColour(el.fill, palette),
      border: el.border ? { ...el.border, color: mapColour(el.border.color, palette) } : null,
      shadow: el.shadow ? [rtl ? -el.shadow[0] : el.shadow[0], el.shadow[1], mapColour(el.shadow[2], palette)] : null,
      runs: (el.runs ?? []).map(run),
    })),
    texts: (scene.texts ?? []).map(run),
  };
}

function draw({ width, height, scale, background, elements, texts, offsetOf = () => ({ dx: 0, dy: 0 }), clipOf = () => null }) {
  const img = { width, height, data: new Uint8Array(width * height * 4) };
  const bg = parseColor(background);
  for (let i = 0; i < width * height; i += 1) img.data.set(bg, i * 4);
  const shifted = (r, o) => ({ x: r[0] + o.dx, y: r[1] + o.dy, w: r[2], h: r[3] });
  for (const el of elements) {
    if (el.undrawn) continue;
    const o = offsetOf(el);
    const r = shifted(el.rect, o);
    const clip = clipOf(el);
    const target = clip ? { ...img, data: new Uint8Array(img.data) } : img;
    if (el.shadow) paintRect(target, scale, { x: r.x + el.shadow[0], y: r.y + el.shadow[1], w: r.w, h: r.h }, el.shadow[2]);
    if (el.border && el.fill) {
      paintRect(target, scale, r, el.fill);
      paintBorder(target, scale, r, el.border);
    } else if (el.border) paintBorder(target, scale, r, el.border);
    else if (el.fill) paintRect(target, scale, r, el.fill);
    for (const t of el.runs ?? []) paintInk(target, scale, { x: t.ink[0] + o.dx + (t.dx ?? 0), y: t.ink[1] + o.dy + (t.dy ?? 0), w: t.ink[2], h: t.ink[3] }, t.color);
    if (clip) {
      // Only the part of the element inside the clip band reaches the screen (a scrolling body).
      const y0 = Math.max(0, Math.round(clip.y0 * scale));
      const y1 = Math.min(img.height, Math.round(clip.y1 * scale));
      img.data.set(target.data.subarray(y0 * width * 4, y1 * width * 4), y0 * width * 4);
    }
  }
  for (const t of texts) paintInk(img, scale, { x: t.ink[0], y: t.ink[1], w: t.ink[2], h: t.ink[3] }, t.color);
  return img;
}

const px = (v) => `${Math.round(v * 100) / 100}px`;

function layoutOf(scene, render, device, parity, variant) {
  const p = placed(scene, render);
  const meta = new Map((parity.frames.get(scene.frame)?.elements ?? []).map((el) => [el.testID, el]));
  const elements = p.elements.map((el) => {
    const r = rectOf(el.rect);
    const text = (el.runs ?? []).map((t) => t.text).join(' ');
    return {
      testID: el.testID,
      count: 1,
      rect: r,
      box: { w: r.w, h: r.h, rotate: el.rotate ?? 0 },
      text,
      aria: el.label ?? null,
      style: {
        fill: el.fill ?? null,
        color: el.runs?.[0]?.color ?? null,
        border: el.border ? `${px(el.border.w)} ${el.border.style ?? 'solid'} ${el.border.color}` : null,
        radius: '0px',
        shadow: el.shadow ? `${el.shadow[2]} ${px(el.shadow[0])} ${px(el.shadow[1])} 0px 0px` : null,
        outline: null,
        font: el.runs?.[0]?.font ?? '400 14px Demo Sans',
      },
      ...(meta.get(el.testID) ? contractMetadataOf(meta.get(el.testID)) : {}),
    };
  });
  const texts = [];
  for (const el of p.elements) for (const t of el.runs ?? []) texts.push({ text: t.text, x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3], owner: el.testID, font: t.font ?? '400 14px Demo Sans' });
  for (const t of p.texts) texts.push({ text: t.text, x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3], owner: t.owner ?? null, font: t.font ?? '400 14px Demo Sans' });
  return {
    version: 1,
    frame: scene.frame,
    variant: variant ?? null,
    kind: scene.kind ?? 'phone',
    root: parity.frames.get(scene.frame)?.root ?? null,
    device: device.id,
    theme: render.theme,
    lang: render.lang,
    scale: device.scale,
    size: { w: scene.size.w, h: scene.size.h },
    image: `${scene.frame}${variant ? `--${variant}` : ''}.png`,
    elements,
    texts,
  };
}

function applyPatch(elements, patch) {
  const out = [];
  for (const base of elements) {
    const change = patch.elements?.[base.testID];
    if (!change) {
      out.push(clone(base));
      continue;
    }
    if (change.remove) continue;
    const el = clone(base);
    const [x, y, w, h] = el.rect;
    el.rect = [x + (change.dx ?? 0), y + (change.dy ?? 0), w + (change.dw ?? 0), h + (change.dh ?? 0)];
    if ('fill' in change) el.fill = change.fill;
    if ('border' in change) el.border = change.border;
    if ('label' in change) el.label = change.label;
    if (change.runs) el.runs = change.runs;
    for (const t of el.runs ?? []) {
      t.ink = t.ink ?? [t.box[0], t.box[1] + 1, t.box[2], t.box[3] - 2];
      t.ink = [t.ink[0] + (change.dx ?? 0) + (change.runDx ?? 0), t.ink[1] + (change.dy ?? 0) + (change.runDy ?? 0), t.ink[2] + (change.inkDw ?? 0), t.ink[3]];
      if (change.color) t.color = change.color;
    }
    el.unlisted = change.unlisted === true;
    el.undrawn = change.undrawn === true;
    el.count = change.count ?? 1;
    out.push(el);
  }
  for (const add of patch.add ?? []) out.push(clone(add));
  return out;
}

/**
 * Write the references and the captures one scene describes into a fixture repo (root). Returns the
 * run folders written (absolute).
 */
export function buildScene(root, sceneFile = 'scene.json') {
  const path = join(root, sceneFile);
  if (!existsSync(path)) return [];
  const scene = JSON.parse(readFileSync(path, 'utf8'));
  const parity = loadParity(root, { strict: false });
  if (parity.missing || parity.broken) return [];
  const device = parity.devices.get(scene.device);
  if (!device) throw new Error(`scene: device ${scene.device} is not in the contract`);
  const S = device.scale;
  const renders = scene.renders ?? [{ theme: 'light', lang: 'en' }];
  const variant = scene.variant ?? null;
  for (const render of renders) {
    const rtl = parity.rtl.has(render.lang);
    const p = placed(scene, { ...render, rtl });
    const img = draw({ width: Math.round(scene.size.w * S), height: Math.round(scene.size.h * S), scale: S, ...p });
    const files = referenceFiles(parity, { device: device.id, theme: render.theme, lang: render.lang, frame: scene.frame, variant });
    mkdirSync(join(root, files.dir), { recursive: true });
    writeFileSync(join(root, files.image), encodeCompactPng(img));
    writeFileSync(join(root, files.layout), `${JSON.stringify(layoutOf(scene, { ...render, rtl }, device, parity, variant))}\n`);
  }
  const captures = scene.captures ?? renders.map((r) => ({ theme: r.theme, lang: r.lang }));
  const frame = parity.frames.get(scene.frame);
  const fixedHeader = Number(parity.contract.layout?.fixedHeaderPt ?? 0);
  const pinnedComponents = parity.contract.layout?.pinnedComponents ?? [];
  const written = [];
  for (const capture of captures) {
    const patch = capture.patch ?? {};
    const rtl = parity.rtl.has(capture.lang);
    const p = placed(scene, { theme: capture.theme, lang: capture.lang, rtl });
    const elements = applyPatch(p.elements, patch);
    const scrollY = capture.scrollY ?? 0;
    const viewW = patch.size?.w ?? device.points.width;
    const viewH = patch.size?.h ?? device.points.height;
    const tall = scene.kind === 'phone-tall';
    const topBar = device.safeArea.top + fixedHeader;
    const metaOf = (id) => frame?.elements.find((el) => el.testID === id) ?? null;
    const pinnedBoxes = tall ? scene.elements.filter((el) => pinnedComponents.includes(metaOf(el.testID)?.component)).map((el) => el.rect) : [];
    const inBox = (r, b) => r[0] >= b[0] - 0.5 && r[1] >= b[1] - 0.5 && r[0] + r[2] <= b[0] + b[2] + 0.5 && r[1] + r[3] <= b[1] + b[3] + 0.5;
    const pinned = (el) => tall && pinnedBoxes.some((b) => inBox(scene.elements.find((d) => d.testID === el.testID)?.rect ?? el.rect, b));
    const pinShift = viewH - scene.size.h;
    const isRoot = (el) => el.testID === frame?.root;
    const inBody = (el) => tall && !isRoot(el) && !pinned(el) && el.rect[1] >= topBar;
    const offsetOf = (el) => (pinned(el) ? { dx: 0, dy: pinShift } : inBody(el) ? { dx: 0, dy: -scrollY } : { dx: 0, dy: 0 });
    const pinnedTops = elements.filter(pinned).map((el) => el.rect[1] + pinShift);
    const headerEls = tall ? elements.filter((el) => !isRoot(el) && !pinned(el) && el.rect[1] < topBar && el.rect[3] < viewH) : [];
    const headerBottom = tall ? Math.max(topBar, ...headerEls.map((el) => el.rect[1] + el.rect[3])) : 0;
    const bodyBottom = tall && pinnedTops.length ? Math.min(...pinnedTops) : viewH;
    const clipOf = (el) => (inBody(el) ? { y0: headerBottom, y1: bodyBottom } : null);
    // Body first (clipped to its window), then the fixed header and the pinned parts on top.
    const order = [...elements.filter((el) => isRoot(el)), ...elements.filter(inBody), ...elements.filter((el) => !isRoot(el) && !inBody(el))];
    const img = draw({ width: Math.round(viewW * S), height: Math.round(viewH * S), scale: S, background: p.background, elements: order, texts: p.texts, offsetOf, clipOf });
    if (patch.statusBar !== null) {
      // The OS draws its own status bar (masked by the device profile): the capture never matches the design there.
      const bar = device.masks[0];
      if (bar) paintRect(img, S, { x: bar.x + 8, y: bar.y + 4, w: 24, h: Math.max(1, bar.height - 8) }, patch.statusBar ?? '#202020');
    }
    const dir = join(root, capture.dir ?? join(parity.paths.runs, device.id, patch.frame ?? scene.frame, runDirName(capture.theme, capture.lang, scrollY)));
    mkdirSync(dir, { recursive: true });
    const png = encodeCompactPng(img);
    writeFileSync(join(dir, 'app.png'), png);
    const nodes = [];
    for (const el of elements) {
      if (el.unlisted) continue;
      const meta = metaOf(el.testID);
      if (meta && isCropOnly(meta)) continue;
      const o = offsetOf(el);
      const r = { x: el.rect[0] + o.dx, y: el.rect[1] + o.dy, w: el.rect[2], h: el.rect[3] };
      if (inBody(el) && (r.y >= bodyBottom - 8 || r.y + r.h <= headerBottom + 8)) continue;
      const label = el.label ?? (el.runs ?? []).map((t) => t.text).join(' ');
      for (let k = 0; k < (el.count ?? 1); k += 1) {
        if (patch.hier === 'layout') nodes.push({ testID: el.testID, x: r.x, y: r.y, w: r.w, h: r.h, text: label });
        else {
          const unit = device.platform === 'android' ? S : 1;
          const b = `[${Math.floor(r.x * unit)},${Math.floor(r.y * unit)}][${Math.floor((r.x + r.w) * unit)},${Math.floor((r.y + r.h) * unit)}]`;
          nodes.push({ attributes: { 'resource-id': el.testID, accessibilityText: label, bounds: b }, children: [] });
        }
      }
    }
    if (patch.hier === 'layout') writeFileSync(join(dir, 'app.layout.json'), `${JSON.stringify({ elements: nodes })}\n`);
    else if (patch.hier !== 'none') writeFileSync(join(dir, 'app.hier.json'), `${JSON.stringify({ attributes: { 'resource-id': '', bounds: '[0,0][0,0]' }, children: [{ attributes: { accessibilityText: '9:41', 'resource-id': '', bounds: '[10,2][40,14]' }, children: [] }, ...nodes] })}\n`);
    const info = {
      version: 1,
      frame: patch.frame ?? scene.frame,
      variant: patch.variant !== undefined ? patch.variant : variant,
      device: patch.device ?? device.id,
      platform: device.platform,
      kind: scene.kind ?? 'phone',
      theme: capture.theme,
      lang: capture.lang,
      scrollY,
      bundleId: 'com.example.tasks.preview',
      source: patch.source ?? 'capture-app',
      ...(patch.region ? { region: { rect: patch.region, source: 'probe' } } : {}),
      capturedAt: '2026-10-01T09:41:00.000Z',
      appSha256: sha256(png),
    };
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify(info, null, 1)}\n`);
    written.push(dir);
  }
  return written;
}

/** Build every scene of a fixture repo: scene.json and scenes/*.json. Returns the run folders. */
export function buildScenes(root) {
  const files = [];
  if (existsSync(join(root, 'scene.json'))) files.push('scene.json');
  if (existsSync(join(root, 'scenes'))) for (const name of readdirSync(join(root, 'scenes')).sort()) if (name.endsWith('.json')) files.push(`scenes/${name}`);
  return files.flatMap((file) => buildScene(root, file));
}

/** Write a file under root (parents made); for self-test helpers. */
export function writeInto(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
