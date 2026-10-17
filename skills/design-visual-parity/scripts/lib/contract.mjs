// The parity contract: which design frames exist, what each one shows and how the app reaches it.
// Two repo-owned files feed it:
//   contracts/screens.json        (screen-contracts) every screen, its states and every element with
//                                 its testID, role, component, copy keys and screenshot reach
//                                 (parent, a11yHidden, coveredBy, checks). A state with a
//                                 "reference" ("tasks-default.png") is a design frame; its key is
//                                 the file name without the extension.
//   contracts/visual-parity.json  (this skill) the done set (themes x languages x devices), where the
//                                 references, waivers, ledger, runs and summary live, the mockup
//                                 adapter, the layout facts the gates need (fixed header, pinned and
//                                 dialog components), the measured type-role floors, the app's facts,
//                                 the harness folder, and per frame: kind, root, keys, masks, modal
//                                 layer, probed region, app-drawn picture, design masks, variants.
// Every script loads both through loadParity(); a broken contract is exit 2 (bad input), except in
// check-harness.mjs, which reports each problem as contract-invalid.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { fail, parseJsonc, resolveLayout, toPosix } from '../check-lib.mjs';

export const CONTRACT_FILE = 'visual-parity.json';
export const SCREENS_FILE = 'screens.json';
/** screen-contracts' default folder for the reference images its states name. */
export const SCREEN_REFERENCES_DEFAULT = 'design/screens';
export const KINDS = Object.freeze(['phone', 'phone-tall', 'state-card']);
export const THEMES = Object.freeze(['light', 'dark']);
export const CHECKS = Object.freeze(['bounds', 'text', 'fill', 'crop']);
export const TESTID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const DERIVE_OPS = ['hide', 'style', 'text'];
const VARIANT_SCOPES = ['frame', 'background'];
/** The largest type-role floor a contract may declare (pt): the worst role ever measured was 2.57. */
export const MAX_ROLE_FLOOR_PT = 3;
/** rn-skills.config.json keys this skill reads (documented in references/contract-format.md). */
export const CONFIG_KEYS = Object.freeze({ contract: 'visualParityContract', screens: 'screensContract' });
/** Defaults of the paths a contract may set (repo-relative). */
export const PATH_DEFAULTS = Object.freeze({
  referencesDir: 'design/parity',
  runsDir: '.parity',
  summary: 'reports/parity/summary.json',
  harnessDir: 'src/features/parity',
});

