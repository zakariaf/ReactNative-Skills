// Element bounds of the app, from either source:
//   app.hier.json    `maestro --device <id> hierarchy` output. iOS: resource-id = the React Native
//                    testID, bounds "[x0,y0][x1,y1]" in whole points, accessibilityText = the
//                    accessibility label. Android: the same keys, but bounds in physical pixels
//                    (divided by the device scale here; read from Maestro's documentation and
//                    source, not yet verified on an emulator). Lists only on-screen elements and
//                    hides the children of accessible elements.
//   app.layout.json  an in-app layout reporter (test builds): { elements: [{ testID, x, y, w, h, text }] }
//                    in points, floats, children included.
import { TESTID_PATTERN } from './contract.mjs';

const BOUNDS = /^\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]\[(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]$/;
const INVISIBLE_BIDI = /[‎‏‪-‮⁦-⁩]/g;

/** Whitespace-normalised text without invisible bidi controls (the app may isolate names). */
export function normText(text) {
  return String(text ?? '').replace(INVISIBLE_BIDI, '').replace(/\s+/g, ' ').trim();
}

/** The marker testID the parity root (and every modal root) renders for one launch. */
export const launchMarker = (nonce) => `parity.launch.${nonce}`;

/**
 * Parse a Maestro hierarchy dump. `unitScale` divides the bounds (1 on iOS, the device scale on
 * Android, where Maestro reports pixels).
 */
export function parseMaestroHierarchy(json, { unitScale = 1 } = {}) {
  const elements = new Map();
  const labels = [];
  let nodes = 0;
  const walk = (node) => {
    nodes += 1;
    const a = node?.attributes ?? {};
    const id = a['resource-id'];
    const m = BOUNDS.exec(a.bounds ?? '');
    const label = a.accessibilityText || a.text || a.value || a['content-desc'] || '';
    if (label) labels.push(label);
    if (id && TESTID_PATTERN.test(id) && m) {
      const [x0, y0, x1, y1] = m.slice(1).map((v) => Number(v) / unitScale);
      const found = elements.get(id);
      if (found) found.count += 1;
      else elements.set(id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0, label: normText(label), count: 1 });
    }
    for (const child of node?.children ?? []) walk(child);
  };
  walk(json);
  return { source: 'maestro', elements, labels, nodes };
}

export function parseAppLayout(json) {
  const elements = new Map();
  for (const el of json?.elements ?? []) {
    if (!el || typeof el.testID !== 'string' || !TESTID_PATTERN.test(el.testID)) continue;
    const found = elements.get(el.testID);
    if (found) found.count += 1;
    else elements.set(el.testID, { x: Number(el.x), y: Number(el.y), w: Number(el.w), h: Number(el.h), label: normText(el.text ?? ''), count: 1 });
  }
  return { source: 'layout', elements, labels: [], nodes: elements.size };
}

// System prompts that must never be on screen in a capture: Apple's tracking prompt (App Tracking
// Transparency), permission prompts on both platforms, the "Open in ...?" alert of a deep link on
// iOS, and Android's permission controller and "app isn't responding" dialogs.
const SYSTEM_ALERT = /Ask App Not to Track|to track your activity|Would Like to|Don[’']t Allow|Allow Once|^Open in [“"]|^While using the app$|^Only this time$|^Don[’']t allow$|isn[’']t responding|has stopped/;

/** The first system-alert text in a parsed dump, or null. */
export function systemAlertIn(parsed) {
  return parsed.labels.find((label) => SYSTEM_ALERT.test(label)) ?? null;
}
