// Renders design frames with Playwright and the installed Google Chrome at a device profile's
// geometry, and extracts each frame's layout (testID rects, texts, computed styles, text runs).
// Mockup conventions: a frame is the element with data-frame="<key>", its elements carry
// data-testid; the theme, language and direction reach the page through the contract's mockup
// adapter (attributes on <html> and/or a query string) and prefers-color-scheme.
import { pathToFileURL } from 'node:url';

/** CSS that turns a frame into the device screen (sizes from the device profile). */
export function parityCss(device, kind, extra = '') {
  const w = device.points.width;
  const h = device.points.height;
  const height = kind === 'phone' ? `height:${h}px !important;` : kind === 'phone-tall' ? `min-height:${h}px !important;height:auto !important;` : 'height:auto !important;';
  return [
    `:root{--parity-width:${w}px;--parity-height:${h}px;--parity-safe-top:${device.safeArea.top}px;--parity-safe-bottom:${device.safeArea.bottom}px}`,
    '*,*::before,*::after{animation-duration:0s !important;animation-delay:0s !important;transition-duration:0s !important;transition-delay:0s !important;caret-color:transparent !important}',
    `.parity-pin{position:fixed !important;left:0 !important;top:0 !important;z-index:2147483647 !important;margin:0 !important;transform:none !important;zoom:1 !important;width:${w}px !important;${height}box-sizing:border-box !important;overflow:hidden !important}`,
    extra,
  ].join('\n');
}

/** Fill {theme}, {lang}, {dir} in a template string. */
export function fillTemplate(template, values) {
  return String(template).replace(/\{(theme|lang|dir)\}/g, (_m, key) => values[key]);
}

/**
 * Open the mockup for one theme and language in a fresh context. Returns { context, page, blocked,
 * errors, fonts }: blocked lists every non-file request (the page must load nothing from the network),
 * fonts the @font-face rules and whether each loaded.
 */
export async function openMockup(browser, { mockupPath, mockup, theme, lang, dir, device }) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: device.scale,
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: lang,
    timezoneId: 'UTC',
  });
  const attributes = Object.fromEntries(Object.entries(mockup.htmlAttributes ?? {}).map(([k, v]) => [k, fillTemplate(v, { theme, lang, dir })]));
  await context.addInitScript((attrs) => {
    const apply = () => {
      if (!document.documentElement) return;
      for (const [k, v] of Object.entries(attrs)) document.documentElement.setAttribute(k, v);
    };
    apply();
    document.addEventListener('readystatechange', apply);
    document.addEventListener('DOMContentLoaded', apply);
  }, attributes);
  const page = await context.newPage();
  const blocked = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message ?? error)));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  const query = mockup.query ? fillTemplate(mockup.query, { theme, lang, dir }) : '';
  await page.goto(`${pathToFileURL(mockupPath).href}${query}`, { waitUntil: 'load' });
  await page.evaluate((attrs) => {
    for (const [k, v] of Object.entries(attrs)) document.documentElement.setAttribute(k, v);
  }, attributes);
  const fonts = await page.evaluate(async () => {
    const faces = [...document.fonts];
    await Promise.all(faces.map((f) => f.load().catch(() => null)));
    await document.fonts.ready;
    return faces.map((f) => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, style: f.style, status: f.status }));
  });
  return { context, page, blocked, errors, fonts };
}

/** In-page: pin one frame at (0,0) as the device screen; returns its size in points. */
function pinFrame({ key }) {
  const list = document.querySelectorAll(`[data-frame="${CSS.escape(key)}"]`);
  if (list.length !== 1) return { count: list.length };
  const frame = list[0];
  frame.classList.add('parity-pin');
  return { count: 1, width: frame.clientWidth, height: frame.clientHeight };
}

function unpinFrame() {
  document.querySelectorAll('.parity-pin').forEach((el) => el.classList.remove('parity-pin'));
}