const CONTRACT_KEYS = ['$schema', '$comment', 'version', 'screensContract', 'referencesDir', 'waivers', 'signoff', 'runsDir', 'summary', 'mockup', 'themes', 'languages', 'rtlLanguages', 'devices', 'launch', 'harness', 'layout', 'textRoleFloors', 'facts', 'frames'];
const FRAME_KEYS = ['$comment', 'kind', 'root', 'settleMs', 'keys', 'masks', 'modal', 'probe', 'appDrawn', 'designMasks', 'when', 'variants'];
const MOCKUP_KEYS = ['file', 'query', 'htmlAttributes', 'css', 'fonts'];
const LAYOUT_KEYS = ['fixedHeaderPt', 'pinnedComponents', 'dialogComponents'];
const LAUNCH_KEYS = ['scheme', 'ios', 'android'];
const HARNESS_KEYS = ['dir', 'fixture'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRepoPath = (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.split(/[\\/]/).includes('..');

function readJsonFile(abs, what) {
  if (!existsSync(abs)) return { missing: true };
  try {
    return { data: parseJsonc(readFileSync(abs, 'utf8')) };
  } catch (error) {
    return { error: `${what} is not valid JSON: ${String(error.message).split('\n')[0]}` };
  }
}

/** Where the contract lives: --contract, then rn-skills.config.json, then <contractsDir>/visual-parity.json. */
export function contractPaths(root, { contract = null } = {}) {
  const layout = resolveLayout(root);
  const config = layout.config ?? {};
  const rel = toPosix(contract ?? config[CONFIG_KEYS.contract] ?? join(layout.contractsDir, CONTRACT_FILE));
  return { layout, rel, abs: join(layout.root, rel) };
}

/**
 * The app's facts as a reference variant sees them: { values: { fact: [allowed values] }, design:
 * { fact: value the mockup draws }, app: { fact: value this app has } }. Returns problems (strings).
 */
function factProblems(facts) {
  const out = [];
  if (facts === undefined) return out;
  if (!isObject(facts) || !isObject(facts.values) || !isObject(facts.design) || !isObject(facts.app)) {
    return ['facts must be { "values": { "<fact>": [<allowed values>] }, "design": { ... }, "app": { ... } }'];
  }
  for (const [name, allowed] of Object.entries(facts.values)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) out.push(`facts.values.${name}: a fact name is camelCase`);
    if (!Array.isArray(allowed) || allowed.length < 2) out.push(`facts.values.${name} must list at least two allowed values`);
  }
  for (const side of ['design', 'app']) {
    for (const name of Object.keys(facts.values)) {
      if (!(name in facts[side])) out.push(`facts.${side} lacks the fact "${name}" (every fact needs a value on both sides: a reference is never guessed)`);
      else if (Array.isArray(facts.values[name]) && !facts.values[name].includes(facts[side][name])) out.push(`facts.${side}.${name} is ${JSON.stringify(facts[side][name])}, not one of ${JSON.stringify(facts.values[name])}`);
    }
    for (const name of Object.keys(facts[side])) if (!(name in facts.values)) out.push(`facts.${side} names the unknown fact "${name}"`);
  }
  return out;
}

/** Problems of a facts condition ({ fact: value }) against the declared facts. */
function whenProblems(when, facts, at) {
  if (!isObject(when) || Object.keys(when).length === 0) return [`${at} must be a non-empty { "<fact>": <value> } object`];
  const out = [];
  for (const [name, value] of Object.entries(when)) {
    if (!Array.isArray(facts?.values?.[name])) out.push(`${at} names the fact "${name}", which facts.values does not declare`);
    else if (!facts.values[name].includes(value)) out.push(`${at}.${name} is ${JSON.stringify(value)}, not one of ${JSON.stringify(facts.values[name])}`);
  }
  return out;
}

/** True when every fact the condition names has that value. */
export function factsMatch(when, facts) {
  return Object.entries(when ?? {}).every(([key, value]) => facts?.[key] === value);
}

/**
 * Structural problems of contracts/visual-parity.json, as [{ message, fix }]. Cross-file checks (frames
 * against the screen contract) are done by buildFrames().
 */
export function contractProblems(data) {
  const out = [];
  const bad = (message, fix = 'Fix the contract (references/contract-format.md).') => out.push({ message, fix });
  if (!isObject(data)) return [{ message: 'the contract is not a JSON object', fix: "Start from the skill's templates/contracts/visual-parity.json." }];
  for (const key of Object.keys(data)) if (!CONTRACT_KEYS.includes(key)) bad(`unknown key "${key}"`, `The keys are ${CONTRACT_KEYS.filter((k) => !k.startsWith('$')).join(', ')}.`);
  if (data.version !== 1) bad('"version" must be 1');
  for (const key of ['screensContract', 'referencesDir', 'waivers', 'signoff', 'runsDir', 'summary']) if (data[key] !== undefined && !isRepoPath(data[key])) bad(`${key} must be a repo-relative path`);
  if (!Array.isArray(data.themes) || data.themes.length === 0 || data.themes.some((t) => !THEMES.includes(t))) bad(`themes must list ${THEMES.join(' and/or ')}`, 'The done set is every theme the app ships: ["light", "dark"].');
  if (!Array.isArray(data.languages) || data.languages.length === 0 || data.languages.some((l) => typeof l !== 'string' || !LANG.test(l))) bad("languages must list the app's language codes (en, ar, ...)");
  if (data.rtlLanguages !== undefined && (!Array.isArray(data.rtlLanguages) || data.rtlLanguages.some((l) => !(data.languages ?? []).includes(l)))) bad('rtlLanguages must be a list of codes from languages');
  if (!Array.isArray(data.devices) || data.devices.length === 0 || data.devices.some((d) => typeof d !== 'string' || !KEBAB.test(d))) bad('devices must list device profile ids (kebab-case, e.g. "iphone-16-pro")');
  if (!isObject(data.mockup) || !isRepoPath(data.mockup.file)) bad('mockup.file must name the design mockup (a repo-relative HTML file)');
  else {
    for (const key of Object.keys(data.mockup)) if (!MOCKUP_KEYS.includes(key)) bad(`mockup has the unknown key "${key}"`, `mockup holds ${MOCKUP_KEYS.join(', ')}.`);
    if (data.mockup.htmlAttributes !== undefined && (!isObject(data.mockup.htmlAttributes) || Object.values(data.mockup.htmlAttributes).some((v) => typeof v !== 'string'))) bad('mockup.htmlAttributes must map attribute names to templates ("{theme}", "{lang}", "{dir}")');
    if (data.mockup.query !== undefined && (typeof data.mockup.query !== 'string' || !data.mockup.query.startsWith('?'))) bad('mockup.query must be a query template starting with "?" ("?theme={theme}&lang={lang}")');
    if (data.mockup.css !== undefined && typeof data.mockup.css !== 'string') bad('mockup.css must be a string of CSS');
    if (data.mockup.fonts !== undefined && !isRepoPath(data.mockup.fonts)) bad('mockup.fonts must be a repo-relative folder');
  }
  if (data.launch !== undefined) {
    if (!isObject(data.launch)) bad('launch must be { "scheme", "ios", "android" }');
    else {
      for (const key of Object.keys(data.launch)) if (!LAUNCH_KEYS.includes(key)) bad(`launch has the unknown key "${key}"`, `launch holds ${LAUNCH_KEYS.join(', ')}.`);
      if (data.launch.scheme !== undefined && (typeof data.launch.scheme !== 'string' || !/^[a-z][a-z0-9+.-]*$/.test(data.launch.scheme))) bad('launch.scheme must be the URL scheme of the build that is captured (lower case)');
      for (const key of ['ios', 'android']) if (data.launch[key] !== undefined && (typeof data.launch[key] !== 'string' || !/^[A-Za-z][\w.-]*\.[\w.-]+$/.test(data.launch[key]))) bad(`launch.${key} must be the ${key === 'ios' ? 'bundle identifier' : 'application id'} of the build that is captured`);
    }
  }
  if (data.harness !== undefined) {
    if (!isObject(data.harness)) bad('harness must be { "dir", "fixture" }');
    else {
      for (const key of Object.keys(data.harness)) if (!HARNESS_KEYS.includes(key)) bad(`harness has the unknown key "${key}"`, `harness holds ${HARNESS_KEYS.join(', ')}.`);
      for (const key of HARNESS_KEYS) if (data.harness[key] !== undefined && !isRepoPath(data.harness[key])) bad(`harness.${key} must be a repo-relative path`);
    }
  }
  if (data.layout !== undefined) {
    if (!isObject(data.layout)) bad('layout must be an object');
    else {
      for (const key of Object.keys(data.layout)) if (!LAYOUT_KEYS.includes(key)) bad(`layout has the unknown key "${key}"`, `layout holds ${LAYOUT_KEYS.join(', ')}.`);
      if (data.layout.fixedHeaderPt !== undefined && !(Number.isFinite(data.layout.fixedHeaderPt) && data.layout.fixedHeaderPt >= 0)) bad('layout.fixedHeaderPt must be a number of points >= 0');
      for (const key of ['pinnedComponents', 'dialogComponents']) if (data.layout[key] !== undefined && (!Array.isArray(data.layout[key]) || data.layout[key].some((c) => typeof c !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(c)))) bad(`layout.${key} must list PascalCase component names`);
    }
  }
  if (data.textRoleFloors !== undefined) {
    if (!isObject(data.textRoleFloors)) bad('textRoleFloors must be { "<font family>": { "<size>": { "floor": <pt>, "probe": "<evidence>" } } }');
    else {
      for (const [family, sizes] of Object.entries(data.textRoleFloors)) {
        if (!isObject(sizes)) {
          bad(`textRoleFloors.${family} must be an object keyed by font size`);
          continue;
        }
        for (const [size, entry] of Object.entries(sizes)) {
          const at = `textRoleFloors.${family}.${size}`;
          if (!/^\d+$/.test(size)) bad(`${at}: the key is a whole font size in px`);
          if (!isObject(entry) || !Number.isFinite(entry.floor) || entry.floor < 0) bad(`${at} must be { "floor": <pt>, "probe": "<evidence>" }`);
          else if (entry.floor > MAX_ROLE_FLOOR_PT) bad(`${at}: floor ${entry.floor} pt is above ${MAX_ROLE_FLOOR_PT} pt, more than any type role ever measured; a floor that large hides a real offset`, 'Measure the role again with the type-role probe (references/what-exact-means.md); fix the text style if the app really draws it that far off.');
          if (isObject(entry) && (typeof entry.probe !== 'string' || entry.probe.trim().length < 20)) bad(`${at} needs "probe": the evidence (date, device, run folder) of at least 20 characters`, 'Record where the floor was measured: a floor without evidence is a widened tolerance.');
        }
      }
    }
  }
  for (const message of factProblems(data.facts)) bad(message);
  if (!isObject(data.frames)) bad('frames must be an object keyed by frame key (the reference file name without .png); {} when no frame needs settings');
  else {
    for (const [key, frame] of Object.entries(data.frames)) {
      const at = `frames.${key}`;
      if (!KEBAB.test(key)) bad(`${at}: a frame key is kebab-case`);
      if (!isObject(frame)) {
        bad(`${at} must be an object`);
        continue;
      }
      for (const k of Object.keys(frame)) if (!FRAME_KEYS.includes(k)) bad(`${at} has the unknown key "${k}"`, `A frame holds ${FRAME_KEYS.filter((f) => !f.startsWith('$')).join(', ')}.`);
      if (frame.kind !== undefined && !KINDS.includes(frame.kind)) bad(`${at}.kind must be ${KINDS.join(', ')}`);
      if (frame.root !== undefined && (typeof frame.root !== 'string' || !TESTID_PATTERN.test(frame.root))) bad(`${at}.root must be a testID`);
      if (frame.settleMs !== undefined && !(Number.isInteger(frame.settleMs) && frame.settleMs >= 1000 && frame.settleMs <= 60000)) bad(`${at}.settleMs must be whole milliseconds from 1000 to 60000`);
      if (frame.keys !== undefined && (!isObject(frame.keys) || Object.values(frame.keys).some((list) => !Array.isArray(list) || list.length === 0 || list.some((v) => typeof v !== 'string' || !KEBAB.test(v))))) bad(`${at}.keys must map each {key} of a keyed testID to the fixture's ids (kebab-case strings)`);
      if (frame.masks !== undefined && (!Array.isArray(frame.masks) || frame.masks.some((id) => typeof id !== 'string'))) bad(`${at}.masks must list testIDs`);
      if (frame.modal !== undefined && (!isObject(frame.modal) || typeof frame.modal.reachedBy !== 'string' || !Array.isArray(frame.modal.hidden) || frame.modal.hidden.length === 0)) bad(`${at}.modal must be { "reachedBy": "<testID of the modal layer>", "hidden": ["<testIDs behind it>"] }`);
      if (frame.probe !== undefined && (!isObject(frame.probe) || typeof frame.probe.region !== 'string' || !KEBAB.test(frame.probe.region) || (frame.probe.element !== undefined && typeof frame.probe.element !== 'string') || (frame.probe.testID !== undefined && (typeof frame.probe.testID !== 'string' || !TESTID_PATTERN.test(frame.probe.testID))) || (frame.probe.above !== undefined && !Array.isArray(frame.probe.above)))) bad(`${at}.probe must be { "region": "<kebab id>", "element": "<the design's placeholder testID>", "above": ["<testIDs drawn over it>"], "testID": "<the probe element, default parity.probe.<region>>" }`);
      if (frame.appDrawn !== undefined && typeof frame.appDrawn !== 'string') bad(`${at}.appDrawn must name one testID (a picture the app draws with its own code)`);
      if (frame.probe !== undefined && frame.appDrawn !== undefined) bad(`${at}: use one of "probe" and "appDrawn"`);
      if (frame.designMasks !== undefined && (!Array.isArray(frame.designMasks) || frame.designMasks.some((m) => !isObject(m) || typeof m.selector !== 'string' || typeof m.as !== 'string' || typeof m.why !== 'string' || m.why.length < 20))) bad(`${at}.designMasks: every mask is { "selector": "<CSS>", "as": "<testID it stands for>", "why": "<20+ characters>" }`);
      if (frame.when !== undefined) {
        if (!isObject(frame.when)) bad(`${at}.when must map testIDs to facts conditions`);
        else for (const [id, cond] of Object.entries(frame.when)) for (const m of whenProblems(cond, data.facts, `${at}.when.${id}`)) bad(m);
      }
      if (frame.variants !== undefined) {
        if (!isObject(frame.variants)) {
          bad(`${at}.variants must be an object keyed by variant id`);
          continue;
        }
        for (const [id, v] of Object.entries(frame.variants)) {
          const vat = `${at}.variants.${id}`;
          if (!KEBAB.test(id)) bad(`${vat}: a variant id is kebab-case (files are <frame>--<variant>.png)`);
          if (!isObject(v)) {
            bad(`${vat} must be an object`);
            continue;
          }
          for (const m of whenProblems(v.when, data.facts, `${vat}.when`)) bad(m);
          if (isObject(v.when) && data.facts && factsMatch(v.when, data.facts.design)) bad(`${vat}.when must name a fact value the mockup does not draw (the base reference already shows ${JSON.stringify(data.facts.design)})`);
          if (typeof v.reason !== 'string' || v.reason.trim().length < 10) bad(`${vat}.reason must say who decided the variant and why (10+ characters)`);
          if (v.scope !== undefined && !VARIANT_SCOPES.includes(v.scope)) bad(`${vat}.scope must be ${VARIANT_SCOPES.join(' or ')}`);
          if (!Array.isArray(v.derive) || v.derive.length === 0) bad(`${vat}.derive must list the DOM changes: { "hide": "<selector>" }, { "style": "<selector>", "css": { ... } }, { "text": "<selector>", "texts": { "<lang>": "..." } }`);
          else {
            for (const step of v.derive) {
              const kinds = DERIVE_OPS.filter((k) => typeof step?.[k] === 'string');
              if (kinds.length !== 1) bad(`${vat}.derive: every step names exactly one of ${DERIVE_OPS.join(', ')} with a selector`);
              else if (kinds[0] === 'style' && !isObject(step.css)) bad(`${vat}.derive: a style step needs "css": { "<property>": "<value>" }`);
              else if (kinds[0] === 'text' && (!isObject(step.texts) || (data.languages ?? []).some((l) => typeof step.texts[l] !== 'string'))) bad(`${vat}.derive: a text step needs "texts" with the text in every language of the done set`);
            }
          }
        }
      }
    }
  }
  return out;
}

/** Expand a keyed testID (tasks.task-row.{taskId}) with the frame's keys; [] when a key is unknown. */
export function expandTestID(testID, keys = {}) {
  return expandKeyed(testID, keys).map((e) => e.id);
}

/** Like expandTestID, with the key values each id used: [{ id, values: { taskId: 'milk' } }]. */
export function expandKeyed(testID, keys = {}) {
  const names = [...new Set([...testID.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]))];
  let out = [{ id: testID, values: {} }];
  for (const name of names) {
    const values = keys[name];
    if (!Array.isArray(values)) return [];
    out = out.flatMap((e) => values.map((v) => ({ id: e.id.replaceAll(`{${name}}`, v), values: { ...e.values, [name]: v } })));
  }
  return out;
}

