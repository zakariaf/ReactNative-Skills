#!/usr/bin/env node
// check-signoff.mjs: the definition of done for screen parity. A frame is done only when every run of
// the done set (each device x theme x language of the contract) passes check-parity against the
// current references, covers every element (tall frames: across scroll captures), has a fresh sheet,
// and has a sign-off ledger entry recording that the sheets of exactly that run were looked at and
// nothing is open. Writes the summary file a report's "Design match" line names.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run, sha256 } from './check-lib.mjs';
import { describeFacts, describeReference, isCropOnly, listOption, loadParity, NO_FRAMES_REASON, referenceName, selectFrames, variantFor } from './lib/contract.mjs';
import { changesForFrame } from './lib/reference-changes.mjs';
import { RUN_FILES, findRunDirs, readRun, readWaivers } from './lib/runs.mjs';

export const EYE_CHECKS = Object.freeze(['icons', 'pictures', 'shadows', 'alignment', 'wrapping', 'direction', 'feel']);

const SPEC = {
  name: 'check-signoff',
  summary:
    'Proves screen parity is done: for each frame and each run of the done set (every device x theme x language the ' +
    'contract lists), the latest capture passes check-parity against the reference the app\'s facts select, every element ' +
    'was checked (tall frames: across every planned scroll offset), the sheets are fresh, and the sign-off ledger has an ' +
    'entry for exactly those sheets with every eye check answered and no open difference. Narrowing with --devices, ' +
    '--themes or --langs is for iteration only: it prints "narrowed: not a sign-off" and exits 1. --draft <run-dir> ' +
    'prints a ledger entry to fill in. Writes the summary file (contract "summary", default reports/parity/summary.json).',
  usage: '[repo-root] (--frame <key>... | --screen <id>... | --all) [options] | [repo-root] --draft <run-dir> [--from-ledger] [--date YYYY-MM-DD]',
  options: {
    frame: { type: 'string', multiple: true, value: 'key', help: 'Frame key(s) to sign off' },
    screen: { type: 'string', multiple: true, value: 'id', help: 'Screen id(s) of the screen contract: every frame of the screen' },
    all: { type: 'boolean', help: 'Every design frame' },
    devices: { type: 'string', value: 'list', help: 'Devices required (default: every device of the contract; fewer fails "narrowed")' },
    themes: { type: 'string', value: 'list', help: 'Themes required (default: every theme of the contract; fewer fails "narrowed")' },
    langs: { type: 'string', value: 'list', help: 'Languages required (default: every language of the contract; fewer fails "narrowed")' },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
    draft: { type: 'string', value: 'run-dir', help: 'Print a ledger entry skeleton for this run (after make-sheet.mjs) and exit' },
    'from-ledger': { type: 'boolean', help: 'With --draft: copy the recorded differences of the previous entry for the same run (eye checks stay open)' },
    date: { type: 'string', value: 'YYYY-MM-DD', help: "With --draft: the entry's date (default: today's local calendar day, never the UTC day)" },
    summary: { type: 'string', value: 'file', help: 'Where to write the summary (default: the contract\'s "summary")' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    `Eye checks (each "match", "n/a", or "waived: <reason of 20+ characters>"): ${EYE_CHECKS.join(', ')}.`,
    'A difference is { "what": "...", "status": "fixed" | "waived" } once handled; "open" blocks sign-off.',
    '',
    'The done set: every frame on every device x theme x language of the contract (light and dark, every language',
    'the app ships, an RTL one included when it has one), at every scroll offset run-parity.mjs plans, against the',
    "reference the app's facts pick. Narrowed checks are never a sign-off.",
    '',
    'A draft is dated with the local calendar day of the machine (at 01:17 in Berlin on 1 October it is 2026-10-01, not',
    "the UTC day 2026-09-30), the same day the waivers' reportedOn and the reports use; --date YYYY-MM-DD sets it.",
    '',
    'Waivers are listed per frame with their class; every one of them goes into the report to the reviewer. So are the',
    'intended reference changes (the reference manifest\'s referenceChanges) of every frame signed off, and the',
    'reference each frame used.',
    '',
    'NOT APPLICABLE when the app keeps no parity contract, or no design frame yet (no screen state has a',
    '"reference" and the contract\'s "frames" is empty).',
    '',
    'Examples:',
    '  node check-signoff.mjs . --screen tasks',
    '  node check-signoff.mjs . --draft .parity/iphone-16-pro/tasks-default/dark-ar',
    '  node check-signoff.mjs . --draft .parity/iphone-16-pro/tasks-default/dark-ar --from-ledger   (after a rebuild)',
  ].join('\n'),
};

/** The local calendar day of a moment as YYYY-MM-DD (local time, never UTC). */
function localDay(moment = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

/** --date: a real calendar day written YYYY-MM-DD, else exit 2. */
function draftDate(value) {
  if (value === undefined) return localDay();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!day || localDay(day) !== value) fail(`--date ${value} is not a calendar day written YYYY-MM-DD`, 'Pass the day of the look, for example --date 2026-10-01, or leave --date out for today (local time).');
  return value;
}

function readLedger(path) {
  if (!existsSync(path)) return { entries: [], problems: [] };
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    if (json.version !== 1 || !Array.isArray(json.entries)) return { entries: [], problems: ['expected { "version": 1, "entries": [...] }'] };
    return { entries: json.entries, problems: [] };
  } catch (error) {
    return { entries: [], problems: [`not valid JSON: ${error.message}`] };
  }
}

