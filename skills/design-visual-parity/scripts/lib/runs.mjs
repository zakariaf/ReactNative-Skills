// Run folders and waivers.
//
// A run folder is what capture-app.mjs writes for one frame x device x theme x language (x scroll):
//   run.json         { frame, variant, device, platform, theme, lang, scrollY, region, ... }  required
//                    (variant: the reference variant the app's facts picked, or null; region: the
//                    rectangle a probed frame masks, from the probe launch)
//   app.png          the simulator or emulator screenshot                 required
//   app.hier.json    `maestro --device <id> hierarchy` output             one of these two
//   app.layout.json  an in-app layout reporter's output
//   report.json      written by check-parity.mjs
//   sheet.png, zoom-*.png, eye-*.png, crops/, sheets.json   written by make-sheet.mjs
// Default location in the app repo: <runsDir>/<device>/<frame>/<theme>-<lang>[-y<scroll>]/ (runsDir
// is .parity unless the contract says otherwise; it is git-ignored).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { fail } from '../check-lib.mjs';
import { THEMES, referenceFiles } from './contract.mjs';

export const RUN_FILES = Object.freeze({ info: 'run.json', app: 'app.png', hier: 'app.hier.json', layout: 'app.layout.json', report: 'report.json', sheets: 'sheets.json' });

export function runDirName(theme, lang, scrollY = 0) {
  return `${theme}-${lang}${scrollY ? `-y${scrollY}` : ''}`;
}

/** The run folder of one capture (absolute). */
export function defaultRunDir(parity, { device, frame, theme, lang, scrollY = 0 }) {
  return join(parity.root, parity.paths.runs, device, frame, runDirName(theme, lang, scrollY));
}

/** Every folder under root that holds a run.json (sorted). */
export function findRunDirs(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === RUN_FILES.info)) out.push(dir);
    for (const e of entries) if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'crops') walk(join(dir, e.name));
  };
  walk(root);
  return out.sort();
}

/** Read run.json and resolve the reference files (absolute paths). */
export function readRun(dir, parity) {
  const infoPath = join(dir, RUN_FILES.info);
  if (!existsSync(infoPath)) fail(`${dir} is not a run folder (no run.json)`, 'Pass a folder written by capture-app.mjs.');
  let info;
  try {
    info = JSON.parse(readFileSync(infoPath, 'utf8'));
  } catch (error) {
    return fail(`${infoPath} is not valid JSON: ${error.message}`, 'Capture the run again.');
  }
  for (const key of ['frame', 'device', 'theme', 'lang']) if (typeof info[key] !== 'string') fail(`${infoPath} has no "${key}"`, 'Capture the run again with capture-app.mjs.');
  if (!THEMES.includes(info.theme)) fail(`${infoPath}: unknown theme "${info.theme}"`, 'Use light or dark.');
  const languages = parity.contract.languages ?? [];
  if (!languages.includes(info.lang)) fail(`${infoPath}: language "${info.lang}" is not in the contract's languages (${languages.join(', ')})`, 'Capture the run again, or add the language to contracts/visual-parity.json.');
  const variant = typeof info.variant === 'string' && info.variant ? info.variant : null;
  const rel = (p) => (isAbsolute(p) ? p : resolve(dir, p));
  const files = referenceFiles(parity, { device: info.device, theme: info.theme, lang: info.lang, frame: info.frame, variant });
  const image = join(parity.root, files.image);
  const layout = join(parity.root, files.layout);
  const hier = existsSync(join(dir, RUN_FILES.hier)) ? join(dir, RUN_FILES.hier) : null;
  const appLayout = existsSync(join(dir, RUN_FILES.layout)) ? join(dir, RUN_FILES.layout) : null;
  const app = typeof info.app === 'string' ? rel(info.app) : join(dir, RUN_FILES.app);
  return { dir, info: { ...info, variant, scrollY: info.scrollY ?? 0 }, reference: { image, layout, name: files.stem }, app, hier, appLayout };
}