/** In-page: the layout of one pinned frame. */
function extractLayout({ key, testIDs }) {
  const frame = document.querySelector(`[data-frame="${CSS.escape(key)}"]`);
  const fr = frame.getBoundingClientRect();
  const origin = { x: fr.left + frame.clientLeft, y: fr.top + frame.clientTop };
  const r2 = (v) => Math.round(v * 100) / 100;
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const rgbHex = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css ?? '');
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
    if (Number(a) === 0) return null;
    const h = [r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    return Number(a) < 1 ? `#${h} @${Number(a)}` : `#${h}`;
  };
  const rotation = (transform) => {
    const m = /matrix\(([^)]+)\)/.exec(transform ?? '');
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    return r2((Math.atan2(b, a) * 180) / Math.PI);
  };
  const nodeToId = new Map();
  const out = [];
  for (const testID of testIDs) {
    const list = [...(frame.getAttribute('data-testid') === testID ? [frame] : []), ...frame.querySelectorAll(`[data-testid="${CSS.escape(testID)}"]`)];
    if (list.length !== 1) {
      out.push({ testID, count: list.length });
      continue;
    }
    const node = list[0];
    if (!nodeToId.has(node)) nodeToId.set(node, testID);
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    let rot = 0;
    for (let p = node; p && p !== frame; p = p.parentElement) rot += rotation(getComputedStyle(p).transform);
    const hidden = node.getClientRects().length === 0;
    out.push({
      testID,
      count: hidden ? 0 : 1,
      // The frame itself is its padding box.
      rect: node === frame ? { x: 0, y: 0, w: frame.clientWidth, h: frame.clientHeight } : { x: r2(r.left - origin.x), y: r2(r.top - origin.y), w: r2(r.width), h: r2(r.height) },
      box: { w: node.offsetWidth ?? r2(r.width), h: node.offsetHeight ?? r2(r.height), rotate: r2(rot) },
      text: norm(node.innerText ?? node.textContent),
      aria: node.getAttribute('aria-label'),
      style: {
        fill: rgbHex(cs.backgroundColor),
        color: rgbHex(cs.color),
        border: cs.borderTopStyle === 'none' ? null : `${cs.borderTopWidth} ${cs.borderTopStyle} ${rgbHex(cs.borderTopColor)}`,
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow === 'none' ? null : cs.boxShadow,
        outline: cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 ? null : `${cs.outlineWidth} ${cs.outlineStyle} offset ${cs.outlineOffset}`,
        font: `${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily.split(',')[0].replace(/["']/g, '')}`,
      },
    });
  }
  const texts = [];
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const host = n.parentElement;
    if (!host || host.closest('[data-parity-ignore]')) continue;
    let owner = null;
    for (let p = host; p && p !== frame.parentElement; p = p.parentElement) {
      if (nodeToId.has(p)) {
        owner = nodeToId.get(p);
        break;
      }
    }
    const cs = getComputedStyle(host);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    // The run's own tilt (every transform between it and the frame).
    let tilt = 0;
    for (let p = host; p && p !== frame; p = p.parentElement) tilt += rotation(getComputedStyle(p).transform);
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const b of range.getClientRects()) {
      if (b.width < 0.5 || b.height < 0.5) continue;
      texts.push({
        text: norm(n.textContent),
        x: r2(b.left - origin.x),
        y: r2(b.top - origin.y),
        w: r2(b.width),
        h: r2(b.height),
        owner,
        font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0].replace(/["']/g, '')}`,
        ...(r2(tilt) ? { rotate: r2(tilt) } : {}),
      });
    }
  }
  return { width: frame.clientWidth, height: frame.clientHeight, elements: out, texts };
}

/**
 * In-page: a reference variant's DOM change (contract frames.<key>.variants.<id>.derive), applied to
 * the rendered mockup before it is measured and shot, never to the mockup file. Each step matches
 * exactly one element of the frame:
 *   hide   display:none (the element stays in the DOM; a flex column closes up as the app's does)
 *   style  inline CSS properties (two keys sharing a row)
 *   text   the element's text in the render language (texts.<lang>)
 * Returns { problems } and keeps what it changed on window.__parityUndo.
 */
function applyDerive({ key, derive, lang }) {
  const frame = document.querySelector(`[data-frame="${CSS.escape(key)}"]`);
  const undo = [];
  const problems = [];
  for (const step of derive) {
    const sel = step.hide ?? step.style ?? step.text;
    let list;
    try {
      list = frame.querySelectorAll(sel);
    } catch (error) {
      problems.push(`derive selector "${sel}" is not valid CSS (${String(error.message).split('\n')[0]})`);
      continue;
    }
    if (list.length !== 1) {
      problems.push(`derive selector "${sel}" matched ${list.length} elements`);
      continue;
    }
    const node = list[0];
    if (step.hide !== undefined || step.style !== undefined) {
      undo.push({ node, kind: 'style', value: node.getAttribute('style') });
      if (step.hide !== undefined) node.style.setProperty('display', 'none', 'important');
      else for (const [prop, value] of Object.entries(step.css)) node.style.setProperty(prop, value, 'important');
      continue;
    }
    undo.push({ node, kind: 'html', value: node.innerHTML });
    node.textContent = step.texts[lang] ?? '';
  }
  window.__parityUndo = [...(window.__parityUndo ?? []), ...undo];
  return { problems };
}

/** In-page: which elements of the frame are hidden (no box), by testID. */
function hiddenElements({ key, testIDs }) {
  const frame = document.querySelector(`[data-frame="${CSS.escape(key)}"]`);
  const out = {};
  for (const testID of testIDs) {
    const list = [...(frame.getAttribute('data-testid') === testID ? [frame] : []), ...frame.querySelectorAll(`[data-testid="${CSS.escape(testID)}"]`)];
    if (list.length === 1) out[testID] = list[0].getClientRects().length === 0;
  }
  return out;
}

/** In-page: the rectangles of the frame's design masks (contract frames.<key>.designMasks), in frame points. */
function measureMasks({ key, masks }) {
  const frame = document.querySelector(`[data-frame="${CSS.escape(key)}"]`);
  const fr = frame.getBoundingClientRect();
  const origin = { x: fr.left + frame.clientLeft, y: fr.top + frame.clientTop };
  const r2 = (v) => Math.round(v * 100) / 100;
  return masks.map((m) => {
    let list = [];
    try {
      list = [...frame.querySelectorAll(m.selector)];
    } catch {
      list = [];
    }
    if (list.length !== 1) return { as: m.as, selector: m.selector, count: list.length };
    const r = list[0].getBoundingClientRect();
    return { as: m.as, selector: m.selector, count: 1, rect: { x: r2(r.left - origin.x), y: r2(r.top - origin.y), w: r2(r.width), h: r2(r.height) } };
  });
}

