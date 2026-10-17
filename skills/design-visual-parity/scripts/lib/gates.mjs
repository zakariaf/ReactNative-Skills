// The parity gates: per-element checks, keyed by testID, between a design reference (a browser
// render of the mockup plus its layout.json) and an app capture (a simulator or emulator screenshot
// plus element bounds). Every tolerance below is measured, not chosen (2026-09-28, iPhone 16 Pro
// simulator on iOS 26.5, a Release React Native 0.86.3 build, against Chrome 153 on macOS, the same
// TTF files on both sides):
//   correct builds: geometry <= 0.9 pt off the DOM rects, fills identical (delta 0), text ink boxes
//   <= 0.3 pt, ink centroids per type role up to the role's measured floor (CoreText vs Chrome glyph
//   placement; the app's floors live in contracts/visual-parity.json textRoleFloors), Maestro bounds
//   floored to whole points (up to 1 pt; text-ink anchors on pixel-measured edges instead);
//   planted defects: fill delta 16 (one token off), bold -> regular label (ink width -13 pt), panel
//   padding 14 -> 12 (height -3.8 pt), border 3 -> 2 (moved -3.6 pt), weight 700 -> 600 (ink width
//   -2.3 pt), size 17 -> 16 (ink width -8 pt).
// Whole-screen pixel-difference percentages and SSIM are reported only: correct builds scored
// 0.13-0.51 % and SSIM 0.983-0.995, overlapping real defects. Never widen these numbers to make a
// screen pass; the self-test has fixtures on both sides of each boundary and fails if they move.
// Android (emulator at a whole density ratio) uses the same numbers; they were measured on iOS only.
import { isCropOnly } from './contract.mjs';
import { hex } from './images.mjs';
import { pixelDiff } from './pixel-diff.mjs';

export const TOLERANCES = Object.freeze({
  boundsPt: 2,
  fillChannelDelta: 3,
  borderPt: 0.5,
  inkSizePt: 1,
  inkCentrePt: 2,
  layoutNoisePt: 0.9,
  blobThicknessPt: 1.5,
  blobMinPixels: 24,
  alignSearchPx: 6,
  pixelDiffThreshold: 0.1,
  textPadPt: 2,
  inkPadPt: 2,
  inkDistance: 96,
  inkSearchPx: 12,
  anchorReachPt: Object.freeze([12, 36]),
  anchorEdgeLuma: 24,
  anchorMinEdgePt: 3,
  fillInsetPt: 2,
  minVisiblePt: 8,
});

/**
 * Per type-role centre floors of the text-ink gate: how far the platform's text engine puts a role's
 * glyphs from where Chrome puts them inside the same box (the larger of |dx| and |dy| of the ink
 * centre, pt), measured with the type-role probe (references/what-exact-means.md) and written into
 * contracts/visual-parity.json textRoleFloors as { "<family>": { "<size>": { "floor", "probe" } } }.
 * A run's centre limit is max(inkCentrePt, floor + layoutNoisePt): the general 2 pt tolerance, or the
 * role's own floor plus the 0.9 pt a correct text box sits off its design box, whichever is larger.
 * A size the probe did not cover takes the largest floor of its family; an unknown family keeps 2 pt.
 */
export function textRoleFloor(font, floors = {}) {
  const m = /^\s*(\d+)\s+([\d.]+)px(?:\/[\d.]+px)?\s+(.+?)\s*$/.exec(String(font ?? ''));
  const family = m ? m[3] : null;
  const size = m ? Math.round(Number(m[2])) : null;
  const table = family ? floors[family] : undefined;
  if (!table || Object.keys(table).length === 0) return { role: family ? `${family} ${size} (no measured floor)` : 'unknown font', floorPt: null, centrePt: TOLERANCES.inkCentrePt };
  const value = (entry) => (typeof entry === 'number' ? entry : entry.floor);
  const probed = table[String(size)];
  const floorPt = probed !== undefined ? value(probed) : Math.max(...Object.values(table).map(value));
  const centrePt = Math.max(TOLERANCES.inkCentrePt, Math.ceil((floorPt + TOLERANCES.layoutNoisePt) * 10 - 1e-9) / 10);
  return { role: `${family} ${size}${probed === undefined ? ' (not probed: family maximum)' : ''}`, floorPt, centrePt };
}

const RULE_ORDER = ['capture-size', 'screen-not-reached', 'scroll-mismatch', 'duplicate-testid', 'missing', 'bounds', 'text', 'fill', 'border', 'text-ink', 'structure'];

/**
 * The layout facts a frame's geometry needs, from contracts/visual-parity.json "layout":
 *   fixedHeaderPt     the header that stays put (below the safe area) while a tall frame's body
 *                     scrolls under it (an Expo Router Stack header, a custom top bar);
 *   pinnedComponents  components the app pins to the bottom of the screen while the design draws them
 *                     at the end of the full scroll height (a banner slot, a bottom action bar);
 *   dialogComponents  dialog cards that hide the screen drawn behind them (text there is not
 *                     ink-checked where the card covers it).
 */
export function layoutFactsOf(contract) {
  const layout = contract?.layout ?? {};
  return {
    fixedHeaderPt: Number.isFinite(layout.fixedHeaderPt) ? layout.fixedHeaderPt : 0,
    pinnedComponents: Array.isArray(layout.pinnedComponents) ? layout.pinnedComponents : [],
    dialogComponents: Array.isArray(layout.dialogComponents) ? layout.dialogComponents : [],
  };
}

/**
 * How a tall frame (the design shows the full scroll height) maps onto one app screen:
 *   fixed header  elements above topBarBottom never move (the header, a hazard strip);
 *   body          scrolls under the header and is visible only between headerBottom and bodyBottom;
 *   pinned        (a banner, a bottom bar) sits at the bottom of the screen: design y + pinShift.
 * For other frames everything is fixed and the body window is the whole screen.
 */
export function frameGeometry(layout, device, facts = layoutFactsOf(null)) {
  const viewH = device.points.height;
  const topBarBottom = device.safeArea.top + facts.fixedHeaderPt;
  const tall = layout.kind === 'phone-tall';
  const els = (layout.elements ?? []).filter((el) => el.count === 1 && el.rect);
  // A pinned component and everything drawn inside it (a bottom bar and its button) move together.
  const pinnedRoots = tall ? els.filter((el) => facts.pinnedComponents.includes(el.component)) : [];
  const within = (el, box) => el.rect.x >= box.rect.x - 0.5 && el.rect.y >= box.rect.y - 0.5 && el.rect.x + el.rect.w <= box.rect.x + box.rect.w + 0.5 && el.rect.y + el.rect.h <= box.rect.y + box.rect.h + 0.5;
  const pinned = new Set(els.filter((el) => el.testID !== layout.root && pinnedRoots.some((box) => within(el, box))).map((el) => el.testID));
  const pinShift = tall ? viewH - (layout.size?.h ?? viewH) : 0;
  const header = els.filter((el) => el.testID !== layout.root && !pinned.has(el.testID) && el.rect.y < topBarBottom && el.rect.h < viewH);
  const headerBottom = tall ? Math.max(topBarBottom, ...header.map((el) => el.rect.y + el.rect.h)) : 0;
  const pinnedTops = els.filter((el) => pinned.has(el.testID)).map((el) => el.rect.y + pinShift);
  const bodyBottom = tall && pinnedTops.length ? Math.min(...pinnedTops) : viewH;
  const isPinned = (el) => pinned.has(el.testID);
  const inBody = (el) => tall && el.testID !== layout.root && !isPinned(el) && el.rect.y >= topBarBottom;
  return { tall, viewH, topBarBottom, headerBottom, bodyBottom, pinShift, pinned, isPinned, inBody };
}

/**
 * Scroll offsets (pt) for the captures of a tall frame: 0, then as few offsets as needed so that
 * every body element that fits in the body window is fully on screen in at least one capture, then
 * the end of the scroll. A partly hidden element is only partly compared, so full visibility is
 * what check-signoff's coverage rule demands.
 */
export function scrollPlan(layout, device, facts = layoutFactsOf(null)) {
  const g = frameGeometry(layout, device, facts);
  if (!g.tall) return [0];
  const maxScroll = Math.max(0, Math.round((layout.size?.h ?? g.viewH) - g.viewH));
  const windowH = g.bodyBottom - g.headerBottom;
  const offsets = [0];
  const shows = (el, s) => el.rect.y - s >= g.headerBottom - 0.5 && el.rect.y + el.rect.h - s <= g.bodyBottom + 0.5;
  const body = layout.elements.filter((el) => el.count === 1 && el.rect && g.inBody(el) && el.rect.h <= windowH - 1).sort((p, q) => p.rect.y - q.rect.y);
  for (const el of body) {
    if (offsets.some((s) => shows(el, s))) continue;
    offsets.push(Math.min(maxScroll, Math.max(0, Math.floor(el.rect.y - g.headerBottom - 8))));
  }
  if (!offsets.includes(maxScroll)) offsets.push(maxScroll);
  return [...new Set(offsets)].sort((p, q) => p - q);
}

const round1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const signed = (v) => `${v >= 0 ? '+' : ''}${round1(v)}`;
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner, outer, slack = 0) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;
const pad = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const shift = (r, dx, dy) => ({ ...r, x: r.x + dx, y: r.y + dy });