export function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Waivers: the contract's waiver file (default design/parity/waivers.json, committed and gated). A
// waiver accepts one named problem of one element on one frame. It never changes a tolerance, and it
// must say why and when the reviewer was told. Three classes:
//   platform              (default) iOS, Android or React Native cannot draw it like the design;
//   platform-text-shaping text-ink only: the platform's text engine shapes these glyphs or marks
//                         differently from Chrome's HarfBuzz (same font file); names the glyphs;
//   design-artefact       the mockup's own CSS draws something the product does not mean (a flex
//                         gap that splits one string into two items, an element frozen mid-press);
//                         names the CSS cause. The design fix is the reviewer's; the references change
//                         only when the design does.
// ---------------------------------------------------------------------------------------------

export const WAIVABLE_RULES = Object.freeze(['missing', 'bounds', 'text', 'fill', 'border', 'text-ink', 'structure']);
export const WAIVER_CLASSES = Object.freeze(['platform', 'platform-text-shaping', 'design-artefact']);
const WAIVER_KEYS = ['frame', 'testID', 'rule', 'class', 'devices', 'themes', 'langs', 'reason', 'glyphs', 'designCause', 'reportedOn'];

/** Class-specific checks; returns [message, fix] or null. */
function classProblem(w) {
  const cls = w.class ?? 'platform';
  if (!WAIVER_CLASSES.includes(cls)) return [`class "${cls}" is not a waiver class`, `Use one of ${WAIVER_CLASSES.join(', ')} (omit it for platform).`];
  if (cls !== 'platform-text-shaping' && w.glyphs !== undefined) return ['"glyphs" belongs to a platform-text-shaping waiver', 'Remove it, or use class platform-text-shaping.'];
  if (cls !== 'design-artefact' && w.designCause !== undefined) return ['"designCause" belongs to a design-artefact waiver', 'Remove it, or use class design-artefact.'];
  if (cls === 'platform-text-shaping') {
    if (w.rule !== 'text-ink') return [`a platform-text-shaping waiver covers text-ink only, not "${w.rule}"`, 'Shaping changes glyph ink; any other rule is a fix in the app.'];
    if (typeof w.glyphs !== 'string' || !w.glyphs.trim()) return ['needs "glyphs": the characters or marks the platform shapes differently', 'Name the glyphs, measured on the zoomed crop.'];
  }
  if (cls === 'design-artefact') {
    if (w.rule === 'missing') return ['a design-artefact waiver cannot cover "missing"', 'Build the element; ask the reviewer if the design should not have it.'];
    if (typeof w.designCause !== 'string' || w.designCause.trim().length < 10 || !/[{:]/.test(w.designCause)) {
      return ['needs "designCause": the mockup CSS that draws the artefact (for example ".chip{display:inline-flex;gap:6px}")', 'Quote the rule from the mockup and say what it does to this element.'];
    }
  }
  return null;
}

export function readWaivers(path) {
  if (!path || !existsSync(path)) return { path, waivers: [], problems: [] };
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { path, waivers: [], problems: [{ rule: 'waiver-invalid', message: `not valid JSON: ${error.message}`, fix: 'Fix the JSON syntax.' }] };
  }
  const problems = [];
  const waivers = [];
  if (json.version !== 1 || !Array.isArray(json.waivers)) problems.push({ rule: 'waiver-invalid', message: 'expected { "version": 1, "waivers": [...] }', fix: "Start from the skill's templates/design/parity/waivers.json." });
  (Array.isArray(json.waivers) ? json.waivers : []).forEach((w, i) => {
    const at = `waiver ${i + 1}${w?.frame ? ` (${w.frame} ${w.testID ?? '?'} ${w.rule ?? '?'})` : ''}`;
    const bad = (message, fix) => problems.push({ rule: 'waiver-invalid', message: `${at}: ${message}`, fix });
    if (!w || typeof w !== 'object') return bad('is not an object', 'Remove it.');
    const extra = Object.keys(w).filter((k) => !WAIVER_KEYS.includes(k));
    if (extra.length) return bad(`unknown field(s) ${extra.join(', ')}`, `A waiver has only ${WAIVER_KEYS.join(', ')}; it can never change a tolerance.`);
    if (typeof w.frame !== 'string' || typeof w.testID !== 'string' || !w.testID || w.testID.includes('*')) return bad('needs a frame and one exact testID', 'Name the frame key and the testID (no wildcards).');
    if (!WAIVABLE_RULES.includes(w.rule)) return bad(`rule "${w.rule}" cannot be waived`, `Waivable rules: ${WAIVABLE_RULES.join(', ')}. A wrong capture or an unreached screen is never waived.`);
    const classIssue = classProblem(w);
    if (classIssue) return bad(...classIssue);
    if (typeof w.reason !== 'string' || w.reason.trim().length < 20) return bad('needs a reason of at least 20 characters naming the platform limit or the design artefact', 'Say exactly what the platform cannot draw (or what the mockup CSS does) and why.');
    if (typeof w.reportedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.reportedOn)) return bad('needs "reportedOn": "YYYY-MM-DD"', 'Tell the reviewer in the task report, then record the date.');
    for (const key of ['devices', 'themes', 'langs']) if (w[key] !== undefined && (!Array.isArray(w[key]) || w[key].length === 0)) return bad(`"${key}" must be a non-empty list when present`, 'Omit it to mean every value.');
    // A platform limit is measured on one platform: an iOS waiver never covers an Android run.
    if ((w.class ?? 'platform') !== 'design-artefact' && w.devices === undefined) return bad(`a ${w.class ?? 'platform'} waiver needs "devices": the device profiles whose runs showed the limit`, 'List the devices the limit was measured on; never copy an iOS waiver to Android without its own evidence (only a design-artefact waiver, shared by every device, may omit it).');
    waivers.push({ ...w, class: w.class ?? 'platform', index: i + 1 });
  });
  return { path, waivers, problems };
}