const sameRun = (e, info) => e.frame === info.frame && e.device === info.device && e.theme === info.theme && e.lang === info.lang && (e.scrollY ?? 0) === (info.scrollY ?? 0);

/**
 * --draft: the ledger entry skeleton for one run, for exactly its current sheets. With --from-ledger
 * the previous entry for the same run lends its recorded differences (a rebuild that only changed the
 * sheet hash keeps them); the eye checks always start open, because the new sheet has to be looked at.
 */
function draftEntry(parity, options, show) {
  const date = draftDate(options.date);
  const dir = resolve(options.draft);
  const r = readRun(dir, parity);
  const report = createReporter({ name: 'check-signoff' });
  const sheetsPath = join(dir, RUN_FILES.sheets);
  const reportPath = join(dir, RUN_FILES.report);
  if (!existsSync(sheetsPath)) fail(`${show(dir)} has no ${RUN_FILES.sheets}`, 'Run check-parity.mjs and make-sheet.mjs on it first.');
  const sheets = JSON.parse(readFileSync(sheetsPath, 'utf8'));
  // A draft is only worth writing for sheets that belong to the latest check and still exist.
  if (!existsSync(reportPath) || sheets.reportSha256 !== sha256(readFileSync(reportPath))) {
    report.problem({ file: show(sheetsPath), rule: 'stale-sheet', message: `${show(dir)}: the sheets were made before the latest check`, fix: 'Run make-sheet.mjs again, look at the new sheets, then draft.' });
  }
  const changed = Object.entries(sheets.files ?? {}).filter(([name, hash]) => !existsSync(join(dir, name)) || sha256(readFileSync(join(dir, name))) !== hash).map(([name]) => name);
  if (changed.length) report.problem({ file: show(sheetsPath), rule: 'stale-sheet', message: `${show(dir)}: ${changed.slice(0, 3).join(', ')} missing or changed since make-sheet.mjs wrote them`, fix: 'Run make-sheet.mjs again, look at the new sheets, then draft.' });
  const entry = {
    frame: r.info.frame,
    device: r.info.device,
    theme: r.info.theme,
    lang: r.info.lang,
    scrollY: r.info.scrollY,
    sheetSha256: sheets.files?.['sheet.png'],
    date,
    looked: Object.keys(sheets.files ?? {}).filter((f) => !f.startsWith('crops/')),
    eyeChecks: Object.fromEntries(EYE_CHECKS.map((k) => [k, 'open'])),
    differences: [],
  };
  if (options['from-ledger']) {
    const ledgerPath = join(parity.root, parity.paths.signoff);
    const ledger = readLedger(ledgerPath);
    for (const message of ledger.problems) report.problem({ file: show(ledgerPath), rule: 'ledger-invalid', message, fix: "Start from the skill's templates/design/parity/signoff.json." });
    const previous = ledger.entries.find((e) => sameRun(e, entry));
    if (previous) {
      entry.differences = (previous.differences ?? []).map((d) => ({ ...d }));
      report.note(`copied ${entry.differences.length} recorded difference${entry.differences.length === 1 ? '' : 's'} from the entry of ${previous.date ?? '?'} (sheet ${String(previous.sheetSha256 ?? '?').slice(0, 8)}); every eye check is open again`);
    } else if (!ledger.problems.length) {
      report.note(`no earlier entry for ${entry.frame} ${entry.device} ${entry.theme}-${entry.lang}${entry.scrollY ? ` y${entry.scrollY}` : ''} in ${show(ledgerPath)}: nothing copied`);
    }
  }
  if (report.count === 0) {
    console.log(JSON.stringify(entry, null, 1));
    report.note('Read every file in "looked", answer each eye check, check each copied difference is still true, list what else differs, then put the entry in the ledger (replacing the old one).');
  }
  return report.finish({ checked: 1, unit: 'runs' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const show = (p) => relative(process.cwd(), p) || '.';
  const parity = loadParity(root, { contract: options.contract ?? null });
  if (parity.missing) {
    const report = createReporter({ name: 'check-signoff' });
    return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references to sign off against`);
  }
  if (parity.noFrames) return createReporter({ name: 'check-signoff' }).notApplicable(NO_FRAMES_REASON);
  if (options.draft) return draftEntry(parity, options, show);
  if (options.date !== undefined) fail('--date belongs to --draft', 'Use it as: node check-signoff.mjs . --draft <run-dir> --date YYYY-MM-DD');
  const keys = selectFrames(parity, { frame: options.frame ?? [], screen: options.screen ?? [], all: options.all === true });
  if (!keys.length) fail('nothing to sign off: pass --frame, --screen or --all', 'Run: node check-signoff.mjs --help');
  const doneDevices = [...parity.devices.keys()];
  const doneThemes = parity.contract.themes;
  const doneLangs = parity.contract.languages;
  const devices = listOption(options.devices, doneDevices);
  const themes = listOption(options.themes, doneThemes);
  const langs = listOption(options.langs, doneLangs);
  for (const d of devices) if (!doneDevices.includes(d)) fail(`unknown device "${d}"`, `The contract lists ${doneDevices.join(', ')}.`);
  for (const t of themes) if (!doneThemes.includes(t)) fail(`unknown theme "${t}"`, `The contract lists ${doneThemes.join(', ')}.`);
  for (const l of langs) if (!doneLangs.includes(l)) fail(`unknown language "${l}"`, `The contract lists ${doneLangs.join(', ')}.`);
  const narrowed = !doneDevices.every((d) => devices.includes(d)) || !doneThemes.every((t) => themes.includes(t)) || !doneLangs.every((l) => langs.includes(l));
  const runsRoot = join(root, parity.paths.runs);
  const ledgerPath = join(root, parity.paths.signoff);
  const ledger = readLedger(ledgerPath);
  const waiverFile = readWaivers(join(root, parity.paths.waivers));
  const report = createReporter({ name: 'check-signoff' });
  for (const message of ledger.problems) report.problem({ file: show(ledgerPath), rule: 'ledger-invalid', message, fix: "Start from the skill's templates/design/parity/signoff.json." });
  for (const p of waiverFile.problems) report.problem({ file: show(waiverFile.path), ...p });
  const table = [];
  const summaryFrames = [];
  let checked = 0;
  const manifestPath = join(root, parity.paths.manifest);
  let refManifest = null;
  try {
    refManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  } catch {
    refManifest = null;
  }
  const changeNotes = [];
  const summaryChanges = [];
  for (const key of keys) {
    const frame = parity.frames.get(key);
    const variant = variantFor(frame, parity.appFacts, parity.designFacts);
    const wantedName = referenceName(key, variant?.id);
    changeNotes.push(`reference ${describeReference(key, variant)}`);
    for (const c of changesForFrame(refManifest, key).filter((entry) => (entry.frames ?? []).includes(key) || (entry.variants ?? []).includes(wantedName))) {
      changeNotes.push(`  intended reference change ${c.id} (${c.date}): ${c.what} Why: ${c.why}`);
      summaryChanges.push({ id: c.id, date: c.date, frame: key, what: c.what });
    }
    const cells = [];
    const summaryCells = {};
    for (const device of devices) {
      const profile = parity.devices.get(device);
      for (const theme of themes) {
        for (const lang of langs) {
          checked += 1;
          const tag = `${theme}-${lang}`;
          const where = `${key} ${device} ${tag}`;
          const frameRoot = join(runsRoot, device, key);
          const dirs = existsSync(frameRoot) ? findRunDirs(frameRoot).filter((d) => {
            const name = d.split(/[\\/]/).pop();
            return name === tag || name.startsWith(`${tag}-y`);
          }) : [];
          const problem = (rule, message, fix) => report.problem({ file: show(dirs[0] ?? join(frameRoot, tag)), rule, message: `${where}: ${message}`, fix });
          if (!dirs.length) {
            problem('not-captured', 'no run folder', `Capture it: node <skill>/scripts/run-parity.mjs . --frame ${key} --device ${device} --themes ${theme} --langs ${lang}`);
            cells.push(`${device}/${tag} missing`);
            summaryCells[`${device}/${tag}`] = 'missing';
            continue;
          }
          let ok = true;
          const coverage = new Set();
          let layout = null;
          for (const dir of dirs) {
            const r = readRun(dir, parity);
            const reportPath = join(dir, RUN_FILES.report);
            if (r.reference.name !== wantedName) {
              problem('reference-variant', `${show(dir)} was captured against ${r.reference.name}, but the app's facts (${describeFacts(parity.appFacts)}) select ${wantedName}`, 'Capture again with run-parity.mjs (it reads the facts from the contract).');
              ok = false;
              continue;
            }
            if (!existsSync(reportPath)) {
              problem('not-checked', `${show(dir)} has no report.json`, 'Run check-parity.mjs on it.');
              ok = false;
              continue;
            }
            const rep = JSON.parse(readFileSync(reportPath, 'utf8'));
            // Only a real device capture counts: not a design-as-app run, not a borrowed image.
            const appSha = existsSync(r.app) ? sha256(readFileSync(r.app)) : null;
            if (r.info.source !== 'capture-app' || !r.info.bundleId || typeof r.info.app === 'string') {
              problem('not-a-capture', `${show(dir)} was not written by capture-app.mjs (source ${r.info.source ?? 'unknown'}${typeof r.info.app === 'string' ? `, app image ${r.info.app}` : ''})`, `Capture the app itself: node <skill>/scripts/capture-app.mjs . --frame ${key} --device ${device} --theme ${theme} --lang ${lang}`);
              ok = false;
            } else if (appSha && existsSync(r.reference.image) && appSha === sha256(readFileSync(r.reference.image))) {
              problem('not-a-capture', `${show(dir)}/app.png is the design reference itself`, 'Capture the app on the device; never copy the reference in.');
              ok = false;
            }
            if (!existsSync(r.reference.image) || !existsSync(r.reference.layout) || rep.reference?.imageSha256 !== sha256(readFileSync(r.reference.image)) || rep.reference?.layoutSha256 !== sha256(readFileSync(r.reference.layout))) {
              problem('stale-report', `${show(dir)} was checked against a different reference than the current one`, 'Run check-parity.mjs again (the references changed).');
              ok = false;
            }
            if (!appSha || rep.app?.imageSha256 !== appSha) {
              problem('stale-report', `${show(dir)}/report.json does not belong to its app.png`, 'Run check-parity.mjs again after every capture.');
              ok = false;
            }
            if (rep.result !== 'PASS') {
              problem('not-passing', `${show(dir)} has ${rep.problems?.length ?? '?'} parity problems (first: ${rep.problems?.[0]?.message ?? 'see report.json'})`, 'Fix the app, rebuild, capture and check again.');
              ok = false;
            }
            for (const w of rep.waived ?? []) {
              if (!waiverFile.waivers.some((x) => x.index === w.waiver.index && x.reason === w.waiver.reason)) {
                problem('waiver-gone', `${show(dir)} relied on waiver ${w.waiver.index}, which is no longer in the waiver file`, 'Run check-parity.mjs again.');
                ok = false;
              }
            }
            for (const id of rep.coverage ?? []) coverage.add(id);
            layout = layout ?? (existsSync(r.reference.layout) ? JSON.parse(readFileSync(r.reference.layout, 'utf8')) : null);
            // The look: a fresh sheet and a ledger entry for exactly that sheet.
            const sheetsPath = join(dir, RUN_FILES.sheets);
            if (!existsSync(sheetsPath)) {
              problem('no-sheet', `${show(dir)} has no sheets (make-sheet.mjs not run)`, 'Run make-sheet.mjs on it and read the images.');
              ok = false;
              continue;
            }
            const sheets = JSON.parse(readFileSync(sheetsPath, 'utf8'));
            if (sheets.reportSha256 !== sha256(readFileSync(reportPath))) {
              problem('stale-sheet', `${show(dir)}: the sheets were made before the latest check`, 'Run make-sheet.mjs again and look again.');
              ok = false;
              continue;
            }
            const changed = Object.entries(sheets.files ?? {}).filter(([name, hash]) => !existsSync(join(dir, name)) || sha256(readFileSync(join(dir, name))) !== hash).map(([name]) => name);
            if (changed.length || !sheets.files?.['sheet.png']) {
              problem('stale-sheet', `${show(dir)}: ${changed.length ? `${changed.slice(0, 3).join(', ')} ${changed.length > 1 ? 'are' : 'is'} missing or changed since make-sheet.mjs wrote ${changed.length > 1 ? 'them' : 'it'}` : `${RUN_FILES.sheets} lists no sheet.png`}`, 'Run make-sheet.mjs again and look again.');
              ok = false;
              continue;
            }
            const entry = ledger.entries.find((e) => sameRun(e, r.info));
            if (!entry) {
              problem('not-looked', `${show(dir)}: no sign-off entry in ${show(ledgerPath)}`, `Read the sheets, then add the entry: node <skill>/scripts/check-signoff.mjs . --draft ${show(dir)}`);
              ok = false;
              continue;
            }
            if (entry.sheetSha256 !== sheets.files['sheet.png']) {
              problem('looked-at-old-sheet', `${show(dir)}: the ledger entry is for another sheet (the app or the reference changed since the look)`, 'Look at the new sheet and update sheetSha256, the eye checks and the differences.');
              ok = false;
            }
            const mustLook = Object.keys(sheets.files).filter((f) => !f.startsWith('crops/'));
            const unseen = mustLook.filter((f) => !(entry.looked ?? []).includes(f));
            if (unseen.length) {
              problem('not-looked', `${show(dir)}: the entry does not list ${unseen.join(', ')} as looked at`, 'Read every sheet image (sheet, zoom bands, eye pages) and list them in "looked".');
              ok = false;
            }
            for (const k of EYE_CHECKS) {
              const v = entry.eyeChecks?.[k];
              const valid = v === 'match' || v === 'n/a' || (typeof v === 'string' && /^waived: .{20,}/.test(v));
              if (!valid) {
                problem('eye-check-open', `${show(dir)}: eye check "${k}" is ${v === undefined ? 'missing' : `"${v}"`}`, 'Compare that aspect on the sheets and answer "match", "n/a" or "waived: <reason>" (waived only for a platform limit, reported to the reviewer).');
                ok = false;
              }
            }
            for (const d of entry.differences ?? []) {
              if (!['fixed', 'waived'].includes(d?.status)) {
                problem('difference-open', `${show(dir)}: open difference "${d?.what ?? '?'}"`, 'Fix it (then capture, check, sheet and look again) or record why it is a platform limit.');
                ok = false;
              }
            }
          }
          if (layout && frame.kind === 'phone-tall') {
            // Crop-only parts (parent, a11yHidden) are covered with the element whose crop holds them.
            const meta = new Map(frame.elements.map((el) => [el.testID, el]));
            const needed = layout.elements.filter((el) => el.count === 1 && el.rect && !isCropOnly(meta.get(el.testID) ?? el)).map((el) => el.testID);
            const never = needed.filter((id) => !coverage.has(id));
            if (never.length) {
              problem('coverage', `${never.length} elements were never fully on screen in any capture (${never.slice(0, 4).join(', ')}${never.length > 4 ? ', ...' : ''})`, `Capture the scroll offsets run-parity.mjs plans for this frame (each body element whole between the fixed header and the end of the body at least once), or add one with capture-app.mjs --frame ${key} --scroll <pt>, then check it.`);
              ok = false;
            }
          }
          cells.push(`${device}/${tag} ${ok ? 'done' : 'open'}${dirs.length > 1 ? ` (${dirs.length} captures)` : ''}`);
          summaryCells[`${device}/${tag}`] = ok ? 'done' : 'open';
          if (profile && !ok) summaryCells[`${device}/${tag}`] = 'open';
        }
      }
    }
    table.push(`${key.padEnd(32)} ${cells.join(' | ')}`);
    summaryFrames.push({ frame: key, screen: frame.screen, reference: wantedName, cells: summaryCells, done: Object.values(summaryCells).every((v) => v === 'done') });
  }
  if (Object.keys(parity.appFacts).length) report.note(`facts ${parity.contractRel}: ${describeFacts(parity.appFacts)}`);
  if (narrowed) {
    report.problem({
      file: show(ledgerPath),
      rule: 'narrowed',
      message: `narrowed: not a sign-off (checked ${devices.join(', ')} x ${themes.join(', ')} x ${langs.join(', ')}; the done set is ${doneDevices.join(', ')} x ${doneThemes.join(', ')} x ${doneLangs.join(', ')} at every planned offset)`,
      fix: 'Drop --devices, --themes and --langs (narrowing is for iteration only), capture the missing runs with run-parity.mjs, look at their sheets and record them.',
    });
  }
  for (const line of changeNotes) report.note(line);
  for (const line of table) report.note(line);
  const frameWaivers = waiverFile.waivers.filter((x) => keys.includes(x.frame));
  for (const w of frameWaivers) {
    report.note(`waiver ${w.index} [${w.class}] ${w.frame} ${w.testID} ${w.rule}${w.devices ? ` (${w.devices.join(', ')})` : ''}${w.langs ? ` (${w.langs.join(', ')})` : ''}: ${w.class === 'design-artefact' ? `mockup CSS ${w.designCause}` : w.class === 'platform-text-shaping' ? `glyphs ${w.glyphs}` : 'platform limit'}; reviewer told ${w.reportedOn}`);
  }
  const summaryPath = resolve(root, options.summary ?? parity.paths.summary);
  const summary = {
    version: 1,
    createdAt: new Date().toISOString(),
    result: report.count === 0 ? 'PASS' : 'FAIL',
    problems: report.count,
    narrowed,
    doneSet: { devices: doneDevices, themes: doneThemes, languages: doneLangs },
    frames: summaryFrames,
    waivers: frameWaivers.map((w) => ({ frame: w.frame, testID: w.testID, rule: w.rule, class: w.class, reason: w.reason, reportedOn: w.reportedOn })),
    referenceChanges: summaryChanges,
  };
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 1)}\n`);
  report.note(`summary ${show(summaryPath)} (a report's "Design match" line names this file)`);
  return report.finish({ checked, unit: 'frame runs' });
});