function inAny(x, y, rects) {
  for (const r of rects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  return false;
}

/**
 * The area an element paints: its box plus hard shadows, die-cut rings (box-shadow spread) and a
 * focus outline, all read from the design's computed style.
 */
export function extentOf(el) {
  const r = el.rect;
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.w;
  let y1 = r.y + r.h;
  for (const m of String(el.style?.shadow ?? '').matchAll(/(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px(?: (-?[\d.]+)px)?/g)) {
    const [ox, oy, blur, spread = 0] = m.slice(1).map((v) => Number(v ?? 0));
    const grow = blur + Math.max(0, spread);
    x0 = Math.min(x0, r.x + ox - grow);
    y0 = Math.min(y0, r.y + oy - grow);
    x1 = Math.max(x1, r.x + r.w + ox + grow);
    y1 = Math.max(y1, r.y + r.h + oy + grow);
  }
  const o = /([\d.]+)px \w+ offset (-?[\d.]+)px/.exec(String(el.style?.outline ?? ''));
  if (o) {
    const grow = Number(o[1]) + Math.max(0, Number(o[2]));
    x0 = Math.min(x0, r.x - grow);
    y0 = Math.min(y0, r.y - grow);
    x1 = Math.max(x1, r.x + r.w + grow);
    y1 = Math.max(y1, r.y + r.h + grow);
  }
  if (el.box?.rotate) {
    // A rotated element's bounding box already includes its corners; add a little for its ring.
    x0 -= 1;
    y0 -= 1;
    x1 += 1;
    y1 += 1;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Luminance plane (0..255) for fast alignment. */
export function lumaOf(img) {
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) out[i] = (img.data[p] * 77 + img.data[p + 1] * 150 + img.data[p + 2] * 29) >> 8;
  return out;
}

/** Most frequent colour inside rect (pt) inset by `inset` pt, skipping excluded rects (pt). */
export function modeColour(img, rect, scale, inset, exclude) {
  const counts = new Map();
  const x0 = Math.max(0, Math.ceil((rect.x + inset) * scale));
  const y0 = Math.max(0, Math.ceil((rect.y + inset) * scale));
  const x1 = Math.min(img.width, Math.floor((rect.x + rect.w - inset) * scale));
  const y1 = Math.min(img.height, Math.floor((rect.y + rect.h - inset) * scale));
  const area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const step = area > 400000 ? 3 : area > 100000 ? 2 : 1;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      if (inAny(x / scale, y / scale, exclude)) continue;
      const i = (y * img.width + x) * 4;
      const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best === null ? null : [(best >> 16) & 255, (best >> 8) & 255, best & 255];
}

/** Most frequent colour on the edge ring of a pixel window (the local background of a text run). */
function ringColour(img, bx, by, ex, ey) {
  const ring = new Map();
  const add = (x, y) => {
    const i = (y * img.width + x) * 4;
    const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
    ring.set(key, (ring.get(key) ?? 0) + 1);
  };
  for (let x = bx; x < ex; x += 1) {
    add(x, by);
    add(x, ey - 1);
  }
  for (let y = by; y < ey; y += 1) {
    add(bx, y);
    add(ex - 1, y);
  }
  let bg = 0;
  let bgCount = -1;
  for (const [key, count] of ring) {
    if (count > bgCount) {
      bg = key;
      bgCount = count;
    }
  }
  return [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255];
}

/** A window in pt as clipped pixel bounds, or null when it is (almost) empty. */
function windowPx(img, rect, scale, padPt) {
  const bx = Math.max(0, Math.floor((rect.x - padPt) * scale));
  const by = Math.max(0, Math.floor((rect.y - padPt) * scale));
  const ex = Math.min(img.width, Math.ceil((rect.x + rect.w + padPt) * scale));
  const ey = Math.min(img.height, Math.ceil((rect.y + rect.h + padPt) * scale));
  return ex - bx < 2 || ey - by < 2 ? null : { bx, by, ex, ey };
}

/**
 * Ink box of a text run, the old way: pixels far from the window's most common edge colour. Kept for
 * runs whose text colour cannot be read (no solid glyph pixel in the design). Coordinates in pt.
 */
export function inkBox(img, rect, scale, padPt, distance) {
  const win = windowPx(img, rect, scale, padPt);
  if (!win) return null;
  const { bx, by, ex, ey } = win;
  const [br, bgG, bb] = ringColour(img, bx, by, ex, ey);
  let n = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let x1 = -1;
  let y0 = Infinity;
  let y1 = -1;
  for (let y = by; y < ey; y += 1) {
    for (let x = bx; x < ex; x += 1) {
      const i = (y * img.width + x) * 4;
      if (Math.abs(img.data[i] - br) + Math.abs(img.data[i + 1] - bgG) + Math.abs(img.data[i + 2] - bb) > distance) {
        n += 1;
        sx += x;
        sy += y;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (n === 0) return null;
  return { n, cx: sx / n / scale, cy: sy / n / scale, w: (x1 - x0 + 1) / scale, h: (y1 - y0 + 1) / scale };
}

const colourGap = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Candidate text colours of a run in the design image: the owner's computed CSS colour (the layout
 * records colour per element, not per run) when solid pixels of it are inside the run's box, and the
 * most frequent colour among the pixels far from the run's background (at 3x every glyph stroke has
 * solid interior pixels). The gate keeps the candidate that leaves the most glyph ink: a sticker's
 * paper or a badge's border outnumbers the glyphs but touches the window edge and is dropped.
 * Returns [] for a run with no solid ink.
 */
export function runTextColours(img, rect, scale, padPt, distance, cssColour = null) {
  const win = windowPx(img, rect, scale, padPt);
  if (!win) return [];
  const bg = ringColour(img, win.bx, win.by, win.ex, win.ey);
  const inner = windowPx(img, rect, scale, 0);
  if (!inner) return [];
  const counts = new Map();
  for (let y = inner.by; y < inner.ey; y += 1) {
    for (let x = inner.bx; x < inner.ex; x += 1) {
      const i = (y * img.width + x) * 4;
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (colourGap(c, bg) <= distance) continue;
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  const candidates = [];
  const css = /^#([0-9A-F]{6})$/.exec(String(cssColour ?? ''));
  if (css) {
    const c = [0, 2, 4].map((k) => parseInt(css[1].slice(k, k + 2), 16));
    let near = 0;
    for (const [key, count] of counts) if (colourGap([(key >> 16) & 255, (key >> 8) & 255, key & 255], c) <= 24) near += count;
    if (near >= 3) candidates.push(c);
  }
  if (best !== null && bestCount >= 3) {
    const mode = [(best >> 16) & 255, (best >> 8) & 255, best & 255];
    if (!candidates.some((c) => colourGap(c, mode) <= 24)) candidates.push(mode);
  }
  return candidates;
}

/**
 * The line box of a rotated run. The layout's run rect is the axis-aligned box of the rotated line
 * (getClientRects); inverting it gives the line's own size, centred on the same point.
 */
export function rotatedCore(rect, degrees) {
  if (!degrees) return null;
  const rad = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const det = c * c - s * s;
  if (det <= 0.2) return null;
  const w = (rect.w * c - rect.h * s) / det;
  const h = (rect.h * c - rect.w * s) / det;
  if (!(w > 0) || !(h > 0)) return null;
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, hw: w / 2, hh: h / 2, cos: Math.cos(rad), sin: Math.sin(rad) };
}

/** The part of a pixel window inside a clip rectangle (pt), or null when nothing is left. */
function clipWindow(win, clip, scale, padPt) {
  if (!clip) return win;
  const bx = Math.max(win.bx, Math.floor((clip.x - padPt) * scale));
  const by = Math.max(win.by, Math.floor((clip.y - padPt) * scale));
  const ex = Math.min(win.ex, Math.ceil((clip.x + clip.w + padPt) * scale));
  const ey = Math.min(win.ey, Math.ceil((clip.y + clip.h + padPt) * scale));
  return ex - bx < 2 || ey - by < 2 ? null : { bx, by, ex, ey };
}

/**
 * Ink box of a text run, measured by its text colour (coordinates in pt):
 *   - a pixel is ink when its colour lies on the way from the window's background to the text
 *     colour, past halfway (so a sticker's yellow paper or a sky gradient is never ink);
 *   - a rotated run keeps only pixels inside its rotated line box (core, from rotatedCore);
 *   - the window is clipped to the owner element's box (limits.clip, plus the pad): Chrome gives a
 *     an Arabic-script run a line box 1.5625 em tall, which reaches into the element below it;
 *   - ink components that touch the window's edge belong to something larger than the text (a
 *     segment's border and corner, a sticker's edge, a neighbouring line) and are dropped, and so
 *     are components whose centre lies in another element's text box outside the owner's box
 *     (limits.foreign: the dots of the label under an Arabic-script value).
 * Returns null when no ink is left.
 */
export function inkBoxByColour(img, rect, scale, padPt, fg, core = null, limits = null) {
  const win = clipWindow(windowPx(img, rect, scale, padPt), limits?.clip ?? null, scale, padPt);
  if (!win) return null;
  const { bx, by, ex, ey } = win;
  const bg = ringColour(img, bx, by, ex, ey);
  const d = [fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (dd < 48 * 48) return null;
  const maxResidual = Math.max(40, 0.3 * Math.sqrt(dd));
  const w = ex - bx;
  const h = ey - by;
  const ink = new Uint8Array(w * h);
  const coreIn = core
    ? (x, y) => {
        const px = (x + 0.5) / scale - core.cx;
        const py = (y + 0.5) / scale - core.cy;
        const u = px * core.cos + py * core.sin;
        const v = -px * core.sin + py * core.cos;
        return Math.abs(u) <= core.hw + padPt && Math.abs(v) <= core.hh + padPt;
      }
    : null;
  for (let y = by; y < ey; y += 1) {
    for (let x = bx; x < ex; x += 1) {
      const i = (y * img.width + x) * 4;
      const v0 = img.data[i] - bg[0];
      const v1 = img.data[i + 1] - bg[1];
      const v2 = img.data[i + 2] - bg[2];
      const t = (v0 * d[0] + v1 * d[1] + v2 * d[2]) / dd;
      if (t < 0.5) continue;
      const r0 = v0 - t * d[0];
      const r1 = v1 - t * d[1];
      const r2 = v2 - t * d[2];
      if (Math.sqrt(r0 * r0 + r1 * r1 + r2 * r2) > maxResidual) continue;
      if (coreIn && !coreIn(x, y)) continue;
      ink[(y - by) * w + (x - bx)] = 1;
    }
  }
  // Drop components that reach the edge of the measured area (the window, or the rotated line box
  // inside it): they continue outside it, so they are not glyphs (8-neighbour flood fill).
  const stack = [];
  const clear = (x, y) => {
    const k = y * w + x;
    if (ink[k] !== 1) return;
    ink[k] = 0;
    stack.push(k);
  };
  for (let x = 0; x < w; x += 1) {
    clear(x, 0);
    clear(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    clear(0, y);
    clear(w - 1, y);
  }
  if (coreIn) {
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        if (ink[y * w + x] !== 1) continue;
        let atEdge = false;
        for (let dy = -1; dy <= 1 && !atEdge; dy += 1) for (let dx = -1; dx <= 1 && !atEdge; dx += 1) atEdge = !coreIn(bx + x + dx, by + y + dy);
        if (atEdge) clear(x, y);
      }
    }
  }
  while (stack.length) {
    const k = stack.pop();
    const x = k % w;
    const y = (k / w) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) clear(xx, yy);
      }
    }
  }
  if (limits?.foreign?.length) dropForeignComponents(ink, w, h, { bx, by, scale, clip: limits.clip ?? null, foreign: limits.foreign });
  let n = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let x1 = -1;
  let y0 = Infinity;
  let y1 = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!ink[y * w + x]) continue;
      n += 1;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (n === 0) return null;
  return { n, cx: (bx + sx / n) / scale, cy: (by + sy / n) / scale, w: (x1 - x0 + 1) / scale, h: (y1 - y0 + 1) / scale };
}

/**
 * Clears the ink components (8-neighbour) whose centre lies in another element's text box (pt) and
 * outside the owner's box: glyph parts of a neighbour, never of the run.
 */
function dropForeignComponents(ink, w, h, { bx, by, scale, clip, foreign }) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const members = [];
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  for (let i = 0; i < w * h; i += 1) {
    if (!ink[i] || seen[i]) continue;
    members.length = 0;
    let sx = 0;
    let sy = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop();
      members.push(k);
      const x = k % w;
      const y = (k / w) | 0;
      sx += x;
      sy += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (ink[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const cx = (bx + sx / members.length + 0.5) / scale;
    const cy = (by + sy / members.length + 0.5) / scale;
    if ((clip && inRect(cx, cy, clip)) || !foreign.some((r) => inRect(cx, cy, r))) continue;
    for (const k of members) ink[k] = 0;
  }
}

/**
 * Best integer pixel offset (ox, oy) that aligns the app window with the design window, by the sum
 * of absolute luma differences. Small searches are exhaustive; larger ones go coarse (step 3) and
 * then fine (+-2 around the coarse best). Ties go to the offset closest to the expected position.
 * range { x0, x1, y0, y1 } (px, inclusive) replaces the symmetric search when given.
 */
export function alignOffset(dL, dW, aL, aW, aH, crop, origin, search, ignore = null, range = null) {
  const samples = crop.w * crop.h;
  const stride = Math.max(1, Math.round(Math.sqrt(samples / 20000)));
  const sadAt = (ox, oy, limit) => {
    let sad = 0;
    for (let y = 0; y < crop.h && sad < limit; y += stride) {
      const ay = origin.y + oy + y;
      // A sample off the app screen costs the maximum, unless it is ignored anyway.
      const offScreen = ay < 0 || ay >= aH;
      const drow = (crop.y + y) * dW + crop.x;
      const arow = ay * aW + origin.x + ox;
      for (let x = 0; x < crop.w; x += stride) {
        if (ignore && ignore[y * crop.w + x]) continue;
        if (offScreen) {
          sad += 255;
          continue;
        }
        const ax = origin.x + ox + x;
        sad += Math.abs(dL[drow + x] - (ax < 0 || ax >= aW ? 0 : aL[arow + x]));
      }
    }
    return sad;
  };
  let best = { ox: 0, oy: 0, sad: Infinity };
  const consider = (ox, oy) => {
    const sad = sadAt(ox, oy, best.sad + 1);
    if (sad < best.sad || (sad === best.sad && Math.abs(ox) + Math.abs(oy) < Math.abs(best.ox) + Math.abs(best.oy))) best = { ox, oy, sad };
  };
  if (range) {
    for (let oy = range.y0; oy <= range.y1; oy += 1) for (let ox = range.x0; ox <= range.x1; ox += 1) consider(ox, oy);
    return best;
  }
  if (search <= 6) {
    for (let oy = -search; oy <= search; oy += 1) for (let ox = -search; ox <= search; ox += 1) consider(ox, oy);
    return best;
  }
  for (let oy = -search; oy <= search; oy += 3) for (let ox = -search; ox <= search; ox += 3) consider(ox, oy);
  const coarse = { ...best };
  for (let oy = coarse.oy - 2; oy <= coarse.oy + 2; oy += 1) for (let ox = coarse.ox - 2; ox <= coarse.ox + 2; ox += 1) consider(ox, oy);
  return best;
}

/**
 * Connected components (8-neighbour) of a hot mask. Each blob also gets its thickness: the side of
 * the largest all-hot square inside it, so a long 1 px sliver along a rounded corner stays thin while
 * a real band (a missing border, a moved edge, a wrong icon) is thick.
 */
export function blobsOf(hot, w, h) {
  const sq = new Uint16Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!hot[i]) continue;
      sq[i] = x === 0 || y === 0 ? 1 : 1 + Math.min(sq[i - 1], sq[i - w], sq[i - w - 1]);
    }
  }
  const seen = new Uint8Array(w * h);
  const blobs = [];
  const stack = [];
  for (let i = 0; i < w * h; i += 1) {
    if (!hot[i] || seen[i]) continue;
    let n = 0;
    let thick = 0;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j / w) | 0;
      n += 1;
      if (sq[j] > thick) thick = sq[j];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx;
          if (hot[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    blobs.push({ n, thick, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  return blobs;
}

const colourDistance = (img, i, c) => Math.abs(img.data[i] - c[0]) + Math.abs(img.data[i + 1] - c[1]) + Math.abs(img.data[i + 2] - c[2]);

/**
 * Border thickness (px, with sub-pixel coverage) and centre colour on one side of an element, read
 * along a line from inside the element outward. side: left | right | top | bottom; at: 0..1 along
 * the side. Returns null when there is no border to read there (a dash gap, a fill like the border).
 * centre says where the band lies across the edge (pt, negative = inside the element's box).
 */
export function borderProfile(img, rect, side, at, colour, borderPt, scale) {
  const horizontal = side === 'left' || side === 'right';
  const inward = borderPt + 2.5;
  const outward = 1;
  const pts = [];
  for (let t = -inward; t <= outward; t += 1 / scale) {
    let x;
    let y;
    if (horizontal) {
      y = rect.y + rect.h * at;
      x = side === 'left' ? rect.x - t : rect.x + rect.w + t;
    } else {
      x = rect.x + rect.w * at;
      y = side === 'top' ? rect.y - t : rect.y + rect.h + t;
    }
    const px = Math.round(x * scale - 0.5);
    const py = Math.round(y * scale - 0.5);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
    pts.push((py * img.width + px) * 4);
  }
  const fillI = pts[0];
  const ref = Math.max(colourDistance(img, fillI, colour), 40);
  if (colourDistance(img, fillI, colour) < 60) return null;
  const f = pts.map((i) => Math.min(1, Math.max(0, 1 - colourDistance(img, i, colour) / ref)));
  // Past the band, a pixel is border only as far as it blends the border into what lies outside:
  // a neighbour's fill (a group tab standing on the list's top edge) is nearer the border colour
  // than the element's own fill, and read against the fill alone it counted as band (a dark RTL
  // settings capture: 9 px on both sides measured 3.4 vs 4.0 pt because one capture showed 1 px
  // more of the tab).
  const outI = pts[pts.length - 1];
  const outRef = colourDistance(img, outI, colour);
  const outColour = [img.data[outI], img.data[outI + 1], img.data[outI + 2]];
  const first = f.findIndex((v) => v > 0.5);
  if (first !== -1 && outRef >= 60) {
    // The band ends where a pixel is nearer the outside colour than the border colour.
    let end = first;
    while (end + 1 < f.length && colourDistance(img, pts[end + 1], colour) < colourDistance(img, pts[end + 1], outColour)) end += 1;
    for (let k = end + 1; k < f.length; k += 1) f[k] = Math.min(1, Math.max(0, 1 - colourDistance(img, pts[k], colour) / outRef));
  }
  let peak = -1;
  for (let k = 0; k < f.length; k += 1) {
    if (f[k] > 0.5) {
      peak = k;
      break;
    }
  }
  if (peak === -1) return null;
  let lo = peak;
  while (lo > 0 && f[lo - 1] > 0.05) lo -= 1;
  let hi = peak;
  while (hi < f.length - 1 && f[hi + 1] > 0.05) hi += 1;
  let px = 0;
  let top = lo;
  let moment = 0;
  for (let k = lo; k <= hi; k += 1) {
    px += f[k];
    moment += f[k] * (-inward + k / scale);
    if (f[k] > f[top]) top = k;
  }
  const mid = pts[top];
  // centre: where the band sits across the edge, pt (negative = inside the element's box).
  return { px, solid: f[top] >= 0.9, colour: [img.data[mid], img.data[mid + 1], img.data[mid + 2]], centre: px > 0 ? moment / px : 0 };
}

export function cropData(img, x, y, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const sy = y + row;
    if (sy < 0 || sy >= img.height) continue;
    const sx0 = Math.max(0, x);
    const sx1 = Math.min(img.width, x + w);
    if (sx1 <= sx0) continue;
    out.set(img.data.subarray((sy * img.width + sx0) * 4, (sy * img.width + sx1) * 4), (row * w + (sx0 - x)) * 4);
  }
  return out;
}

const normText = (text) => String(text ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// The region mask of a probed frame (contracts/visual-parity.json frames.<key>.probe): a region the
// app draws with its own code at a place only it knows (a game board, a map, a video, a chart canvas),
// while the mockup draws a placeholder. The rectangle the app reports (capture-app's probe launch:
// the app renders parity.probe.<region> with its rect) and the reference's placeholder element are
// filled with one grey in both images before any pixel gate, except where an element drawn over the
// region paints (a dialog: its rounded box and hard shadow, placed in the app by pixel alignment).
// Elements wholly inside the mask are skipped; everything around it is gated as usual.
// ---------------------------------------------------------------------------------------------
const REGION_FILL = [128, 128, 128];

/** The painted shapes of an element over the region: its rounded box and each hard shadow. */
function paintedShapes(el) {
  const radius = parseFloat(String(el.style?.radius ?? '0')) || 0;
  const shapes = [{ ...el.rect, radius }];
  for (const m of String(el.style?.shadow ?? '').matchAll(/(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px(?: (-?[\d.]+)px)?/g)) {
    const [ox, oy, blur, spread = 0] = m.slice(1).map((v) => Number(v ?? 0));
    const grow = blur + spread;
    shapes.push({ x: el.rect.x + ox - grow, y: el.rect.y + oy - grow, w: el.rect.w + 2 * grow, h: el.rect.h + 2 * grow, radius: radius + Math.max(0, spread) });
  }
  return shapes;
}

/** Is the point (pt) inside the rounded rectangle grown by `grow` pt? */
function inShape(x, y, shape, grow) {
  const r = Math.min(shape.radius + grow, (shape.w + 2 * grow) / 2, (shape.h + 2 * grow) / 2);
  const x0 = shape.x - grow;
  const y0 = shape.y - grow;
  const x1 = shape.x + shape.w + grow;
  const y1 = shape.y + shape.h + grow;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** a minus b as up to four rectangles. */
function subtractRect(a, b) {
  if (!intersects(a, b)) return [a];
  const out = [];
  const ax1 = a.x + a.w;
  const ay1 = a.y + a.h;
  const bx1 = b.x + b.w;
  const by1 = b.y + b.h;
  if (b.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: b.y - a.y });
  if (by1 < ay1) out.push({ x: a.x, y: by1, w: a.w, h: ay1 - by1 });
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(ay1, by1);
  if (b.x > a.x) out.push({ x: a.x, y: top, w: b.x - a.x, h: bottom - top });
  if (bx1 < ax1) out.push({ x: bx1, y: top, w: ax1 - bx1, h: bottom - top });
  return out.filter((r) => r.w > 0 && r.h > 0);
}

/** Is the rect wholly covered by the union of `rects`? (sampled on a 5 x 5 grid plus corners) */
function coveredByUnion(rect, rects) {
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const x = rect.x + (rect.w * i) / 4;
      const y = rect.y + (rect.h * j) / 4;
      if (!rects.some((r) => x >= r.x - 0.01 && x <= r.x + r.w + 0.01 && y >= r.y - 0.01 && y <= r.y + r.h + 0.01)) return false;
    }
  }
  return true;
}

/**
 * Builds and paints the region mask. Returns { pieces (design pt rects: the mask minus the boxes of
 * the elements over it, for the gates' exclusion lists), masked (Set of testIDs wholly inside),
 * notes, images (the two painted copies) }.
 */
function applyRegionMask({ region, layout, byId, pairs, design, app, S }) {
  const T = TOLERANCES;
  const placeholder = region.element ? byId.get(region.element) : null;
  const rects = [region.rect, placeholder?.rect].filter(Boolean);
  const dL = lumaOf(design.img);
  const aL = lumaOf(app.img);
  const holes = [];
  for (const id of region.above ?? []) {
    const el = byId.get(id);
    if (!el) continue;
    const shapes = paintedShapes(el);
    let off = { dx: 0, dy: 0 };
    const pair = pairs.get(id);
    if (pair) {
      // Where the element really is in the app, to the pixel (Maestro floors bounds to whole points).
      const ext = extentOf(el);
      const crop = { x: Math.max(0, Math.round(ext.x * S)), y: Math.max(0, Math.round(ext.y * S)) };
      crop.w = Math.min(Math.round(ext.w * S), design.img.width - crop.x);
      crop.h = Math.min(Math.round(ext.h * S), design.img.height - crop.y);
      const origin = { x: crop.x + Math.round((pair.a.x - el.rect.x) * S), y: crop.y + Math.round((pair.a.y - el.rect.y) * S) };
      const best = crop.w > 6 && crop.h > 6 ? alignOffset(dL, design.img.width, aL, app.img.width, app.img.height, crop, origin, T.alignSearchPx) : { ox: 0, oy: 0 };
      off = { dx: (origin.x + best.ox - crop.x) / S, dy: (origin.y + best.oy - crop.y) / S };
    }
    holes.push({ id, shapes, off, box: extentOf(el) });
  }
  const grow = 1 / S;
  const paint = (img, isApp) => {
    const out = { ...img, data: Uint8Array.from(img.data) };
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.x * S));
      const y0 = Math.max(0, Math.floor(r.y * S));
      const x1 = Math.min(img.width, Math.ceil((r.x + r.w) * S));
      const y1 = Math.min(img.height, Math.ceil((r.y + r.h) * S));
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          const x = (px + 0.5) / S;
          const y = (py + 0.5) / S;
          const inHole = holes.some((h) => h.shapes.some((sh) => inShape(x - (isApp ? h.off.dx : 0), y - (isApp ? h.off.dy : 0), sh, grow)));
          if (inHole) continue;
          const i = (py * img.width + px) * 4;
          out.data[i] = REGION_FILL[0];
          out.data[i + 1] = REGION_FILL[1];
          out.data[i + 2] = REGION_FILL[2];
        }
      }
    }
    return out;
  };
  let pieces = [...rects];
  for (const h of holes) pieces = pieces.flatMap((p) => subtractRect(p, pad(h.box, T.boundsPt)));
  const masked = new Set();
  const notes = [`region mask: the app's ${region.name ?? 'region'} ${JSON.stringify(region.rect)} (${region.source ?? 'probe'})${placeholder ? ` and the reference's ${region.element}` : ''} are filled in both images; drawn over it: ${holes.map((h) => h.id).join(', ') || 'nothing'}`];
  for (const el of layout.elements) {
    if (el.count !== 1 || !el.rect || el.testID === layout.root || (region.above ?? []).includes(el.testID)) continue;
    // A part of an element drawn over the region (inside a dialog) is gated like any other.
    if (holes.some((h) => inside(el.rect, h.box, T.boundsPt))) continue;
    if (coveredByUnion(el.rect, rects)) {
      masked.add(el.testID);
      notes.push(`${el.testID}: masked (wholly inside the region the app draws itself, which the design does not)`);
    }
  }
  return { pieces, masked, notes, images: { design: paint(design.img, false), app: paint(app.img, true) } };
}