const appliesTo = (w, info) => w.frame === info.frame && (!w.devices || w.devices.includes(info.device)) && (!w.themes || w.themes.includes(info.theme)) && (!w.langs || w.langs.includes(info.lang));

/** Split problems into { kept, waived, unused } for one run. */
export function applyWaivers(problems, waivers, info) {
  const kept = [];
  const waived = [];
  const used = new Set();
  for (const p of problems) {
    const w = waivers.find((x) => appliesTo(x, info) && x.rule === p.rule && x.testID === p.testID);
    if (w) {
      waived.push({ ...p, waiver: { index: w.index, class: w.class, reason: w.reason, reportedOn: w.reportedOn } });
      used.add(w.index);
    } else kept.push(p);
  }
  const unused = waivers.filter((w) => appliesTo(w, info) && !used.has(w.index));
  return { kept, waived, unused };
}

// ---------------------------------------------------------------------------------------------
// Known platform causes: differences every correct build shows for a known reason. They are never
// waived automatically; check-parity names the cause in the fix text so the builder opens the crop,
// confirms the difference is exactly that and nothing else, and then writes a platform waiver:
//   dashed or dotted borders  React Native draws borderStyle 'dashed' / 'dotted' with its own dash
//                             length and corner phase on iOS and Android, and no style sets them; the
//                             edge differs along the dashes only (a missing or thicker dashed edge is
//                             still a fix);
//   rotated views (iOS)       iOS draws the edges of a rotated view without antialiasing (React
//                             Native exposes no allowsEdgeAntialiasing), so Chrome's antialiased edge
//                             pixels next to a text on a tilted surface count as ink and the app's
//                             stepped edge does not.
// ---------------------------------------------------------------------------------------------

/** The known platform cause of one problem, or null: { cause, waiver }. */
export function knownCauseFor(problem, element, platform) {
  if (!element) return null;
  const border = String(element.style?.border ?? '');
  if (problem.rule === 'structure' && /\b(dashed|dotted)\b/.test(border)) {
    return { cause: `dashed border (${border}): React Native's dash length and phase differ from the browser's on ${platform === 'android' ? 'Android' : 'iOS'}, and no style sets them` };
  }
  if (problem.rule === 'text-ink' && platform === 'ios' && Number(element.box?.rotate ?? 0) !== 0) {
    return { cause: `a text on a rotated view (${element.box.rotate} deg): iOS draws a rotated view's edge without antialiasing, so the browser's edge pixels next to the text count as ink` };
  }
  return null;
}
