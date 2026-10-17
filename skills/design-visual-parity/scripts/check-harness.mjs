#!/usr/bin/env node
// check-harness.mjs: proves the app side of design parity: the test-only parity harness is complete,
// planned for exactly the contract's frames, strict about its launch, reached only through the
// test-only entry, wired into the root as the parity kit (the registry's root slots), opens every
// frame state through the owning model, draws
// the launch marker in every modal root, loads the design's fixture unchanged, and the repo keeps
// the parity files where the gates expect them.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, maskComments, matchGlob, notYetCreated, parseArgs, parseJsonc, run, walkRepo } from './check-lib.mjs';
import { loadParity } from './lib/contract.mjs';
import { enableAppImports, reasonOf } from './lib/app-modules.mjs';
import { findJsxTags, isTestFile, maskCode, valueImports } from './lib/source-scan.mjs';
import { findConstInitializer, parseValue } from './lib/ts-literal.mjs';
import { readWaivers } from './lib/runs.mjs';

const SPEC = {
  name: 'check-harness',
  summary:
    'Checks the app side of design parity: the harness files (src/features/parity/ and the two production pieces, ' +
    'use-frame-request, use-frame-state-opener, use-frame-scroll-target and the launch marker), one plan per design frame with the contract\'s root, tall flag, probe ' +
    'and a state where the frame needs one, a strict launch parser (run on the app\'s own module), an opener for ' +
    'every frame state in a model, the launch marker in the parity root and every modal root, test-only reach (the ' +
    'entry, the wiring, no runtime import), the design fixture unchanged, every test-build switch set by the launch, ' +
    'nothing drawn by the harness, the runs folder git-ignored, the waiver file and ledger well formed, the parity ' +
    'files gated, and browser-rendered border widths in the component specs.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Paths come from the contract (harness.dir, harness.fixture, waivers, signoff, runsDir) and the layout',
    '(srcDir, routesDir; rn-skills.config.json). Allowed SKIP lines: the test-only entry before',
    'debug-menu-and-test-hooks made it, contracts/architecture.json before architecture-and-boundaries made it,',
    'quality-gates.json before quality-gates made it.',
    '',
    'NOT APPLICABLE when the app keeps no parity contract.',
    '',
    'Example: node check-harness.mjs .',
  ].join('\n'),
};

const HARNESS_FILES = [
  'parity-plans.ts',
  'parity-request.ts',
  'parity-request.test.ts',
  'parity-fixture.ts',
  'parity-fixture.test.ts',
  'parity-session.ts',
  'parity-session.test.ts',
  'parity-launch.ts',
  'parity-launch.test.ts',
  'parity-launch-root.tsx',
  'parity-launch-root.test.tsx',
  'parity-frame-root.tsx',
  'parity-frame-root.test.tsx',
  'parity-error-screen.tsx',
  'read-parity-launch.ts',
  'read-parity-launch.test.ts',
  'parity-launch-bridge.tsx',
  'parity-launch-bridge.test.tsx',
  'parity-root-kit.tsx',
  'parity-root-kit.test.tsx',
];
/** What the parity kit renders: the frame root around the Stack, the iOS launch bridge beside it. */
const KIT_MEMBERS = ['ParityFrameRoot', 'ParityLaunchBridge'];
const KIT_FACTORY = 'createParityKit';
const KIT_FILE = 'parity-root-kit.tsx';
const OVERLAY_PRESENTATIONS = new Set(['dialog', 'overlay', 'sheet']);
const LAUNCH_KEYS = ['frame', 'theme', 'lang', 'motion', 'nonce'];