/** A keyed reference (parent, coveredBy) filled with the same key values as its element. */
function fillKeys(template, values, keys) {
  if (typeof template !== 'string') return null;
  let id = template;
  for (const [name, value] of Object.entries(values)) id = id.replaceAll(`{${name}}`, value);
  return /\{[A-Za-z]/.test(id) ? (expandTestID(id, keys)[0] ?? id) : id;
}

/** The metadata of one screen-contract element as the gates read it. */
function elementOf(el, frame, testID, screen, values = {}) {
  return {
    testID,
    screen: screen.id,
    role: el.role ?? 'none',
    component: el.component ?? null,
    kind: el.kind ?? null,
    text: el.text ?? null,
    checks: Array.isArray(el.checks) ? el.checks : ['bounds'],
    mask: (frame.masks ?? []).includes(testID) || (frame.masks ?? []).includes(el.testID),
    parent: fillKeys(el.parent, values, frame.keys),
    a11yHidden: el.a11yHidden === true,
    coveredBy: fillKeys(el.coveredBy, values, frame.keys),
    a11yLabel: typeof el.a11yLabel === 'string',
    when: frame.when?.[testID] ?? frame.when?.[el.testID] ?? null,
  };
}

/**
 * The frame catalogue: Map<frameKey, frame>. A frame is a screen-contract state with a reference
 * image; its parity entry (contracts/visual-parity.json frames.<key>) adds kind, root, keys, masks,
 * the modal layer, a probed region and variants. Returns { frames, problems } (problems: strings).
 */
export function buildFrames(screens, contract) {
  const problems = [];
  const frames = new Map();
  const entries = isObject(contract.frames) ? contract.frames : {};
  for (const screen of Array.isArray(screens?.screens) ? screens.screens : []) {
    for (const state of Array.isArray(screen.states) ? screen.states : []) {
      if (typeof state?.reference !== 'string') continue;
      const key = basename(state.reference).replace(/\.png$/i, '');
      if (frames.has(key)) {
        problems.push(`the reference ${state.reference} is used by two states (${frames.get(key).screen} ${frames.get(key).state} and ${screen.id} ${state.id}); one frame, one state`);
        continue;
      }
      if (!KEBAB.test(key)) problems.push(`the reference "${state.reference}" of ${screen.id} ${state.id} is not a kebab-case file name (<frame-key>.png)`);
      const entry = isObject(entries[key]) ? entries[key] : {};
      const frame = { key, screen: screen.id, state: state.id, presentation: screen.presentation ?? 'route', reference: state.reference, kind: entry.kind ?? 'phone', keys: entry.keys ?? {}, masks: entry.masks ?? [], when: entry.when ?? {}, settleMs: entry.settleMs ?? null, designMasks: entry.designMasks ?? [], elements: [] };
      for (const el of Array.isArray(screen.elements) ? screen.elements : []) {
        if (typeof el?.testID !== 'string') continue;
        if (Array.isArray(el.states) && !el.states.includes(state.id)) continue;
        const ids = expandKeyed(el.testID, frame.keys);
        if (ids.length === 0) problems.push(`frame ${key}: ${el.testID} is keyed, but frames.${key}.keys does not give the fixture's ids for it`);
        for (const { id, values } of ids) frame.elements.push(elementOf(el, frame, id, screen, values));
      }
      const ids = new Set(frame.elements.map((el) => el.testID));
      const defaultRoot = frame.elements.find((el) => el.testID === `${screen.id}.screen`)?.testID ?? frame.elements.find((el) => el.testID === `${screen.id}.scrim`)?.testID ?? null;
      frame.root = entry.root ?? defaultRoot;
      if (!frame.root) problems.push(`frame ${key} has no root: give frames.${key}.root (the testID on the screen's outer view), or list ${screen.id}.screen (a dialog: ${screen.id}.scrim) in the screen contract`);
      else if (!ids.has(frame.root)) problems.push(`frame ${key}: the root ${frame.root} is not one of the frame's testIDs`);
      for (const id of frame.masks) if (!ids.has(id)) problems.push(`frame ${key}: masks names ${id}, which is not a testID of the frame`);
      for (const id of Object.keys(frame.when)) if (!ids.has(id)) problems.push(`frame ${key}: when names ${id}, which is not a testID of the frame`);
      frame.modal = null;
      if (isObject(entry.modal)) {
        if (!ids.has(entry.modal.reachedBy)) problems.push(`frame ${key}: modal.reachedBy ${entry.modal.reachedBy} is not a testID of the frame`);
        for (const id of entry.modal.hidden ?? []) {
          if (!ids.has(id)) problems.push(`frame ${key}: modal.hidden names ${id}, which is not a testID of the frame`);
          if (id === frame.root || id === entry.modal.reachedBy) problems.push(`frame ${key}: modal.hidden may not name the root or reachedBy (${id})`);
        }
        frame.modal = { reachedBy: entry.modal.reachedBy, hidden: [...(entry.modal.hidden ?? [])] };
      }
      frame.probe = null;
      if (isObject(entry.probe)) {
        for (const id of entry.probe.above ?? []) if (!ids.has(id)) problems.push(`frame ${key}: probe.above names ${id}, which is not a testID of the frame`);
        if (entry.probe.element !== undefined && !ids.has(entry.probe.element)) problems.push(`frame ${key}: probe.element ${entry.probe.element} is not a testID of the frame`);
        frame.probe = { region: entry.probe.region, element: entry.probe.element ?? null, above: [...(entry.probe.above ?? [])], testID: entry.probe.testID ?? `parity.probe.${entry.probe.region}` };
      }
      frame.appDrawn = null;
      if (typeof entry.appDrawn === 'string') {
        const el = frame.elements.find((e) => e.testID === entry.appDrawn);
        if (!el || el.parent || el.a11yHidden) problems.push(`frame ${key}: appDrawn must name a reachable testID of the frame (the picture the app draws)`);
        frame.appDrawn = { testID: entry.appDrawn };
      }
      frame.variants = variantsOf(key, entry.variants, contract.facts, frame, problems);
      frames.set(key, frame);
    }
  }
  for (const key of Object.keys(entries)) if (!frames.has(key)) problems.push(`frames.${key} names a frame no screen-contract state references (a state's "reference": "${key}.png")`);
  if ([...frames.values()].some((f) => f.kind === 'phone-tall') && !Number.isFinite(contract.layout?.fixedHeaderPt)) {
    problems.push('a phone-tall frame needs layout.fixedHeaderPt: the height (pt, below the safe area) of the header that stays put while the body scrolls');
  }
  return { frames, problems };
}

function variantsOf(key, variants, facts, frame, problems) {
  if (!isObject(variants)) return {};
  const out = {};
  for (const [id, v] of Object.entries(variants)) {
    if (!isObject(v) || !isObject(v.when)) continue;
    const scope = v.scope ?? 'frame';
    const all = { ...(facts?.design ?? {}), ...v.when };
    const changed = frame.elements.filter((el) => el.when && factsMatch(el.when, all) !== factsMatch(el.when, facts?.design ?? {}));
    if (scope === 'frame' && changed.length === 0) problems.push(`frame ${key}: variant ${id} changes no element of the frame (mark the elements that exist only for some facts in frames.${key}.when, or use "scope": "background")`);
    if (scope === 'background' && changed.length > 0) problems.push(`frame ${key}: variant ${id} is "background" but ${changed.map((el) => el.testID).join(', ')} change with ${JSON.stringify(v.when)}`);
    out[id] = { id, when: v.when, derive: v.derive ?? [], reason: v.reason ?? '', scope, facts: all };
  }
  return out;
}

/** One reference variant made of several variants (in contract order): ids joined with "--". */
export function composeVariants(list, designFacts = {}) {
  if (!list.length) return null;
  const when = Object.assign({}, ...list.map((v) => v.when));
  return {
    id: list.map((v) => v.id).join('--'),
    parts: list.map((v) => v.id),
    when,
    facts: { ...designFacts, ...when },
    derive: list.flatMap((v) => v.derive),
    reason: list.map((v) => v.reason).join('; '),
    scope: list.every((v) => v.scope === 'background') ? 'background' : 'frame',
  };
}

/** Every reference of a frame: the base (null), then each combination of variants that can hold together. */
export function referencePlan(frame, designFacts = {}) {
  const list = Object.values(frame.variants ?? {});
  const combos = [];
  for (let mask = 1; mask < 1 << list.length; mask += 1) {
    const chosen = list.filter((_v, i) => mask & (1 << i));
    const when = {};
    let agrees = true;
    for (const v of chosen) {
      for (const [k, value] of Object.entries(v.when)) {
        if (k in when && when[k] !== value) agrees = false;
        when[k] = value;
      }
    }
    if (agrees) combos.push({ mask, size: chosen.length, variant: composeVariants(chosen, designFacts) });
  }
  combos.sort((a, b) => a.size - b.size || a.mask - b.mask);
  return [null, ...combos.map((c) => c.variant)];
}

/** The variant the app's facts select (every matching variant, composed), or null for the base. */
export function variantFor(frame, facts, designFacts = {}) {
  return composeVariants(Object.values(frame.variants ?? {}).filter((v) => factsMatch(v.when, facts)), designFacts);
}

export function referenceName(frameKey, variantId) {
  return variantId ? `${frameKey}--${variantId}` : frameKey;
}

/** Every reference name of a frame (base and composed variants). */
export function referenceNames(frame, designFacts = {}) {
  return referencePlan(frame, designFacts).map((v) => referenceName(frame.key, v?.id));
}

export function describeReference(frameKey, variant) {
  if (!variant) return `${frameKey} (base)`;
  return `${referenceName(frameKey, variant.id)} (${Object.entries(variant.when).map(([k, v]) => `${k} ${v}`).join(', ')})`;
}

export function describeFacts(facts) {
  return Object.entries(facts ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
}

/** Elements that exist for these facts (an element's "when" must match). */
export function elementsForFacts(elements, facts) {
  return elements.filter((el) => !el.when || factsMatch(el.when, facts));
}

/** Device profile problems (strings). */
export function deviceProblems(device, id) {
  const out = [];
  const at = `device ${id}`;
  if (!isObject(device)) return [`${at} is not a JSON object`];
  if (device.id !== id) out.push(`${at}: "id" must be "${id}" (the file name)`);
  if (!['ios', 'android'].includes(device.platform)) out.push(`${at}: "platform" must be ios or android`);
  if (!isObject(device.points) || !(device.points.width > 0) || !(device.points.height > 0)) out.push(`${at}: "points" must be { "width", "height" } in pt (dp)`);
  if (!Number.isInteger(device.scale) || device.scale < 1) out.push(`${at}: "scale" must be the whole pixel ratio (3 for an iPhone 16 Pro; an Android profile pins its density to a whole ratio)`);
  if (!isObject(device.pixels) || !Number.isInteger(device.pixels.width) || !Number.isInteger(device.pixels.height)) out.push(`${at}: "pixels" must be the screenshot size in whole pixels`);
  else if (isObject(device.points) && Number.isInteger(device.scale) && (device.pixels.width !== device.points.width * device.scale || device.pixels.height !== device.points.height * device.scale)) out.push(`${at}: "pixels" must equal points x scale (${device.points.width * device.scale} x ${device.points.height * device.scale})`);
  if (!isObject(device.safeArea) || !Number.isFinite(device.safeArea.top) || !Number.isFinite(device.safeArea.bottom)) out.push(`${at}: "safeArea" must be { "top", "bottom" } in pt`);
  if (!Array.isArray(device.masks) || device.masks.some((m) => !isObject(m) || !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(m[k])))) out.push(`${at}: "masks" must list the OS-drawn areas as { x, y, width, height } in pt (status bar, home indicator or navigation bar)`);
  if (typeof device.name !== 'string' || !device.name) out.push(`${at}: "name" must say which device it is`);
  if (device.platform === 'ios' && (typeof device.deviceType !== 'string' || typeof device.runtime !== 'string' || typeof device.simulatorName !== 'string')) out.push(`${at}: an iOS profile needs "deviceType", "runtime" (simctl identifiers) and "simulatorName" (<project>-parity)`);
  if (device.platform === 'android' && (!isObject(device.avd) || typeof device.avd.systemImage !== 'string' || typeof device.avd.device !== 'string' || !Number.isInteger(device.avd.density) || typeof device.avd.name !== 'string')) out.push(`${at}: an Android profile needs "avd": { "name" (<project>-parity), "device", "systemImage", "density" } (avdmanager ids; density = 160 x scale)`);
  if (device.platform === 'android' && isObject(device.avd) && Number.isInteger(device.avd.density) && Number.isInteger(device.scale) && device.avd.density !== 160 * device.scale) out.push(`${at}: avd.density ${device.avd.density} is not 160 x scale (${160 * device.scale}); a fractional ratio makes every edge land between pixels`);
  return out;
}

/**
 * Load everything a parity script needs. `strict` (default) stops with exit 2 on the first
 * problem; strict false returns the problems instead (check-harness reports them).
 *   { root, layout, contractRel, contract, screensRel, screens, frames, devices: Map, problems,
 *     paths: { references, waivers, signoff, runs, summary, manifest, mockup, fixture, harness,
 *     appFixture }, designFacts, appFacts, rtl, missing, noFrames }
 */
export function loadParity(root, { contract: contractOption = null, strict = true } = {}) {
  const { layout, rel, abs } = contractPaths(root, { contract: contractOption });
  const problems = [];
  const stop = (message, fix) => {
    if (strict) fail(message, fix);
    problems.push({ file: rel, message, fix });
  };
  const read = readJsonFile(abs, rel);
  if (read.missing) return { root: layout.root, layout, contractRel: rel, missing: true, problems };
  if (read.error) {
    stop(read.error, 'Fix the JSON syntax.');
    return { root: layout.root, layout, contractRel: rel, missing: false, broken: true, problems };
  }
  const contract = read.data;
  for (const p of contractProblems(contract)) stop(`${rel}: ${p.message}`, p.fix);
  const config = layout.config ?? {};
  const screensRel = toPosix(contract.screensContract ?? config[CONFIG_KEYS.screens] ?? join(layout.contractsDir, SCREENS_FILE));
  const screensRead = readJsonFile(join(layout.root, screensRel), screensRel);
  let frames = new Map();
  let screens = null;
  let noFrames = false;
  if (screensRead.missing) stop(`the screen contract ${screensRel} does not exist, so the frames and their testIDs are unknown`, 'Create it with screen-contracts (contracts/screens.json): every design frame is a state with a "reference".');
  else if (screensRead.error) stop(screensRead.error, 'Fix the JSON syntax.');
  else {
    screens = screensRead.data;
    const built = buildFrames(screens, contract);
    frames = built.frames;
    for (const message of built.problems) stop(`${rel}: ${message}`, 'Make the screen contract and the parity contract agree (references/contract-format.md).');
    // No reference anywhere and no per-frame settings either: the app adopted the capture wiring
    // before any design was approved. The frame scripts then have nothing to compare (NOT APPLICABLE)
    // and check-harness still proves the wiring. Per-frame settings without a reference stay an error.
    const declared = contract.frames !== null && typeof contract.frames === 'object' ? Object.keys(contract.frames).length : 0;
    if (frames.size === 0 && declared === 0) noFrames = true;
    else if (frames.size === 0) stop(`${screensRel} has no state with a "reference", so there is no design frame to compare`, 'Give each design frame\'s state a "reference": "<frame>.png" in the screen contract.');
  }
  const referencesDir = toPosix(contract.referencesDir ?? PATH_DEFAULTS.referencesDir);
  const devices = new Map();
  for (const id of Array.isArray(contract.devices) ? contract.devices : []) {
    const deviceRel = `${referencesDir}/devices/${id}.json`;
    const d = readJsonFile(join(layout.root, deviceRel), deviceRel);
    if (d.missing) stop(`the device profile ${deviceRel} does not exist`, `Copy the skill's templates/design/parity/devices/ profile for ${id} there (or another profile).`);
    else if (d.error) stop(d.error, 'Fix the JSON syntax.');
    else {
      for (const message of deviceProblems(d.data, id)) stop(`${deviceRel}: ${message}`, "Start from the skill's device profile templates.");
      devices.set(id, { ...d.data, file: deviceRel });
    }
  }
  const harnessDir = toPosix(contract.harness?.dir ?? PATH_DEFAULTS.harnessDir);
  const paths = {
    references: referencesDir,
    manifest: `${referencesDir}/manifest.json`,
    fixture: `${referencesDir}/fixture.json`,
    waivers: toPosix(contract.waivers ?? `${referencesDir}/waivers.json`),
    signoff: toPosix(contract.signoff ?? `${referencesDir}/signoff.json`),
    runs: toPosix(contract.runsDir ?? PATH_DEFAULTS.runsDir),
    summary: toPosix(contract.summary ?? PATH_DEFAULTS.summary),
    mockup: toPosix(contract.mockup?.file ?? `${referencesDir}/mockup/index.html`),
    // screen-contracts' reference images (contracts/screens.json "references", its default
    // design/screens): shoot-design.mjs writes <frame>.png there, 1 pt = 1 px.
    screenReferences: toPosix(typeof screens?.references === 'string' ? screens.references : SCREEN_REFERENCES_DEFAULT),
    harness: harnessDir,
    appFixture: toPosix(contract.harness?.fixture ?? `${harnessDir}/parity-fixture.json`),
  };
  return {
    root: layout.root,
    layout,
    contractRel: rel,
    contract,
    screensRel,
    screens,
    frames,
    devices,
    problems,
    paths,
    designFacts: contract.facts?.design ?? {},
    appFacts: contract.facts?.app ?? {},
    rtl: new Set(contract.rtlLanguages ?? []),
    missing: false,
    noFrames,
  };
}

/** The NOT APPLICABLE reason of a frame script when the app has no approved design frame yet. */
export const NO_FRAMES_REASON = 'no screen state has a "reference" and the contract plans no frame: the app has no approved design frame to compare yet (check-harness still checks the capture wiring)';

/** Load the contract or stop: a missing contract is exit 2 for scripts that cannot work without it. */
export function requireParity(root, options = {}) {
  const parity = loadParity(root, options);
  if (parity.missing) fail(`${parity.contractRel} does not exist, so there is nothing to compare`, "Copy the skill's templates/contracts/visual-parity.json to contracts/ and fill it in (references/contract-format.md), or pass --contract <file>.");
  return parity;
}

/** The reference files of one frame on one device, theme and language (repo-relative). */
export function referenceFiles(parity, { device, theme, lang, frame, variant = null }) {
  const stem = referenceName(frame, variant);
  const dir = `${parity.paths.references}/${device}/${theme}-${lang}`;
  return { stem, dir, image: `${dir}/${stem}.png`, layout: `${dir}/${stem}.layout.json` };
}

/** One device by id, or exit 2 naming the profiles the contract lists. */
export function deviceOf(parity, id) {
  const chosen = id ?? (parity.devices.size === 1 ? [...parity.devices.keys()][0] : null);
  if (!chosen) fail(`the contract lists ${parity.devices.size} devices (${[...parity.devices.keys()].join(', ')}), so the device cannot be chosen`, 'Pass --device <id>.');
  const device = parity.devices.get(chosen);
  if (!device) fail(`unknown device "${chosen}"`, `Use one of ${[...parity.devices.keys()].join(', ')} (contracts/visual-parity.json "devices").`);
  return device;
}

/** Frame keys from --frame and --screen options (a screen id selects every frame of that screen). */
export function selectFrames(parity, { frame = [], screen = [], all = false } = {}) {
  let keys = listOption(frame, []);
  for (const id of listOption(screen, [])) {
    const matching = [...parity.frames.values()].filter((f) => f.screen === id).map((f) => f.key);
    if (!matching.length) fail(`no design frames for screen "${id}"`, `Screens with frames: ${[...new Set([...parity.frames.values()].map((f) => f.screen))].join(', ')}.`);
    keys.push(...matching);
  }
  if (all) keys = [...parity.frames.keys()];
  keys = [...new Set(keys)];
  for (const k of keys) if (!parity.frames.has(k)) fail(`unknown frame "${k}"`, `Frames: ${[...parity.frames.keys()].join(', ')}.`);
  return keys;
}

/** Split "a,b" and repeated options into a clean list. */
export function listOption(values, fallback) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean).flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : fallback;
}