function undoDerive() {
  for (const step of (window.__parityUndo ?? []).reverse()) {
    if (step.kind === 'html') step.node.innerHTML = step.value;
    else if (step.value === null) step.node.removeAttribute('style');
    else step.node.setAttribute('style', step.value);
  }
  window.__parityUndo = [];
}

/**
 * A variant's derive changes exactly the elements its facts change: every element it hides must exist
 * only for other facts (a "when" the variant's facts do not match), and every element that exists only
 * for other facts must be hidden or re-texted by it. So a derive that hides the wrong key fails
 * (rule variant-derive).
 */
function deriveProblems({ variant, checkElements, before, after, textTargets }) {
  const problems = [];
  const matches = (el) => Object.entries(el.when ?? {}).every(([k, v]) => variant.facts[k] === v);
  for (const el of checkElements) {
    if (!(el.testID in before) || before[el.testID]) continue;
    const hidden = after[el.testID] === true;
    if (hidden && matches(el)) problems.push(`${variant.id}: the derive hides ${el.testID}, which exists for these facts (${JSON.stringify(variant.when)})`);
    if (!hidden && !matches(el) && !textTargets.includes(el.testID)) problems.push(`${variant.id}: ${el.testID} exists only when ${JSON.stringify(el.when)}, but the derive leaves it on screen`);
  }
  return problems;
}

/**
 * Shoot one frame (or one of its reference variants). Returns { problems[], png (Buffer from
 * Chrome), layout, size }. The frame is pinned at (0,0) and clipped, which avoids fractional offsets
 * (an element screenshot of an in-flow frame came out 3 px too tall). A variant's derive is applied
 * after pinning and undone before returning; `checkElements` (every element of the frame, whatever its
 * "when") lets the derive be checked against the contract.
 */
export async function shootFrame(page, { frame, elements, checkElements = elements, device, variant = null, lang }) {
  await page.addStyleTag({ content: parityCss(device, frame.kind) });
  const pinned = await page.evaluate(pinFrame, { key: frame.key });
  if (pinned.count !== 1) return { problems: [{ rule: 'frame-missing', message: `data-frame="${frame.key}" matched ${pinned.count} elements` }] };
  try {
    const problems = [];
    if (variant) {
      const probe = checkElements.map((el) => el.testID);
      const before = await page.evaluate(hiddenElements, { key: frame.key, testIDs: probe });
      const derived = await page.evaluate(applyDerive, { key: frame.key, derive: variant.derive, lang });
      for (const message of derived.problems) problems.push({ rule: 'variant-derive', message: `${variant.id}: ${message}` });
      const after = await page.evaluate(hiddenElements, { key: frame.key, testIDs: probe });
      const textTargets = await page.evaluate(({ key, selectors }) => {
        const root = document.querySelector(`[data-frame="${CSS.escape(key)}"]`);
        return selectors.flatMap((sel) => [...root.querySelectorAll(sel)].map((n) => n.closest('[data-testid]')?.getAttribute('data-testid')).filter(Boolean));
      }, { key: frame.key, selectors: variant.derive.filter((s) => s.text !== undefined).map((s) => s.text) });
      for (const message of deriveProblems({ variant, checkElements, before, after, textTargets })) problems.push({ rule: 'variant-derive', message });
      if (problems.length) return { problems };
    }
    const size = await page.evaluate((key) => ({ height: document.querySelector(`[data-frame="${CSS.escape(key)}"]`).clientHeight }), frame.key);
    const width = device.points.width;
    const height = Math.ceil(size.height);
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    // Under load Chrome can hand back a frame before the pinned frame is painted (a blank card was
    // seen once). Wait two animation frames, then shoot until two shots in a row agree.
    const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const shoot = () => page.screenshot({ clip: { x: 0, y: 0, width, height }, animations: 'disabled', caret: 'hide', scale: 'device' });
    await settle();
    let png = await shoot();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settle();
      const again = await shoot();
      if (again.equals(png)) break;
      png = again;
    }
    const layout = await page.evaluate(extractLayout, { key: frame.key, testIDs: elements.map((el) => el.testID) });
    if ((frame.designMasks ?? []).length) {
      layout.masks = await page.evaluate(measureMasks, { key: frame.key, masks: frame.designMasks });
      for (const m of layout.masks) if (m.count !== 1) problems.push({ rule: 'design-mask', message: `design mask "${m.selector}" (${m.as}) matched ${m.count} elements` });
      if (problems.length) return { problems };
    }
    return { problems: [], png, layout, size: { w: width, h: height } };
  } finally {
    if (variant) await page.evaluate(undoDerive);
    await page.evaluate(unpinFrame);
    await page.setViewportSize({ width: 1400, height: 1000 });
  }
}