const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Named value imports of a file: [{ local, spec }] (default imports too; type-only names left out). */
function namedImports(text) {
  const out = [];
  for (const m of text.matchAll(/^[ \t]*import\s+(?!type\b)([^'";]*?)\bfrom\s+['"]([^'"]+)['"]/gm)) {
    const clause = m[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    for (const part of braces ? braces[1].split(',') : []) {
      const name = part.trim();
      if (!name || name.startsWith('type ')) continue;
      const alias = /^(\w+)\s+as\s+(\w+)$/.exec(name);
      out.push({ local: alias ? alias[2] : name, spec: m[2] });
    }
    const def = /^\s*(\w+)/.exec(clause.replace(/\{[^}]*\}/, ''));
    if (def) out.push({ local: def[1], spec: m[2] });
  }
  return out;
}

/** The repo-relative source file an import specifier names ('@/...' or relative), or null. */
function resolveImport(fromRel, spec, srcDir, known) {
  let base = null;
  if (spec.startsWith('@/')) base = `${srcDir}/${spec.slice(2)}`;
  else if (spec.startsWith('./') || spec.startsWith('../')) base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
  if (base === null) return null;
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => `${base}${ext}`).find((rel) => known.has(rel)) ?? null;
}
const lineAt = (text, index) => text.slice(0, Math.max(0, index)).split('\n').length;

/**
 * The index of the first <ParityLaunchMarker /> that is not inside an element carrying
 * accessibilityViewIsModal, or null when every marker is inside one (or no such element exists).
 */
function markerOutsideModalView(source) {
  const masked = maskCode(source);
  const tags = findJsxTags(source, masked);
  const ranges = [];
  for (const tag of tags) {
    if (!/\baccessibilityViewIsModal\b(?!\s*=\s*\{\s*false\s*\})/.test(masked.slice(tag.attrsFrom, tag.attrsTo))) continue;
    if (tag.selfClosing) {
      ranges.push([tag.end, tag.end]);
      continue;
    }
    const selfClosing = new Set(tags.filter((t) => t.name === tag.name && t.selfClosing).map((t) => t.start));
    const re = new RegExp(`<(/?)${escapeRe(tag.name)}\\b`, 'g');
    re.lastIndex = tag.end;
    let depth = 1;
    let close = masked.length;
    for (let m = re.exec(masked); m; m = re.exec(masked)) {
      if (m[1] === '/') depth -= 1;
      else if (!selfClosing.has(m.index)) depth += 1;
      if (depth === 0) {
        close = m.index;
        break;
      }
    }
    ranges.push([tag.end, close]);
  }
  if (ranges.length === 0) return null;
  const marker = tags.find((t) => t.name === 'ParityLaunchMarker' && !ranges.some(([from, to]) => t.start > from && t.start < to));
  return marker ? marker.start : null;
}

/**
 * The wiring: some runtime file reads TEST_ONLY?.createParityKit and calls it (the
 * registry, src/services/create-root-kits.ts), and the kit module renders ParityFrameRoot and
 * ParityLaunchBridge.
 */
function checkParityKit({ report, sources, abs, entryRel, harness }) {
  const readers = [...sources].filter(([rel, text]) => rel !== entryRel && !rel.startsWith(`${harness}/`) && (new RegExp(`TEST_ONLY\\??\\.${KIT_FACTORY}\\b`).test(text) || new RegExp(`\\{[^}]*\\b${KIT_FACTORY}\\b[^}]*\\}\\s*=\\s*TEST_ONLY\\b`).test(text)));
  const calls = ([, text]) => new RegExp(`\\b${KIT_FACTORY}\\s*\\(`).test(text) || new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*TEST_ONLY\\??\\.${KIT_FACTORY}\\b[\\s\\S]*\\b\\1\\s*\\(`).test(text);
  if (readers.length === 0) report.problem({ file: entryRel, rule: 'harness-not-wired', message: `nothing reads TEST_ONLY?.${KIT_FACTORY}, so the parity kit never joins the root`, fix: `Register it in the app's registry (src/services/create-root-kits.ts): const ${KIT_FACTORY} = TEST_ONLY?.${KIT_FACTORY}; ... ${KIT_FACTORY}() among the test build's kits (examples/create-root-kits-parity.ts).` });
  else if (!readers.some(calls)) report.problem({ file: readers[0][0], rule: 'harness-not-wired', message: `TEST_ONLY?.${KIT_FACTORY} is read here but never called, so the kit is never created`, fix: `Call it and return its kit from createRootKits (examples/create-root-kits-parity.ts).` });
  const kitRel = `${harness}/${KIT_FILE}`;
  const kit = read(abs, kitRel);
  if (kit === null) {
    report.problem({ file: kitRel, rule: 'harness-not-wired', message: `the entry exports ${KIT_FACTORY} but the kit module does not exist`, fix: `Copy the skill's templates/src/features/parity/${KIT_FILE} (with its test).` });
    return;
  }
  for (const member of KIT_MEMBERS) {
    if (!new RegExp(`<${member}\\b`).test(maskComments(kit))) report.problem({ file: kitRel, rule: 'harness-not-wired', message: `the parity kit never renders <${member}>`, fix: `Copy the skill's templates/src/features/parity/${KIT_FILE}: provide wraps the Stack in ParityFrameRoot, effects mounts ParityLaunchBridge.` });
  }
}

/** The plans table: loaded from the app's own module, else read as literal data. */
async function readPlans(app, root, rel) {
  try {
    const mod = await app.load(rel);
    if (mod.PARITY_PLANS && typeof mod.PARITY_PLANS === 'object') return { plans: mod.PARITY_PLANS };
  } catch (error) {
    const source = read(root, rel) ?? '';
    const start = findConstInitializer(source, 'PARITY_PLANS');
    if (start === -1) return { error: `no PARITY_PLANS in it (${reasonOf(error)})` };
    try {
      return { plans: parseValue(source, start).value };
    } catch (literalError) {
      return { error: `PARITY_PLANS is not plain data (${literalError.message}) and the module did not load (${reasonOf(error)})` };
    }
  }
  return { error: 'it exports no PARITY_PLANS object' };
}

function checkPlans({ parity, plans, plansRel, report }) {
  const problem = (rule, message, fix) => report.problem({ file: plansRel, rule, message, fix });
  for (const frame of parity.frames.values()) {
    const plan = plans[frame.key];
    if (!plan) {
      problem('harness-frame-missing', `no plan for the design frame ${frame.key}`, `Add PARITY_PLANS['${frame.key}'] with its root ${frame.root}, href, state, data, tall and probe.`);
      continue;
    }
    if (plan.root !== frame.root) problem('harness-root', `${frame.key}: the plan's root is ${plan.root}, the contract's is ${frame.root}`, `Use ${frame.root}: the capture proves the frame is on screen by it.`);
    if (plan.tall !== (frame.kind === 'phone-tall')) problem('harness-tall', `${frame.key}: the plan says tall ${plan.tall}, the contract's kind is ${frame.kind}`, 'A phone-tall frame opens at the launch\'s scrollY; make the two agree.');
    const region = frame.probe?.region ?? null;
    if ((plan.probe ?? null) !== region) problem('harness-probe', `${frame.key}: the plan's probe is ${plan.probe ?? 'null'}, the contract's region is ${region ?? 'none'}`, 'A probe launch reports exactly the region the contract masks.');
    const screen = (parity.screens?.screens ?? []).find((s) => s.id === frame.screen);
    const firstState = screen?.states?.[0]?.id;
    const needsState = OVERLAY_PRESENTATIONS.has(frame.presentation) || (frame.state !== firstState && plan.data !== 'empty');
    if (needsState && !plan.state) problem('harness-frame-state', `${frame.key} shows ${frame.screen} ${frame.state}${OVERLAY_PRESENTATIONS.has(frame.presentation) ? ` (a ${frame.presentation})` : ''}, which the screen never opens on its own, but its plan has no state`, 'Give the plan the state its owning model opens with useFrameStateOpener (an empty state is reached by data: "empty" instead).');
  }
  for (const key of Object.keys(plans)) {
    if (!parity.frames.has(key)) problem('harness-frame-unknown', `PARITY_PLANS plans ${key}, which is not a design frame of the contracts`, 'Remove the plan, or give the state its "reference" in the screen contract.');
  }
}

/** Runs the app's own parser: every plan launches, every kind of bad launch is refused. */
async function checkParser({ app, parity, plans, harness, fixtureDay, report }) {
  const rel = `${harness}/parity-request.ts`;
  let mod;
  try {
    mod = await app.load(rel);
  } catch (error) {
    report.problem({ file: rel, rule: 'harness-parser', message: `the launch parser could not be loaded (${reasonOf(error)})`, fix: 'Keep parity-request.ts pure TypeScript (no React Native import), as the template is.' });
    return;
  }
  if (typeof mod.parseParityRequest !== 'function') {
    report.problem({ file: rel, rule: 'harness-parser', message: 'it exports no parseParityRequest(params, fixtureDay)', fix: "Copy the skill's template parity-request.ts." });
    return;
  }
  const lang = parity.contract.languages.find((l) => l !== 'en') ?? parity.contract.languages[0];
  for (const key of Object.keys(plans)) {
    const params = { frame: key, theme: 'dark', lang, motion: 'still', nonce: 'abcdef12', ...(fixtureDay ? { date: fixtureDay } : {}) };
    const result = mod.parseParityRequest(params, fixtureDay);
    if (!result?.ok) report.problem({ file: rel, rule: 'harness-parser', message: `a valid launch of ${key} is refused (${JSON.stringify(result?.error ?? result)})`, fix: `The parser must accept frame, theme, lang (every contract language), date, motion=still, nonce, scrollY and probe (${LAUNCH_KEYS.join(', ')} required).` });
  }
  const first = Object.keys(plans)[0];
  const base = { frame: first, theme: 'light', lang, motion: 'still', nonce: 'abcdef12' };
  const bad = [
    ['an unknown parameter', { ...base, offline: '1' }],
    ['a repeated parameter', { ...base, theme: ['light', 'dark'] }],
    ['an unknown frame', { ...base, frame: 'no-such-frame' }],
    ['a missing nonce', { ...base, nonce: undefined }],
    ['motion other than still', { ...base, motion: 'system' }],
  ];
  for (const [what, params] of bad) {
    const result = mod.parseParityRequest(params, fixtureDay);
    if (result?.ok) report.problem({ file: rel, rule: 'harness-parser', message: `the launch parser accepts ${what}`, fix: 'Refuse it: a parser that ignores what it does not know lets a capture show the wrong state and still pass (the app then shows only the parity.error screen).' });
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  const report = createReporter({ name: 'check-harness', json: options.json });
  const parity = loadParity(root, { contract: options.contract ?? null, strict: false });
  if (parity.missing) return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references`);
  const abs = parity.root;
  for (const p of parity.problems) report.problem({ file: p.file, rule: 'contract-invalid', message: p.message, fix: p.fix });
  if (parity.broken) return report.finish({ checked: 1, unit: 'files' });
  const { layout } = parity;
  const harness = parity.paths.harness;
  let checked = 0;

  // 1. The files.
  const production = [`${layout.srcDir}/hooks/use-frame-request.tsx`, `${layout.srcDir}/hooks/use-frame-request.test.tsx`, `${layout.srcDir}/hooks/use-frame-state-opener.ts`, `${layout.srcDir}/hooks/use-frame-state-opener.test.tsx`, `${layout.srcDir}/hooks/use-frame-scroll-target.ts`, `${layout.srcDir}/hooks/use-frame-scroll-target.test.tsx`, `${layout.uiDir}/parity-launch-marker.tsx`, `${layout.uiDir}/parity-launch-marker.test.tsx`];
  for (const rel of [...HARNESS_FILES.map((f) => `${harness}/${f}`), ...production]) {
    checked += 1;
    if (!existsSync(join(abs, rel))) report.problem({ file: rel, rule: 'harness-missing', message: 'a harness file does not exist', fix: `Copy it from the skill's templates/${rel.replace(/^.*?(src\/)/, '$1')} (each with its test).` });
  }

  // 2. The plans, the parser and the fixture.
  const app = enableAppImports(abs);
  const plansRel = `${harness}/parity-plans.ts`;
  let plans = {};
  if (existsSync(join(abs, plansRel))) {
    const got = await readPlans(app, abs, plansRel);
    if (got.error) report.problem({ file: plansRel, rule: 'harness-frame-missing', message: `the plans cannot be read: ${got.error}`, fix: 'Keep PARITY_PLANS a plain object literal, as the template is.' });
    else plans = got.plans;
    checkPlans({ parity, plans, plansRel, report });
  }
  let fixtureDay = null;
  const designFixture = read(abs, parity.paths.fixture);
  const appFixture = read(abs, parity.paths.appFixture);
  if (designFixture !== null || appFixture !== null) {
    try {
      const d = designFixture === null ? null : parseJsonc(designFixture);
      const a = appFixture === null ? null : parseJsonc(appFixture);
      fixtureDay = typeof d?.day === 'string' ? d.day : null;
      if (JSON.stringify(d) !== JSON.stringify(a)) {
        report.problem({ file: parity.paths.appFixture, rule: 'harness-fixture', message: `the app's fixture differs from the design's (${parity.paths.fixture})${a === null ? ': it does not exist' : d === null ? `: ${parity.paths.fixture} does not exist` : ''}`, fix: `Copy ${parity.paths.fixture} over it: the frames draw exactly that data, so the fixture is never edited to make a frame pass.` });
      }
    } catch (error) {
      report.problem({ file: parity.paths.appFixture, rule: 'harness-fixture', message: `a fixture is not valid JSON (${error.message})`, fix: 'Fix the JSON syntax.' });
    }
  }
  if (existsSync(join(abs, harness, 'parity-request.ts')) && Object.keys(plans).length) await checkParser({ app, parity, plans, harness, fixtureDay, report });

  // 3. The launch sets every test-build switch, and the harness draws nothing of its own.
  const launch = read(abs, `${harness}/parity-launch.ts`);
  if (launch !== null) {
    // The values in the overrides call, never the type declaration (readonly motion: 'still').
    for (const [needle, what] of [[/(?<!readonly\s+)\bmotion:\s*'still'\s*[,}]/, "motion: 'still'"], [/(?<!readonly\s+)\bisOffline:\s*false\s*[,}]/, 'isOffline: false'], [/\btoday:\s*request\.date\b/, 'today: request.date'], [/\bprobe:\s*request\.probe\b/, 'probe: request.probe']]) {
      if (!needle.test(maskComments(launch))) report.problem({ file: `${harness}/parity-launch.ts`, rule: 'harness-debug-flags', message: `the launch does not set ${what} in its overrides`, fix: 'Set every switch on every launch: a switch an earlier flow saved (offline, a date, a probe) would otherwise carry into the capture.' });
    }
  }
  const files = walkRepo(abs, { include: ['*.ts', '*.tsx'] });
  for (const rel of files.filter((f) => f.startsWith(`${harness}/`) && f.endsWith('.tsx') && !isTestFile(f) && !f.endsWith('parity-error-screen.tsx'))) {
    const source = readFileSync(join(abs, rel), 'utf8');
    for (const tag of findJsxTags(source)) {
      if (['AppText', 'Text', 'Image'].includes(tag.name)) report.problem({ file: `${rel}:${lineAt(source, tag.start)}`, rule: 'harness-draws-nothing', message: `the harness renders <${tag.name}>: a parity launch sets state, it never draws something the real screen would not`, fix: 'Draw it in the real screen (and the screen contract), or not at all; only the error screen shows text.' });
    }
  }

  // 4. Openers: every planned state is opened by a model through useFrameStateOpener.
  const runtime = files.filter((f) => f.startsWith(`${layout.srcDir}/`) && !isTestFile(f));
  // Comments are masked: a comment that names an opener or TEST_ONLY?.Member wires nothing.
  const sources = new Map(runtime.map((rel) => [rel, maskComments(readFileSync(join(abs, rel), 'utf8'))]));
  for (const [key, plan] of Object.entries(plans)) {
    if (!plan?.state) continue;
    const opener = [...sources].find(([rel, text]) => !rel.startsWith(`${harness}/`) && new RegExp(`useFrameStateOpener\\(\\s*['"]${plan.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(text));
    if (!opener) report.problem({ file: plansRel, rule: 'harness-opener', message: `${key}: no model opens the state "${plan.state}" (no useFrameStateOpener('${plan.state}', ...) outside the harness)`, fix: "Call useFrameStateOpener('" + plan.state + "', <the handler a person's press uses>) in the model hook that owns the state, with a test; never a capture-only branch." });
  }

  // 5. The launch marker in the parity root and in every modal root.
  const frameRoot = sources.get(`${harness}/parity-frame-root.tsx`);
  if (frameRoot !== undefined && !/<ParityLaunchMarker\b/.test(frameRoot)) report.problem({ file: `${harness}/parity-frame-root.tsx`, rule: 'harness-launch-marker', message: 'the parity root draws no <ParityLaunchMarker />', fix: "Copy the skill's template parity-frame-root.tsx." });
  // A file carries the marker when it renders <ParityLaunchMarker /> or renders a component imported
  // from a file that carries it (a dialog composing the shared Scrim that renders the marker).
  const carries = new Set([...sources].filter(([, text]) => /<ParityLaunchMarker\b/.test(text)).map(([rel]) => rel));
  const known = new Set(sources.keys());
  const rendered = new Map([...sources].map(([rel, text]) => [rel, new Set(rel.endsWith('.tsx') ? findJsxTags(text).map((t) => t.name.split('.')[0]) : [])]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [rel, text] of sources) {
      if (carries.has(rel)) continue;
      const via = namedImports(text).find((imp) => rendered.get(rel).has(imp.local) && carries.has(resolveImport(rel, imp.spec, layout.srcDir, known)));
      if (via) {
        carries.add(rel);
        grew = true;
      }
    }
  }
  for (const [rel, text] of sources) {
    const importsModal = /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*['"]react-native['"]/.test(text);
    if (importsModal && /<Modal\b/.test(text) && !carries.has(rel)) {
      report.problem({ file: `${rel}:${lineAt(text, text.search(/<Modal\b/))}`, rule: 'harness-launch-marker', message: 'a modal root renders no <ParityLaunchMarker /> (itself or through a component whose file renders it), so a capture of it carries no launch marker (a modal layer hides everything outside it from the tree Maestro reads)', fix: 'Render <ParityLaunchMarker /> (src/ui/parity-launch-marker.tsx) as the first child of the view that carries accessibilityViewIsModal (the scrim View), or compose a shared modal root that does (the app\'s Scrim, ConfirmDialog: references/parity-harness.md); it draws nothing outside a parity launch.' });
    }
  }

  // iOS hides the siblings of an accessibilityViewIsModal view from the tree Maestro reads, so a
  // marker rendered beside that view (the first child of <Modal>) is invisible to the capture.
  for (const [rel, text] of sources) {
    if (!rel.endsWith('.tsx') || !/<ParityLaunchMarker\b/.test(text) || !/\baccessibilityViewIsModal\b/.test(text)) continue;
    const outside = markerOutsideModalView(text);
    if (outside !== null) report.problem({ file: `${rel}:${lineAt(text, outside)}`, rule: 'harness-launch-marker', message: 'the launch marker is rendered outside the view that carries accessibilityViewIsModal; iOS hides that view\'s siblings from the tree Maestro reads, so every capture of this modal stops with a hierarchy from another launch', fix: 'Move <ParityLaunchMarker /> inside the accessibilityViewIsModal view, as its first child (references/parity-harness.md, "The launch nonce and modal roots").' });
  }

  // 5b. No capture-only branch: production code reads the request only through the opener hooks.
  const requestReaders = new Set([`${layout.srcDir}/hooks/use-frame-request.tsx`, `${layout.srcDir}/hooks/use-frame-state-opener.ts`, `${layout.srcDir}/hooks/use-frame-scroll-target.ts`, `${layout.uiDir}/parity-launch-marker.tsx`]);
  for (const [rel, text] of sources) {
    if (requestReaders.has(rel) || rel.startsWith(`${harness}/`)) continue;
    const at = text.search(/\buseFrameRequest\s*\(/);
    if (at !== -1) report.problem({ file: `${rel}:${lineAt(text, at)}`, rule: 'harness-capture-branch', message: 'production code reads useFrameRequest() itself: a capture-only branch, so a capture no longer shows the code path a person takes', fix: 'Open the frame state with useFrameStateOpener(<state>, <the press handler>) and scroll with useFrameScrollTarget(); only use-frame-request.tsx, use-frame-state-opener.ts, use-frame-scroll-target.ts, the launch marker and the harness read the request.' });
  }

  // 6. Test-only reach: the entry, the wiring, the route, no runtime import.
  const entryRel = `${layout.srcDir}/test-only-entry.ts`;
  const entryReason = notYetCreated(abs, { file: entryRel, owner: 'debug-menu-and-test-hooks' });
  if (entryReason) {
    report.skip({ file: entryRel, rule: 'harness-not-exported', message: entryReason });
    report.skip({ file: entryRel, rule: 'harness-not-wired', message: entryReason });
  } else {
    const entry = read(abs, entryRel);
    // The wiring is the parity kit (the root slots, app-startup-and-bootstrap): the entry exports
    // createParityKit, the app's registry reads it through TEST_ONLY and registers its kit, and the kit
    // module renders both members (the frame root around the Stack, the bridge beside it).
    if (!new RegExp(`export\\s*\\{[^}]*\\b${KIT_FACTORY}\\b[^}]*\\}\\s*from\\s*['"][^'"]*parity`).test(entry)) report.problem({ file: entryRel, rule: 'harness-not-exported', message: `the test-only entry does not export ${KIT_FACTORY}`, fix: `Add export { ${KIT_FACTORY} } from '@/features/parity/parity-root-kit' (examples/test-only-entry-additions.ts).` });
    checkParityKit({ report, sources, abs, entryRel, harness });
    // The launch itself: the app's test-only launch screen renders <ParityLaunchRoot> with its appliers.
    const launcher = [...sources].find(([rel, text]) => !rel.startsWith(`${harness}/`) && (/<ParityLaunchRoot\b/.test(text) || /TEST_ONLY\??\.ParityLaunchRoot\b/.test(text)));
    if (!launcher) report.problem({ file: entryRel, rule: 'harness-not-wired', message: 'no screen renders <ParityLaunchRoot> (the launch would never run)', fix: 'Add the app\'s launch screen in a test-only folder (examples/parity-launch-screen.tsx), export it from the entry and render it from the launch route.' });
  }
  // The consent hold: an app with ads must prove no consent moment can cover a frame.
  let manifest = {};
  try {
    manifest = JSON.parse(read(abs, 'package.json') ?? '{}');
  } catch {
    manifest = {};
  }
  const hasAds = ['dependencies', 'devDependencies'].some((k) => Object.hasOwn(manifest[k] ?? {}, 'react-native-google-mobile-ads'));
  const launchers = [...sources].filter(([rel, text]) => !rel.startsWith(`${harness}/`) && /<ParityLaunchRoot\b/.test(text));
  if (hasAds) {
    for (const [rel, text] of launchers) {
      const at = text.search(/\bconsent\s*:/);
      if (at === -1) {
        report.problem({ file: rel, rule: 'harness-consent', message: 'the parity appliers have no consent applier, in an app that ships react-native-google-mobile-ads', fix: "Add consent: resolve only when the build's ads mode is off (readAdsExtraForBinary(...).adsMode === 'off', admob-ads-and-consent), reject otherwise (examples/parity-launch-screen.tsx)." });
        continue;
      }
      const rest = text.slice(at);
      const end = rest.slice(1).search(/\n\s*(?:\w+\s*:|\}\s*;|\};?\s*$)/);
      const value = rest.slice(0, end === -1 ? undefined : end + 1);
      const named = /^consent\s*:\s*(\w+)\s*,?\s*$/.exec(value.trim());
      const consults = (t) => /\badsMode\b|\bADS_MODE\b|readAdsExtra/.test(t);
      // A named function (consent: holdConsent) is judged by the file it lives in.
      const ok = named ? consults(text) : consults(value);
      if (!ok) report.problem({ file: `${rel}:${lineAt(text, at)}`, rule: 'harness-consent', message: 'the consent applier does not consult the ads mode, in an app that ships react-native-google-mobile-ads: a bare Promise.resolve() lets the consent primer, Google\'s form or Apple\'s tracking prompt cover a frame', fix: "Resolve only when readAdsExtraForBinary(...).adsMode === 'off' (an ADS_MODE=off build never asks), and reject otherwise so the launch stops on parity.error (admob-ads-and-consent)." });
    }
  }
  const routeRel = files.find((f) => f.startsWith(`${layout.routesDir}/`) && /(^|\/)debug\/parity\.tsx$/.test(f.replace(/\([^)]*\)\//g, '')));
  if (!routeRel) report.problem({ file: `${layout.routesDir}/(debug)/debug/parity.tsx`, rule: 'harness-route', message: 'no route answers the parity launch link (/debug/parity)', fix: 'Add the route (examples/parity-route.tsx): it renders the app\'s launch screen through TEST_ONLY with useLocalSearchParams() and redirects home in production.' });
  // The test-only folders (architecture-and-boundaries); until that contract exists, the folders
  // debug-menu-and-test-hooks creates by default.
  const archRel = `${layout.contractsDir}/architecture.json`;
  const archReason = notYetCreated(abs, { file: archRel, owner: 'architecture-and-boundaries' });
  let testOnlyFolders = [`${layout.srcDir}/features/debug/`, `${layout.srcDir}/services/test-hooks/`];
  if (archReason) report.skip({ file: archRel, rule: 'harness-test-only-folder', message: archReason });
  else {
    let folders = [];
    try {
      folders = parseJsonc(read(abs, archRel)).testOnlyFolders ?? [];
    } catch {
      folders = [];
    }
    testOnlyFolders = folders.map((f) => String(f).replace(/\/?$/, '/'));
    if (!testOnlyFolders.some((f) => `${harness}/`.startsWith(f))) report.problem({ file: archRel, rule: 'harness-test-only-folder', message: `testOnlyFolders does not list ${harness}/`, fix: `Add "${harness}/" to testOnlyFolders, so a static import of the harness fails the boundary check.` });
  }
  // A runtime file never imports the harness by value; test-only files (the app's launch screen) may.
  for (const [rel, text] of sources) {
    if (rel.startsWith(`${harness}/`) || rel === entryRel || testOnlyFolders.some((f) => rel.startsWith(f))) continue;
    for (const imp of valueImports(text)) {
      const target = imp.spec.startsWith('@/') ? `${layout.srcDir}/${imp.spec.slice(2)}` : null;
      if (target && (target === harness || target.startsWith(`${harness}/`))) report.problem({ file: `${rel}:${lineAt(text, imp.index)}`, rule: 'harness-leak', message: `a runtime file imports the parity harness (${imp.spec}) by value, so it ships in every build`, fix: 'Reach it only through TEST_ONLY?.<member> (src/test-only.ts); production code reads only useFrameRequest and ParityLaunchMarker.' });
    }
  }

  // 7. Repo files: ignored runs, well-formed waivers and ledger, gated parity files, rendered borders.
  const gitignore = read(abs, '.gitignore') ?? '';
  const runs = parity.paths.runs.replace(/\/$/, '');
  if (!gitignore.split('\n').map((l) => l.trim().replace(/^\//, '').replace(/\/$/, '')).includes(runs)) report.problem({ file: '.gitignore', rule: 'harness-gitignore', message: `${runs}/ is not ignored (captures, reports and sheets: several MB per run)`, fix: `Add the line ${runs}/ to .gitignore.` });
  const waivers = readWaivers(join(abs, parity.paths.waivers));
  for (const p of waivers.problems) report.problem({ file: parity.paths.waivers, ...p });
  const ledgerText = read(abs, parity.paths.signoff);
  if (ledgerText !== null) {
    try {
      const ledger = JSON.parse(ledgerText);
      if (ledger.version !== 1 || !Array.isArray(ledger.entries)) throw new Error('expected { "version": 1, "entries": [...] }');
    } catch (error) {
      report.problem({ file: parity.paths.signoff, rule: 'ledger-invalid', message: error.message, fix: "Start from the skill's templates/design/parity/signoff.json." });
    }
  }
  const gatesReason = notYetCreated(abs, { file: 'quality-gates.json', owner: 'quality-gates' });
  if (gatesReason) report.skip({ file: 'quality-gates.json', rule: 'gated-paths', message: gatesReason });
  else {
    let gated = [];
    try {
      gated = parseJsonc(read(abs, 'quality-gates.json')).gatedPaths ?? [];
    } catch {
      gated = [];
    }
    // Gated: the waivers, the references (+ manifest), the fixture, the mockup and the device
    // profiles. Not gated: the ledger, which records looks and changes on every sign-off.
    const refs = parity.paths.references;
    const devices = [...parity.devices.keys()];
    const lang = parity.contract.languages?.[0] ?? 'en';
    const mockupDir = posix.dirname(parity.paths.mockup);
    const required = [
      [parity.paths.waivers, parity.paths.waivers],
      ...devices.map((d) => [`${refs}/${d}/light-${lang}/frame.png`, `${refs}/${d}/**`]),
      [parity.paths.manifest, parity.paths.manifest],
      [parity.paths.fixture, parity.paths.fixture],
      [parity.paths.mockup, mockupDir === '.' ? parity.paths.mockup : `${mockupDir}/**`],
      ...devices.map((d) => [`${refs}/devices/${d}.json`, `${refs}/devices/**`]),
    ];
    for (const [rel, glob] of required) {
      if (!gated.some((g) => matchGlob(rel, g))) report.problem({ file: 'quality-gates.json', rule: 'gated-paths', message: `gatedPaths does not cover ${rel}`, fix: `Add "${glob}" to gatedPaths in the same Gate-Change commit: the waivers, references, fixture, mockup and device profiles decide what the parity gate accepts.` });
    }
    if (gated.some((g) => matchGlob(parity.paths.signoff, g))) report.problem({ file: 'quality-gates.json', rule: 'gated-paths', message: `gatedPaths covers the sign-off ledger ${parity.paths.signoff}, so every sign-off would need a Gate-Change trailer`, fix: `List the gated parity paths one by one (${parity.paths.waivers}, ${refs}/<device>/**, ${parity.paths.manifest}, ${parity.paths.fixture}, ${mockupDir}/**, ${refs}/devices/**) instead of ${refs}/**: the ledger records looks, not tolerances.` });
  }
  const library = read(abs, `${layout.contractsDir}/component-library.json`);
  if (library !== null) {
    try {
      const specs = parseJsonc(library).specs;
      if (specs !== false && specs?.asRenderedBorders !== true) report.problem({ file: `${layout.contractsDir}/component-library.json`, rule: 'component-border', message: 'the references are browser renders, which floor every CSS border of 1 px or more to whole pixels (2.5 -> 2), but the component specs keep the token widths', fix: 'Set "specs": { "asRenderedBorders": true } (ui-component-library) and regenerate the specs; rings and strokes keep their token values.' });
    } catch {
      // A malformed catalogue is ui-component-library's to report.
    }
  }
  return report.finish({ checked: Math.max(checked, 1), unit: 'harness files' });
});