/** Direction of a language in this contract. */
export function directionOf(parity, lang) {
  return parity.rtl.has(lang) ? 'rtl' : 'ltr';
}

/**
 * The reach policy (screen contract): Maestro lists only accessible elements and never their
 * children, and omits what a component hides from screen readers. Parts inside an accessible element
 * (parent) and decorative parts (a11yHidden) are therefore crop-only: never bounds-checked, never
 * "missing", and their pixels (text ink included) are judged inside the aligned crop of coveredBy.
 */
export function isCropOnly(el) {
  return Boolean(el.parent) || el.a11yHidden === true;
}

/**
 * Element fields a reference layout.json copies from the screen contract when it is rendered. They
 * are the contract's, not the render's: check-parity reads them from the current contract
 * (withContractMetadata), and shoot-design --check does not compare them, so a metadata fix (a
 * component name, a check) needs no re-render. Everything else in a layout is measured.
 */
export const CONTRACT_METADATA_KEYS = Object.freeze(['role', 'component', 'kind', 'checks', 'mask', 'parent', 'a11yHidden', 'coveredBy', 'a11yLabel', 'when']);

export function contractMetadataOf(el) {
  return {
    role: el.role,
    component: el.component,
    kind: el.kind ?? null,
    checks: el.checks ?? [],
    mask: el.mask === true,
    parent: el.parent ?? null,
    a11yHidden: el.a11yHidden === true,
    coveredBy: el.coveredBy ?? null,
    a11yLabel: el.a11yLabel === true,
    when: el.when ?? null,
  };
}

/** A reference layout with each element's metadata taken from the current contract (by testID). */
export function withContractMetadata(layout, frame) {
  if (!frame) return layout;
  const byId = new Map(frame.elements.map((el) => [el.testID, el]));
  return {
    ...layout,
    elements: (layout.elements ?? []).map((el) => {
      const mapped = byId.get(el.testID);
      return mapped ? { ...el, ...contractMetadataOf(mapped) } : el;
    }),
  };
}

/**
 * A reference layout seen through the frame's modal layer: the hidden elements become crop-only
 * parts of the root (never paired with Maestro, never "missing"; their pixels are compared in the
 * root's crop). Frames without a modal layer are returned unchanged.
 */
export function withModal(layout, frame) {
  if (!frame?.modal) return layout;
  const hidden = new Set(frame.modal.hidden);
  return {
    ...layout,
    elements: layout.elements.map((el) => (hidden.has(el.testID)
      ? { ...el, a11yHidden: true, coveredBy: layout.root, checks: (el.checks ?? []).some((c) => CHECKS.includes(c)) ? ['crop'] : [], behindModal: frame.modal.reachedBy }
      : el)),
  };
}