/**
 * Compare one run.
 *   design { img, layout }   reference image + layout.json (points, frame coordinates)
 *   app    { img, bounds }   capture + parsed bounds (parseMaestroHierarchy / parseAppLayout)
 *   device                   device profile (points, scale, pixels, safe area, masks)
 *   facts                    layoutFactsOf(contract): fixed header, pinned and dialog components
 *   floors                   contract textRoleFloors (the measured type-role floors)
 *   scrollY                  the scroll offset the capture asked for (tall frames)
 *   region                   { rect, source, element, above, name } of a probed region, or null
 *   reachedBy                the modal layer that proves the frame (frames.<key>.modal), or null
 *   appDrawn                 { testID } of a picture the app draws with its own code, or null
 * Returns { problems, notes, checked, coverage, offscreen, stats }. Problems are ordered in the
 * order they should be fixed: screen reached, missing, geometry, text, colour, type, structure.
 */
export function compareRun({ design, app, device, facts = layoutFactsOf(null), floors = {}, scrollY = null, region = null, reachedBy = null, appDrawn = null }) {
  const T = TOLERANCES;
  const S = device.scale;
  const layout = design.layout;
  const kind = layout.kind;
  const isPhone = kind === 'phone' || kind === 'phone-tall';
  // A state card is a fragment of a phone screen (one state of a purchase sheet, a toast stack):
  // compared by text, fill, border, ink size and crop, never by position. Its root is the fragment
  // itself (its padding, a stand-in heading, its parts stacked in a column), which can never align
  // with the phone screen.
  const isStateCard = kind === 'state-card';
  // The root of a state card is either the fragment itself (its rect is the whole card) or a real
  // element (the first toast of a stack).
  const rootEl = (layout.elements ?? []).find((el) => el.testID === layout.root && el.rect);
  const rootIsFragment = isStateCard && Boolean(rootEl) && rootEl.rect.x === 0 && rootEl.rect.y === 0 && Math.abs(rootEl.rect.w - (layout.size?.w ?? rootEl.rect.w)) < 1;
  const problems = [];
  const notes = [];
  const stats = {};
  const checked = { bounds: 0, text: 0, fill: 0, border: 0, 'text-ink': 0, structure: 0 };
  const coverage = new Set();
  const offscreen = [];
  const add = (rule, testID, message, fix, extra = {}) => problems.push({ rule, testID, message: testID ? `${testID}: ${message}` : message, fix, ...extra });
  // Every problem rect is in page coordinates (the design image, full scroll height); viewRect is
  // where that rect should be on this capture's screen (a tall frame's body moves by the scroll).
  let viewShift = () => 0;
  const finish = () => {
    for (const p of problems) {
      if (!p.rect || p.viewRect) continue;
      const el = p.testID ? layout.elements.find((e) => e.testID === p.testID && e.rect) : null;
      p.viewRect = { ...p.rect, y: p.rect.y + (el ? viewShift(el) : 0) };
    }
    problems.sort((p, q) => RULE_ORDER.indexOf(p.rule) - RULE_ORDER.indexOf(q.rule));
    return { problems, notes, checked, coverage: [...coverage].sort(), offscreen, stats };
  };

  // 1. The capture is the parity device's screen.
  const px = device.pixels;
  const fullScreen = app.img.width === px.width && app.img.height === px.height;
  const sizeOk = isPhone ? fullScreen : app.img.width === px.width && app.img.height <= px.height;
  if (!sizeOk) {
    add('capture-size', null, `app.png is ${app.img.width} x ${app.img.height} px; the parity device (${device.name}) captures ${px.width} x ${px.height}`,
      `Capture on this session's parity device for profile ${device.id} with capture-app.mjs (setup-parity-device.mjs creates it).`);
    return finish();
  }
  const viewH = app.img.height / S;
  const viewW = app.img.width / S;
  const geo = frameGeometry(layout, device, facts);
  const topBarBottom = isPhone ? geo.topBarBottom : 0;

  // 2. The app is on this frame.
  const allEls = layout.elements.filter((el) => el.count === 1 && el.rect);
  const byId = new Map(allEls.map((el) => [el.testID, el]));
  // Only reachable elements are paired with the app's bounds; crop-only parts ride in their cover.
  const designEls = allEls.filter((el) => !isCropOnly(el));
  const cropOnly = allEls.filter(isCropOnly);
  const found = designEls.filter((el) => app.bounds.elements.has(el.testID));
  // A frame whose front layer is modal for screen readers (a dialog over a screen) lists only that
  // layer: the frame is reached when reachedBy is on screen, and the screen root sits at its
  // full-screen place.
  if (isPhone && reachedBy && layout.root && !app.bounds.elements.has(layout.root) && app.bounds.elements.has(reachedBy)) {
    const rootEl = byId.get(layout.root);
    const elements = new Map(app.bounds.elements);
    elements.set(layout.root, { x: rootEl?.rect.x ?? 0, y: rootEl?.rect.y ?? 0, w: rootEl?.rect.w ?? viewW, h: rootEl?.rect.h ?? viewH, label: '', count: 1 });
    app = { ...app, bounds: { ...app.bounds, elements } };
    notes.push(`${layout.root}: behind the modal ${reachedBy} (screen readers cannot reach it, so Maestro does not list it); reached through ${reachedBy}, placed at its full-screen position`);
  }
  if (layout.root && !app.bounds.elements.has(layout.root)) {
    const shown = app.bounds.labels.filter(Boolean).slice(0, 6).map((l) => `"${l}"`).join(', ');
    const why = found.length === 0
      ? `none of the frame's ${designEls.length} testIDs are on screen${shown ? ` (the screen shows ${shown}; a system alert or another app may be in front)` : ''}`
      : `${found.length} of ${designEls.length} testIDs found, but not the root`;
    add('screen-not-reached', layout.root, `root testID missing: ${why}`,
      'Check the parity launch (frame=<key>) and the harness plan for this frame, dismiss system alerts, and put the root testID on the screen\'s outer View.');
    return finish();
  }

  // 3. Duplicates.
  for (const el of designEls) {
    const a = app.bounds.elements.get(el.testID);
    if (a && a.count > 1) add('duplicate-testid', el.testID, `${a.count} app elements carry this testID`, 'Give each element its own testID (repeated items append a stable key, never a list index).');
  }

  // Masks. Device masks are screen coordinates of a full-screen capture; masked elements and
  // "floating" elements (drawn at an illustrative position: no bounds check) are design coordinates.
  const deviceMasks = fullScreen ? (device.masks ?? []).map((m) => ({ x: m.x, y: m.y, w: m.width, h: m.height })) : [];
  const maskedDesign = allEls.filter((el) => el.mask).map((el) => el.rect);
  // Unlisted parts behind a dialog that their own frame masks (a banner slot under a dialog).
  for (const m of layout.masks ?? []) {
    if (!m.rect) continue;
    maskedDesign.push(m.rect);
    notes.push(`${m.as}: masked under the dialog (${m.selector}), as its own frame masks it`);
  }
  const floating = isPhone ? designEls.filter((el) => el.testID !== layout.root && el.checks.length > 0 && !el.checks.includes('bounds')) : [];
  const coveredBy = (el) => floating.filter((f) => f !== el && f.testID !== el.parent).map((f) => f.rect);

  // 4. Pair design and app elements; estimate the scroll of a tall capture from the body. On a tall
  // frame the body is visible only between the fixed header and the pinned banner (headerBottom and
  // bodyBottom, screen coordinates): body pixels outside that window are hidden in the app and are
  // never compared, and an element counts as covered only when it was fully inside it.
  const pairs = new Map();
  const bodyShifts = [];
  for (const el of designEls) {
    const a = app.bounds.elements.get(el.testID);
    if (!a) continue;
    pairs.set(el.testID, { el, a });
    if (geo.inBody(el) && el.rect.h < viewH) bodyShifts.push(a.y - el.rect.y);
  }
  bodyShifts.sort((p, q) => p - q);
  const scrollShift = bodyShifts.length ? bodyShifts[Math.floor(bodyShifts.length / 2)] : 0;
  const inBody = (r) => kind === 'phone-tall' && r.y >= topBarBottom;
  const expectedY = (el) => (geo.isPinned(el) ? el.rect.y + geo.pinShift : geo.inBody(el) ? el.rect.y + scrollShift : el.rect.y);
  viewShift = (el) => expectedY(el) - el.rect.y;
  stats.scrollShiftPt = Math.round(scrollShift * 10) / 10;
  // The capture shows the scroll offset it asked for (clamped to the end of the design's scroll):
  // a harness that ignores scrollY would otherwise pass every offset with the same top screen.
  if (geo.tall && scrollY !== null && bodyShifts.length) {
    const wanted = Math.min(scrollY, Math.max(0, (layout.size?.h ?? viewH) - viewH));
    if (Math.abs(scrollShift + wanted) > T.boundsPt) {
      add('scroll-mismatch', layout.root, `the body is scrolled by ${round1(Math.max(0, -scrollShift))} pt but the capture asked for scrollY ${scrollY} (${round1(wanted)} pt within the design's scroll height)`,
        "The parity harness must scroll the screen's ScrollView to scrollY without animation, after the content has laid out; then capture again.");
    }
  }
  const windowH = geo.bodyBottom - geo.headerBottom;
  for (const { el, a } of pairs.values()) {
    const full = !geo.inBody(el) || el.rect.h > windowH - 1 || (a.y >= geo.headerBottom - T.boundsPt && a.y + a.h <= geo.bodyBottom + T.boundsPt);
    if (full) coverage.add(el.testID);
  }
  // A probed region the app draws itself (frames.<key>.probe): filled in both images, elements
  // wholly inside it skipped.
  const regionMasked = new Set();
  if (region?.rect) {
    const mask = applyRegionMask({ region, layout, byId, pairs, design, app, S });
    design = { ...design, img: mask.images.design };
    app = { ...app, img: mask.images.app };
    // The region mask replaces a blanket mask of its placeholder: what is drawn over the region (a
    // dialog and its parts) is compared, the region around it is not.
    const kept = allEls.filter((el) => el.mask && el.testID !== region.element).map((el) => el.rect);
    maskedDesign.length = 0;
    maskedDesign.push(...kept, ...mask.pieces);
    for (const id of mask.masked) {
      regionMasked.add(id);
      pairs.delete(id);
    }
    notes.push(...mask.notes);
    stats.regionMask = { rect: region.rect, pieces: mask.pieces.map((r) => ({ x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.w * 100) / 100, h: Math.round(r.h * 100) / 100 })), masked: [...mask.masked] };
  }
  // A picture the app draws with its own code (frames.<key>.appDrawn: an illustration from the same
  // renderer as a canvas, a chart): the union of the app's and the reference's rectangles of that
  // element is filled in both images; the element keeps its bounds check (its frame and place),
  // elements wholly inside are skipped.
  if (appDrawn?.testID && byId.get(appDrawn.testID)) {
    const el = byId.get(appDrawn.testID);
    const pair = pairs.get(appDrawn.testID);
    const appRect = pair ? { x: pair.a.x, y: pair.a.y, w: pair.a.w, h: pair.a.h } : el.rect;
    const mask = applyRegionMask({ region: { rect: appRect, source: `${appDrawn.testID} in the app`, element: appDrawn.testID, above: [], name: 'picture' }, layout, byId, pairs, design, app, S });
    design = { ...design, img: mask.images.design };
    app = { ...app, img: mask.images.app };
    maskedDesign.push(...mask.pieces);
    for (const id of mask.masked) {
      if (id === appDrawn.testID) continue;
      regionMasked.add(id);
      pairs.delete(id);
    }
    regionMasked.add(`${appDrawn.testID}#pixels`);
    notes.push(`${appDrawn.testID}: the app's own picture, masked in both images (union of the app's ${JSON.stringify(appRect)} and the reference's rectangle); its bounds are still checked`, ...mask.notes.slice(1).filter((n) => !n.startsWith(`${appDrawn.testID}:`)));
  }
  // Screen bands (app coordinates, pt) where a body element's pixels are hidden: under the fixed
  // header, and behind the pinned banner. Everything else only loses the pinned band.
  // The bands run past the screen edges, so the part of an element scrolled off the screen is
  // ignored too (it must not pull the crop alignment).
  const FAR = 10000;
  const bottomBand = geo.bodyBottom < viewH ? [{ x: -FAR, y: geo.bodyBottom, w: 2 * FAR, h: FAR }] : [];
  const bodyBands = geo.tall ? [{ x: -FAR, y: -FAR, w: 2 * FAR, h: FAR + geo.headerBottom }, { x: -FAR, y: geo.bodyBottom, w: 2 * FAR, h: FAR }] : [];
  const hiddenFor = (el) => (el && geo.inBody(el) ? bodyBands : el && geo.isPinned(el) ? [] : bottomBand);

  for (const el of cropOnly) {
    if (el.checks.length === 0) continue;
    const cover = el.coveredBy ?? el.parent ?? layout.root;
    notes.push(`${el.testID}: crop-only (${el.parent ? `inside ${el.parent}` : 'hidden from screen readers'}); its pixels are compared in the crop of ${cover}`);
  }
  for (const el of designEls) {
    if (pairs.has(el.testID) || regionMasked.has(el.testID)) continue;
    if (geo.inBody(el)) {
      // An element with less than minVisiblePt on screen counts as off-screen: iOS leaves such a
      // sliver out of the accessibility snapshot Maestro reads (a 5 pt sliver of a body block at
      // scroll 0 was absent), and the scroll plan shows it whole at another offset.
      const y = expectedY(el);
      if (y >= geo.bodyBottom - T.minVisiblePt || y + el.rect.h <= geo.headerBottom + T.minVisiblePt) {
        offscreen.push(el.testID);
        continue;
      }
    }
    if (el.rect.w * el.rect.h === 0) continue;
    add('missing', el.testID, 'in the design, not in the app (testID absent, element not rendered, or inside an accessible parent)',
      'Render the element and put the testID on the accessible element itself (a Pressable, not its inner Text).', { rect: el.rect });
  }

  // 5. Geometry (+-2 pt on x, y, w, h). Rotated elements may report their box or its bounding box.
  if (isPhone) {
    for (const { el, a } of pairs.values()) {
      if (!el.checks.includes('bounds')) continue;
      checked.bounds += 1;
      const d = { x: el.rect.x, y: expectedY(el), w: el.rect.w, h: el.rect.h };
      const scroller = kind === 'phone-tall' && (el.testID === layout.root || el.rect.h > viewH - topBarBottom);
      const delta = (ref) => ({ dx: a.x - ref.x, dy: a.y - ref.y, dw: a.w - ref.w, dh: scroller ? 0 : a.h - ref.h });
      const within = (v) => [v.dx, v.dy, v.dw, v.dh].every((n) => Math.abs(n) <= T.boundsPt);
      const main = delta(d);
      let ok = within(main);
      if (!ok && el.box?.rotate) {
        const cx = d.x + d.w / 2;
        const cy = d.y + d.h / 2;
        ok = within(delta({ x: cx - el.box.w / 2, y: cy - el.box.h / 2, w: el.box.w, h: el.box.h }));
      }
      if (!ok) {
        const where = d.y === el.rect.y ? '' : ` on screen (page y ${round1(el.rect.y)})`;
        add('bounds', el.testID,
          `geometry off: dx ${signed(main.dx)} dy ${signed(main.dy)} dw ${signed(main.dw)} dh ${signed(main.dh)} pt (design ${round1(d.x)},${round1(d.y)} ${round1(d.w)} x ${round1(d.h)}${where}; app ${a.x},${a.y} ${a.w} x ${a.h}; tolerance +-${T.boundsPt} pt)`,
          'Match the design box: padding, gap, min-height, border width, margins and safe-area insets (the design style is in design.layout.json).',
          { rect: el.rect, viewRect: d, appRect: { x: a.x, y: a.y, w: a.w, h: a.h } });
      }
    }
  }

  // 6. Exact text: the accessibility label Maestro reports is the rendered string.
  for (const { el, a } of pairs.values()) {
    if (!el.checks.includes('text') || el.a11yLabel) continue;
    const want = normText(el.aria ?? el.text);
    if (!want) continue;
    if (!a.label) {
      notes.push(`${el.testID}: the app reports no label, so its text is checked by ink only`);
      continue;
    }
    checked.text += 1;
    if (normText(a.label) !== want) {
      add('text', el.testID, `text "${normText(a.label)}" but the design says "${want}"`,
        'Use the copy key the screen contract names, with the same numbers, spaces and punctuation, and the fixture values of this frame.', { rect: el.rect });
    }
  }

  const textRects = layout.texts.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h }));
  const offsetOf = (testID) => {
    const p = testID ? pairs.get(testID) : null;
    if (!p || (isPhone && testID === layout.root)) return null;
    return { dx: p.a.x - p.el.rect.x, dy: p.a.y - p.el.rect.y };
  };
  const toDesign = (rects, dx, dy) => rects.map((r) => shift(r, -dx, -dy));

  // 7. Fill colour (mode colour of the interior, inside the border, text excluded): delta <= 3.
  for (const { el, a } of pairs.values()) {
    if (!el.checks.includes('fill') || el.mask) continue;
    if (a.y < 0 || a.y + a.h > viewH + 0.5 || a.x < 0 || a.x + a.w > viewW + 0.5) continue;
    const off = { dx: a.x - el.rect.x, dy: a.y - el.rect.y };
    const border = parseFloat(String(el.style?.border ?? '0')) || 0;
    const inset = border + T.fillInsetPt;
    const excludeD = [...textRects.map((r) => pad(r, 1)), ...maskedDesign, ...coveredBy(el), ...toDesign([...deviceMasks, ...hiddenFor(el)], off.dx, off.dy)];
    const dc = modeColour(design.img, el.rect, S, inset, excludeD);
    const ac = modeColour(app.img, { x: a.x, y: a.y, w: a.w, h: a.h }, S, inset, excludeD.map((r) => shift(r, off.dx, off.dy)));
    if (!dc || !ac) continue;
    checked.fill += 1;
    const delta = Math.max(...dc.map((v, i) => Math.abs(v - ac[i])));
    if (delta > T.fillChannelDelta) {
      add('fill', el.testID, `fill ${hex(ac)} but the design is ${hex(dc)} (max channel difference ${delta}, tolerance ${T.fillChannelDelta})`,
        `Use the theme token that paints ${hex(dc)} (design style fill: ${el.style?.fill ?? 'none'}); check the theme the capture used.`, { rect: el.rect });
    }
  }

  // 7b. Borders: thickness within +-0.5 pt and ring colour within 3/255 on each side that has no
  // hard shadow of the same colour behind it, read at three points along the side.
  for (const { el, a } of pairs.values()) {
    if (el.mask || !(el.checks.includes('fill') || el.checks.includes('crop')) || el.box?.rotate) continue;
    // Solid borders only: a dash pattern is laid out differently by each renderer (the crop check
    // still sees a dashed edge that is missing or too thick).
    const m = /^([\d.]+)px solid (#[0-9A-F]{6})/.exec(String(el.style?.border ?? ''));
    if (!m || Number(m[1]) < 1) continue;
    if (a.y < 0 || a.y + a.h > viewH || a.x < 0 || a.x + a.w > viewW) continue;
    if (el.rect.w < 12 || el.rect.h < 12) continue;
    const borderPt = Number(m[1]);
    const colour = [1, 3, 5].map((k) => parseInt(m[2].slice(k, k + 2), 16));
    const shadowBelow = /px [1-9][\d.]*px 0px/.test(String(el.style?.shadow ?? ''));
    const sides = shadowBelow ? ['left', 'top', 'right'] : ['left', 'top', 'right', 'bottom'];
    // Probes where the app hides the element (fixed header, pinned banner) are skipped, with a
    // margin because a profile reads a few points across the edge.
    const hidden = toDesign(hiddenFor(el).map((r) => pad(r, borderPt + 3)), a.x - el.rect.x, a.y - el.rect.y);
    const blocked = [...textRects.map((r) => pad(r, 1)), ...maskedDesign, ...coveredBy(el), ...hidden];
    const appRect = { x: a.x, y: a.y, w: a.w, h: a.h };
    const fails = [];
    const noBorderSides = new Set();
    for (const side of sides) {
      let dMax = null;
      let aMax = null;
      for (const at of [0.35, 0.5, 0.65]) {
        const probe = side === 'left' || side === 'right' ? { x: side === 'left' ? el.rect.x : el.rect.x + el.rect.w, y: el.rect.y + el.rect.h * at } : { x: el.rect.x + el.rect.w * at, y: side === 'top' ? el.rect.y : el.rect.y + el.rect.h };
        if (inAny(probe.x, probe.y, blocked)) continue;
        const dp = borderProfile(design.img, el.rect, side, at, colour, borderPt, S);
        if (!dp || !dp.solid) continue;
        // A CSS border lies inside its element's box. A band on or past the edge is a neighbour's
        // (a tab without a bottom border standing on its list's top border): the layout draws this
        // side with border style none, so there is nothing of this element to compare.
        if (dp.centre > -borderPt / 4) {
          noBorderSides.add(side);
          continue;
        }
        const ap = borderProfile(app.img, appRect, side, at, colour, borderPt, S);
        if (!dMax || dp.px > dMax.px) dMax = dp;
        if (ap && (!aMax || ap.px > aMax.px)) aMax = ap;
      }
      if (!dMax) continue;
      const dPt = dMax.px / S;
      const aPt = aMax ? aMax.px / S : 0;
      const cDelta = aMax ? Math.max(...dMax.colour.map((v, i) => Math.abs(v - aMax.colour[i]))) : 255;
      if (Math.abs(aPt - dPt) > T.borderPt || cDelta > T.fillChannelDelta) {
        fails.push(`${side} ${round1(aPt)} pt${aMax ? ` ${hex(aMax.colour)}` : ''} vs design ${round1(dPt)} pt ${hex(dMax.colour)}`);
      }
    }
    checked.border += 1;
    if (fails.length) {
      add('border', el.testID, `border differs: ${fails.join('; ')} (tolerance +-${T.borderPt} pt, colour ${T.fillChannelDelta}/255)`,
        `Use the design border: ${el.style.border} (the stroke token), on every side.`, { rect: el.rect });
    }
  }

  // 8. Text ink: size, weight, family, colour, wrapping and position of every visible text run.
  // Ink is measured by the run's text colour (so paper, gradients and neighbours never count as
  // ink), inside the rotated line box for a rotated run, with components that run out of the window
  // (a segment's corner, a sticker's edge) dropped. The centre is compared against where the run's
  // surroundings really are in the app, measured to the pixel (anchorOf), not against Maestro's
  // whole-point bounds, and the limit is the run's type-role floor (textRoleFloor, from the contract).
  const dL = lumaOf(design.img);
  const aL = lumaOf(app.img);
  const inkSeen = new Set();
  stats.textInk = [];
  const textIgnore = layout.texts.map((t) => pad(t, T.textPadPt));
  const alignRegion = (region, off, exclude) => {
    const raw = { x: Math.round(region.x * S), y: Math.round(region.y * S) };
    const crop = { x: Math.max(0, raw.x), y: Math.max(0, raw.y) };
    crop.w = Math.min(Math.round(region.w * S) - (crop.x - raw.x), design.img.width - crop.x);
    crop.h = Math.min(Math.round(region.h * S) - (crop.y - raw.y), design.img.height - crop.y);
    if (crop.w < 6 || crop.h < 6) return null;
    const ignore = new Uint8Array(crop.w * crop.h);
    for (const r of exclude) {
      const x0 = Math.max(0, Math.floor(r.x * S - crop.x));
      const x1 = Math.min(crop.w, Math.ceil((r.x + r.w) * S - crop.x));
      const y0 = Math.max(0, Math.floor(r.y * S - crop.y));
      const y1 = Math.min(crop.h, Math.ceil((r.y + r.h) * S - crop.y));
      for (let y = y0; y < y1; y += 1) ignore.fill(1, y * crop.w + x0, y * crop.w + Math.max(x0, x1));
    }
    // Edges that can lock each axis: luma steps across x (vertical edges) and across y.
    let edgesX = 0;
    let edgesY = 0;
    for (let y = 0; y < crop.h; y += 1) {
      for (let x = 0; x < crop.w; x += 1) {
        const k = y * crop.w + x;
        if (ignore[k]) continue;
        const l = dL[(crop.y + y) * design.img.width + crop.x + x];
        if (x + 1 < crop.w && !ignore[k + 1] && Math.abs(l - dL[(crop.y + y) * design.img.width + crop.x + x + 1]) > T.anchorEdgeLuma) edgesX += 1;
        if (y + 1 < crop.h && !ignore[k + crop.w] && Math.abs(l - dL[(crop.y + y + 1) * design.img.width + crop.x + x]) > T.anchorEdgeLuma) edgesY += 1;
      }
    }
    const minEdges = T.anchorMinEdgePt * S;
    if (edgesX < minEdges && edgesY < minEdges) return null;
    const origin = { x: crop.x + Math.round(off.dx * S), y: crop.y + Math.round(off.dy * S) };
    // Maestro floors bounds to whole points, so the element is between its Maestro position and
    // 1 pt further right and down: search that range only (plus one pixel either way).
    const reach = Math.round(S) + 1;
    const best = alignOffset(dL, design.img.width, aL, app.img.width, app.img.height, crop, origin, 0, ignore, { x0: -1, x1: reach, y0: -1, y1: reach });
    return {
      dx: edgesX >= minEdges ? (origin.x + best.ox - crop.x) / S : off.dx,
      dy: edgesY >= minEdges ? (origin.y + best.oy - crop.y) / S : off.dy,
      source: edgesX >= minEdges && edgesY >= minEdges ? 'pixels' : edgesX >= minEdges ? 'pixels-x' : 'pixels-y',
    };
  };
  /**
   * Where the run's element really is in the app, to the pixel: its painted surroundings (the
   * measured owner's box, border, fill, separators and icons within anchorReachPt of the run; text
   * excluded) aligned between design and app around the Maestro position. Maestro floors bounds to
   * whole points (up to 1 pt off); a text-only owner falls back to the run's own neighbourhood, and
   * an axis with no edge at all keeps the Maestro offset.
   */
  const anchorOf = (run, ownerEl, off, hiddenScreen) => {
    const hidden = toDesign(hiddenScreen.map((r) => pad(r, T.inkSearchPx / S)), off.dx, off.dy);
    const exclude = [...textIgnore, ...maskedDesign, ...floating.filter((f) => f !== ownerEl).map((f) => f.rect), ...toDesign(deviceMasks, off.dx, off.dy), ...hidden];
    const ownerBox = ownerEl && ownerEl.testID !== layout.root ? extentOf(ownerEl) : null;
    const within = (box, local) => {
      const x0 = Math.max(box.x, local.x);
      const y0 = Math.max(box.y, local.y);
      const x1 = Math.min(box.x + box.w, local.x + local.w);
      const y1 = Math.min(box.y + box.h, local.y + local.h);
      return x1 > x0 && y1 > y0 ? { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 2, h: y1 - y0 + 2 } : null;
    };
    // Nearest first: the owner's own edges next to the run, then anything next to the run, then
    // the same a little further out. Each axis takes the first region that has an edge across it.
    const regions = [];
    for (const reach of T.anchorReachPt) {
      const local = pad(run, reach);
      if (ownerBox) regions.push(within(ownerBox, local));
      regions.push(local);
    }
    let dx = null;
    let dy = null;
    for (const region of regions) {
      if (!region || (dx !== null && dy !== null)) continue;
      const got = alignRegion(region, off, exclude);
      if (!got) continue;
      if (dx === null && got.source !== 'pixels-y') dx = got.dx;
      if (dy === null && got.source !== 'pixels-x') dy = got.dy;
    }
    const source = dx !== null && dy !== null ? 'pixels' : dx !== null ? 'pixels-x' : dy !== null ? 'pixels-y' : 'maestro';
    return { dx: dx ?? off.dx, dy: dy ?? off.dy, source };
  };
  // Dialog cards (layout.dialogComponents in the contract) hide what lies under them. A run of the
  // screen behind the dialog whose box meets the card is not ink-checked: the card covers it wholly
  // or in part, and a sliver of it measures only where the card edge falls.
  const cards = allEls.filter((el) => facts.dialogComponents.includes(el.component)).map((el) => ({ testID: el.testID, rect: extentOf(el) }));
  const behindCard = (run, owner) => cards.find((c) => intersects(run, c.rect) && !(owner && owner.testID !== layout.root && inside(owner.rect, c.rect, T.boundsPt)));
  const skippedUnderCard = new Set();
  let skippedStateCardChrome = 0;
  for (const run of layout.texts) {
    const owner = run.owner ? byId.get(run.owner) : null;
    if (owner?.mask || regionMasked.has(run.owner)) continue;
    const centre = { x: run.x + run.w / 2, y: run.y + run.h / 2 };
    if (inAny(centre.x, centre.y, maskedDesign)) continue;
    const card = behindCard(run, owner);
    if (card) {
      skippedUnderCard.add(card.testID);
      continue;
    }
    // The fragment's own text outside every mapped part (the state card's stand-in heading) is not
    // the app's: the phone screen draws the real header there.
    if (isStateCard && (!run.owner || (run.owner === layout.root && rootIsFragment))) {
      skippedStateCardChrome += 1;
      continue;
    }
    if (inAny(centre.x, centre.y, floating.filter((f) => f !== owner).map((f) => f.rect))) continue;
    // A crop-only owner is placed through its cover (the nearest reachable, compared ancestor).
    const measuredOwner = owner && isCropOnly(owner) ? (owner.coveredBy ?? owner.parent ?? null) : run.owner;
    let off = offsetOf(measuredOwner);
    if (!off) {
      if (!isPhone) continue;
      off = { dx: 0, dy: inBody(run) ? scrollShift : 0 };
    }
    const ar = shift(run, off.dx, off.dy);
    if (ar.x < 0 || ar.y < 0 || ar.x + ar.w > viewW || ar.y + ar.h > viewH) continue;
    if (inAny(ar.x + ar.w / 2, ar.y + ar.h / 2, deviceMasks)) continue;
    // A run the app partly hides (under the fixed header, behind the pinned banner) has no
    // comparable ink box; it is checked in the capture that shows it whole.
    const runHidden = owner ? hiddenFor(owner) : inBody(run) ? bodyBands : bottomBand;
    if (runHidden.some((r) => intersects(pad(ar, T.inkPadPt), r))) continue;
    // The run's own tilt when the layout records it (every transform above it), else its owner's.
    const rotate = run.rotate ?? owner?.box?.rotate ?? 0;
    const core = rotatedCore(run, rotate);
    // The ink window stays inside the owner's box (unrotated owners), and glyph parts in another
    // element's text box are not the run's (an Arabic-script run's tall line box reached into the
    // label below and took in its dots).
    const clip = owner && owner.testID !== layout.root && !rotate && !core ? owner.rect : null;
    const foreign = clip ? layout.texts.filter((t) => t.owner !== run.owner).map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })) : [];
    const limitsAt = (dx, dy) => (clip ? { clip: shift(clip, dx, dy), foreign: foreign.map((r) => shift(r, dx, dy)) } : null);
    let fg = null;
    let d = null;
    for (const colour of runTextColours(design.img, run, S, T.inkPadPt, T.inkDistance, owner?.style?.color)) {
      const box = inkBoxByColour(design.img, run, S, T.inkPadPt, colour, core, limitsAt(0, 0));
      if (box && (!d || box.n > d.n)) {
        d = box;
        fg = colour;
      }
    }
    if (!d) d = inkBox(design.img, run, S, T.inkPadPt, T.inkDistance);
    if (!d) continue;
    checked['text-ink'] += 1;
    // Find the app's text first (align the window, text included, so the whole run is inside it);
    // the alignment only places the ink window, the centre is judged against the anchor below.
    const win = pad(run, T.inkPadPt);
    const winPx = { x: Math.max(0, Math.round(win.x * S)), y: Math.max(0, Math.round(win.y * S)) };
    winPx.w = Math.min(Math.round(win.w * S), design.img.width - winPx.x);
    winPx.h = Math.min(Math.round(win.h * S), design.img.height - winPx.y);
    const originPx = { x: winPx.x + Math.round(off.dx * S), y: winPx.y + Math.round(off.dy * S) };
    const best = winPx.w > 2 && winPx.h > 2 ? alignOffset(dL, design.img.width, aL, app.img.width, app.img.height, winPx, originPx, T.inkSearchPx) : { ox: 0, oy: 0 };
    const snapped = { dx: Math.round(off.dx * S) / S + best.ox / S, dy: Math.round(off.dy * S) / S + best.oy / S };
    // The window alignment can lock onto a strong neighbour (a sticker's border) instead of the
    // glyphs; the element's own position is the second place to look. Keep the reading whose ink
    // amount is closest to the design's.
    let a = null;
    for (const at of [snapped, { dx: Math.round(off.dx * S) / S, dy: Math.round(off.dy * S) / S }]) {
      const appRun = shift(run, at.dx, at.dy);
      const appCore = core ? { ...core, cx: core.cx + at.dx, cy: core.cy + at.dy } : null;
      const got = fg ? inkBoxByColour(app.img, appRun, S, T.inkPadPt, fg, appCore, limitsAt(at.dx, at.dy)) : inkBox(app.img, appRun, S, T.inkPadPt, T.inkDistance);
      if (got && (!a || Math.abs(got.n - d.n) < Math.abs(a.n - d.n))) a = got;
    }
    const label = run.owner ?? layout.root ?? 'text';
    const key = `${label}|${run.text}`;
    if (!a) {
      if (!inkSeen.has(key)) add('text-ink', label, `text "${run.text.slice(0, 60)}" has no ink in the app where the design has it${fg ? ` (text colour ${hex(fg)})` : ''}`, 'Render the text in the design\'s colour on the design\'s background.', { rect: run, viewRect: { x: ar.x, y: ar.y, w: ar.w, h: ar.h } });
      inkSeen.add(key);
      continue;
    }
    const anchor = anchorOf(run, measuredOwner ? byId.get(measuredOwner) : null, off, runHidden);
    const floor = textRoleFloor(run.font, floors);
    // Centroid shift against where the text should sit inside its (pixel-measured) element.
    const dx = a.cx - d.cx - anchor.dx;
    const dy = a.cy - d.cy - anchor.dy;
    stats.textInk.push({ owner: label, text: run.text.slice(0, 40), font: run.font, role: floor.role, dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100, dw: Math.round((a.w - d.w) * 100) / 100, dh: Math.round((a.h - d.h) * 100) / 100, anchor: anchor.source, maestro: { dx: Math.round((a.cx - d.cx - off.dx) * 100) / 100, dy: Math.round((a.cy - d.cy - off.dy) * 100) / 100 } });
    const why = [];
    if (Math.abs(a.w - d.w) > T.inkSizePt) why.push(`ink width ${round1(a.w)} vs design ${round1(d.w)} pt (size, weight, family, letter-spacing or wrapping)`);
    if (Math.abs(a.h - d.h) > T.inkSizePt) why.push(`ink height ${round1(a.h)} vs design ${round1(d.h)} pt (size, line breaks or clipping)`);
    // A state card is never compared by position: only the ink size of its runs counts.
    if (!isStateCard && (Math.abs(dx) > floor.centrePt || Math.abs(dy) > floor.centrePt)) why.push(`moved dx ${signed(dx)} dy ${signed(dy)} pt inside its element (alignment, padding or line height; limit ${floor.centrePt} pt for ${floor.role})`);
    if (why.length && !inkSeen.has(key)) {
      inkSeen.add(key);
      add('text-ink', label, `text "${run.text.slice(0, 60)}": ${why.join('; ')}`, `Use the design's text style (${run.font}) and alignment.`, { rect: run, viewRect: { x: ar.x, y: ar.y, w: ar.w, h: ar.h } });
    }
  }

  for (const id of skippedUnderCard) notes.push(`text of the screen behind ${id} is not ink-checked where the dialog card covers it`);
  if (skippedStateCardChrome) notes.push(`state card: ${skippedStateCardChrome} run${skippedStateCardChrome === 1 ? '' : 's'} of the fragment's own heading not ink-checked (the phone screen draws its top bar there)`);

  // 9. Structure: each element's painted area (box, hard shadow, ring, focus outline) is cropped
  // from both images and aligned (+-6 px: Maestro bounds are whole points); diff blobs outside text
  // that are at least 1.5 pt thick fail. Smaller compared elements inside it (plus 2 pt) are left to
  // their own crop, so a parent only answers for the pixels no child owns.
  const items = [];
  for (const { el, a } of pairs.values()) {
    if (el.mask) continue;
    const isRoot = el.testID === layout.root;
    if (!(el.checks.includes('crop') || el.checks.includes('fill') || isRoot)) continue;
    if (isRoot && kind === 'phone-tall' && Math.abs(scrollShift) > T.boundsPt) continue;
    // A state card's root is the design fragment, not a screen: its parts are compared one by one.
    if (isRoot && rootIsFragment) {
      notes.push(`${el.testID}: state card root, no structure check (its parts are compared one by one)`);
      continue;
    }
    if (appDrawn?.testID === el.testID) continue;
    const ext = isRoot ? el.rect : extentOf(el);
    items.push({ el, a, ext, area: el.rect.w * el.rect.h });
  }
  for (const item of items) {
    const { el, a, ext } = item;
    const raw = { x: Math.round(ext.x * S), y: Math.round(ext.y * S) };
    const crop = { x: Math.max(0, raw.x), y: Math.max(0, raw.y), w: Math.round(ext.w * S), h: Math.round(ext.h * S) };
    crop.w = Math.min(crop.w - (crop.x - raw.x), design.img.width - crop.x);
    crop.h = Math.min(crop.h - (crop.y - raw.y), design.img.height - crop.y);
    const origin = { x: Math.round((a.x + ext.x - el.rect.x) * S) + (crop.x - raw.x), y: Math.round((a.y + ext.y - el.rect.y) * S) + (crop.y - raw.y) };
    const visibleRows = app.img.height - origin.y;
    if (visibleRows <= 0) continue;
    crop.h = Math.min(crop.h, visibleRows);
    if (crop.w < 3 || crop.h < 3) continue;
    // What this element does not answer for: text (the ink check), masks, floating illustrations,
    // and smaller compared elements inside it (their own crop, plus the geometry tolerance).
    const children = items.filter((o) => o !== item && o.area < item.area && intersects(o.ext, el.rect)).map((o) => pad(o.ext, T.boundsPt));
    const toCrop = (r) => ({ x: (r.x - crop.x / S) * S, y: (r.y - crop.y / S) * S, w: r.w * S, h: r.h * S });
    // Where the app hides this element (fixed header, pinned banner), mapped into design
    // coordinates at the element's measured offset, widened by the alignment search.
    const hidden = toDesign(hiddenFor(el).map((r) => pad(r, T.alignSearchPx / S)), a.x - el.rect.x, a.y - el.rect.y);
    // The OS-drawn areas (status bar, home indicator, navigation bar) never pull the alignment.
    const osDrawn = toDesign(deviceMasks.map((r) => pad(r, T.alignSearchPx / S)), a.x - el.rect.x, a.y - el.rect.y);
    const designExclude = [...textRects.map((r) => pad(r, T.textPadPt)), ...maskedDesign, ...coveredBy(el), ...children, ...hidden, ...osDrawn].map(toCrop);
    const ignore = new Uint8Array(crop.w * crop.h);
    for (const r of designExclude) {
      for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(crop.h, Math.ceil(r.y + r.h)); y += 1) {
        for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(crop.w, Math.ceil(r.x + r.w)); x += 1) ignore[y * crop.w + x] = 1;
      }
    }
    // A part of a state card is compared inside its own painted shape (rounded box and hard
    // shadows): around it the design shows the fragment's empty ground, the app the phone page
    // behind it (toasts float over the page's own buttons).
    if (isStateCard && !(el.testID === layout.root && rootIsFragment)) {
      const shapes = paintedShapes(el);
      for (let y = 0; y < crop.h; y += 1) {
        for (let x = 0; x < crop.w; x += 1) {
          const px = (crop.x + x + 0.5) / S;
          const py = (crop.y + y + 0.5) / S;
          if (!shapes.some((sh) => inShape(px, py, sh, 0))) ignore[y * crop.w + x] = 1;
        }
      }
    }
    // The screen root is the screen: it is never shifted to fit (its pixels are the gaps between elements).
    const search = isPhone && el.testID === layout.root ? 0 : T.alignSearchPx;
    const best = alignOffset(dL, design.img.width, aL, app.img.width, app.img.height, crop, origin, search, ignore);
    const dData = cropData(design.img, crop.x, crop.y, crop.w, crop.h);
    const aData = cropData(app.img, origin.x + best.ox, origin.y + best.oy, crop.w, crop.h);
    const diff = new Uint8Array(crop.w * crop.h * 4);
    pixelDiff(dData, aData, diff, crop.w, crop.h, { threshold: T.pixelDiffThreshold, diffMask: true });
    const off = { dx: (origin.x + best.ox - crop.x) / S, dy: (origin.y + best.oy - crop.y) / S };
    const appExclude = toDesign(deviceMasks, off.dx, off.dy).map(toCrop);
    const hot = new Uint8Array(crop.w * crop.h);
    for (let y = 0; y < crop.h; y += 1) {
      const ay = origin.y + best.oy + y;
      if (ay < 0 || ay >= app.img.height) continue;
      for (let x = 0; x < crop.w; x += 1) {
        const i = y * crop.w + x;
        const ax = origin.x + best.ox + x;
        if (diff[i * 4 + 3] === 0 || ignore[i] || ax < 0 || ax >= app.img.width || inAny(x, y, appExclude)) continue;
        hot[i] = 1;
      }
    }
    const minPx = Math.floor(T.blobThicknessPt * S);
    const blobs = blobsOf(hot, crop.w, crop.h)
      .filter((b) => b.thick >= minPx && b.n >= T.blobMinPixels)
      .map((b) => ({ n: b.n, thick: b.thick / S, x: (crop.x + b.x) / S, y: (crop.y + b.y) / S, w: b.w / S, h: b.h / S }))
      .sort((p, q) => q.n - p.n);
    checked.structure += 1;
    if (!blobs.length) continue;
    const b = blobs[0];
    // Name the crop-only part the difference sits in (a hidden logo, an icon inside a button).
    // The smallest such part names it best (the key, not the whole header around it).
    const part = cropOnly
      .filter((c) => (c.coveredBy ?? c.parent ?? layout.root) === el.testID && intersects(c.rect, b))
      .sort((p, q) => p.rect.w * p.rect.h - q.rect.w * q.rect.h)[0];
    add('structure', el.testID,
      `shape differs: a ${round1(b.thick)} pt thick difference (${round1(b.w)} x ${round1(b.h)} pt) at +${round1(b.x - el.rect.x)},+${round1(b.y - el.rect.y)} from the element's top-left${part ? `, inside its crop-only part ${part.testID}` : ''} (${blobs.length} blob${blobs.length > 1 ? 's' : ''}; border, radius, hard shadow, icon, picture or spacing)`,
      'Open crops/<testID>.png from make-sheet.mjs and match the border, radius, hard shadow, icon path or spacing.', { rect: el.rect, blob: b });
  }

  // 10. Report-only numbers (never a gate): the share of differing pixels outside the masks
  // (not for a scrolled capture of a tall frame, whose screen is not the top of the design).
  if (fullScreen && design.img.width === app.img.width && Math.abs(scrollShift) <= T.boundsPt) {
    const w = design.img.width;
    const h = Math.min(design.img.height, app.img.height);
    const n = w * h;
    const d = Uint8Array.from(design.img.data.subarray(0, n * 4));
    const a = Uint8Array.from(app.img.data.subarray(0, n * 4));
    let maskedPx = 0;
    for (const r of [...deviceMasks, ...maskedDesign]) {
      for (let y = Math.max(0, Math.round(r.y * S)); y < Math.min(h, Math.round((r.y + r.h) * S)); y += 1) {
        for (let x = Math.max(0, Math.round(r.x * S)); x < Math.min(w, Math.round((r.x + r.w) * S)); x += 1) {
          const i = (y * w + x) * 4;
          if (d[i + 3] === 0 && a[i + 3] === 0) continue;
          d.fill(0, i, i + 4);
          a.fill(0, i, i + 4);
          maskedPx += 1;
        }
      }
    }
    const count = pixelDiff(d, a, null, w, h, { threshold: T.pixelDiffThreshold });
    stats.pixelDiffPercent = Math.round((10000 * count) / Math.max(1, n - maskedPx)) / 100;
  }
  return finish();
}

export { intersects };
