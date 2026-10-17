#!/usr/bin/env node
// check-parity.mjs: the per-element parity gates between an approved design reference and an app
// capture, for every run folder of the app repo (or the ones named with --run).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createReporter, fail, parseArgs, run, sha256 } from './check-lib.mjs';
import { describeFacts, describeReference, loadParity, NO_FRAMES_REASON, referenceName, variantFor, withContractMetadata, withModal } from './lib/contract.mjs';
import { TOLERANCES, compareRun, layoutFactsOf } from './lib/gates.mjs';
import { parseAppLayout, parseMaestroHierarchy } from './lib/hierarchy.mjs';
import { readImage } from './lib/images.mjs';
import { RUN_FILES, applyWaivers, findRunDirs, knownCauseFor, readRun, readWaivers } from './lib/runs.mjs';

const SPEC = {
  name: 'check-parity',
  summary:
    'Compares app captures with their approved design references, element by element (keyed by testID): ' +
    `the screen is reached, every element is there, bounds within +-${TOLERANCES.boundsPt} pt, exact text, fill colour ` +
    `within ${TOLERANCES.fillChannelDelta}/255, solid borders within ${TOLERANCES.borderPt} pt, text ink (measured in the text colour) within ` +
    `+-${TOLERANCES.inkSizePt} pt size and +-${TOLERANCES.inkCentrePt} pt centre (or the type role's measured floor + ${TOLERANCES.layoutNoisePt} pt where larger), ` +
    `and no shape difference at least ${TOLERANCES.blobThicknessPt} pt thick in any aligned element crop. The OS-drawn status bar, ` +
    'home indicator and navigation bar are masked. Writes report.json into each run folder.',
  usage: '[repo-root] [--run <dir>]... [options]',
  options: {
    run: { type: 'string', multiple: true, value: 'dir', help: 'A run folder to check (default: every run folder under the contract\'s runsDir)' },
    frame: { type: 'string', multiple: true, value: 'key', help: 'Only the runs of these frames' },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json, or rn-skills.config.json "visualParityContract")' },
    'no-write': { type: 'boolean', help: 'Do not write report.json' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'There is no option to change a tolerance, on purpose: every number is a measured noise floor.',
    'A problem that the platform truly cannot fix, or that the mockup CSS itself draws, goes into the waiver file',
    '(contract "waivers", default design/parity/waivers.json) with its class: platform, platform-text-shaping or',
    'design-artefact (references/signoff-and-waivers.md).',
    '',
    'Fix failures in the order printed: screen-not-reached, scroll-mismatch, duplicate-testid, missing, bounds, text,',
    'fill, border, text-ink, structure.',
    '',
    "A frame with reference variants is checked against the variant the app's facts (contract facts.app) select; a run",
    'captured against another reference fails reference-variant. A probed frame masks the region its run.json holds',
    "(capture-app's probe launch); a run without one stops with exit 2. Then run make-sheet.mjs and look at the sheets.",
    '',
    'NOT APPLICABLE when the app keeps no parity contract (contracts/visual-parity.json), or no design frame yet',
    '(no screen state has a "reference" and the contract\'s "frames" is empty).',
    '',
    'Examples:',
    '  node check-parity.mjs .',
    '  node check-parity.mjs . --run .parity/iphone-16-pro/tasks-default/dark-ar',
    '  node check-parity.mjs . --frame lists-default',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const report = createReporter({ name: 'check-parity', json: options.json });
  const parity = loadParity(root, { contract: options.contract ?? null });
  if (parity.missing) return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references to compare with`);
  if (parity.noFrames) return report.notApplicable(NO_FRAMES_REASON);
  const show = (p) => relative(process.cwd(), p) || '.';
  const runsRoot = join(root, parity.paths.runs);
  let dirs = (options.run ?? []).map((p) => resolve(p));
  if (dirs.length === 0) {
    if (!existsSync(runsRoot)) fail(`nothing to check: no run folders (${show(runsRoot)} does not exist)`, 'Capture first: node <skill>/scripts/run-parity.mjs . --frame <key> (or capture-app.mjs).');
    dirs = findRunDirs(runsRoot);
  }
  const frameFilter = new Set((options.frame ?? []).flatMap((f) => f.split(',')));
  const facts = layoutFactsOf(parity.contract);
  const floors = parity.contract.textRoleFloors ?? {};
  const waiverFile = readWaivers(join(root, parity.paths.waivers));
  for (const p of waiverFile.problems) report.problem({ file: show(waiverFile.path), ...p });
  let runs = 0;
  let passed = 0;
  for (const dir of dirs) {
    const runInfo = readRun(dir, parity);
    const { info } = runInfo;
    if (frameFilter.size && !frameFilter.has(info.frame)) continue;
    const file = show(runInfo.app);
    const frame = parity.frames.get(info.frame);
    if (!frame) {
      report.problem({ file, rule: 'reference-mismatch', message: `run.json names the frame "${info.frame}", which no screen-contract state references`, fix: `Capture a frame the contract lists (${[...parity.frames.keys()].join(', ')}).` });
      continue;
    }
    const device = parity.devices.get(info.device);
    if (!device) {
      report.problem({ file, rule: 'reference-mismatch', message: `run.json names the device "${info.device}", which the contract does not list`, fix: `Capture on a device profile of the contract (${[...parity.devices.keys()].join(', ')}).` });
      continue;
    }
    // The reference a frame with variants must be compared with comes from the app's facts.
    const wanted = variantFor(frame, parity.appFacts, parity.designFacts);
    if ((wanted?.id ?? null) !== info.variant) {
      report.problem({ file, rule: 'reference-variant', message: `captured against ${referenceName(info.frame, info.variant)}, but the app's facts (${describeFacts(parity.appFacts)}) select ${describeReference(info.frame, wanted)}`, fix: 'Capture again (capture-app.mjs reads the facts from the contract), or fix facts.app if it is wrong for this app.' });
      continue;
    }
    if (frame.probe && !(info.region?.rect && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(info.region.rect[k])))) {
      fail(`${show(dir)}/run.json has no region rectangle, but ${info.frame} masks the probed region "${frame.probe.region}"`, 'Capture it with capture-app.mjs, which launches the app once with probe=<region> and records "region" in run.json.');
    }
    if (!existsSync(runInfo.reference.layout) || !existsSync(runInfo.reference.image)) {
      report.problem({ file, rule: 'reference-missing', message: `no design reference for ${info.frame} on ${info.device} ${info.theme}-${info.lang} (${show(runInfo.reference.layout)})`, fix: `Render it: node <skill>/scripts/shoot-design.mjs . --update-reference --frame ${info.frame} (the references are the reviewer's; render them only after an approved design change).` });
      continue;
    }
    // Measurements come from the reference; element metadata (checks, parts, masks) from the current contract.
    const layout = withModal(withContractMetadata(JSON.parse(readFileSync(runInfo.reference.layout, 'utf8')), frame), frame);
    if (layout.frame !== info.frame || layout.theme !== info.theme || layout.lang !== info.lang || layout.device !== info.device) {
      report.problem({ file, rule: 'reference-mismatch', message: `run.json says ${info.frame} ${info.device} ${info.theme}-${info.lang} but the reference layout is ${layout.frame} ${layout.device} ${layout.theme}-${layout.lang}`, fix: 'Capture again with capture-app.mjs; never edit run.json or a reference by hand.' });
      continue;
    }
    if (!runInfo.hier && !runInfo.appLayout) {
      report.problem({ file, rule: 'bounds-missing', message: `the run has neither ${RUN_FILES.hier} nor ${RUN_FILES.layout}`, fix: 'Capture again with capture-app.mjs (it dumps maestro hierarchy), or write the in-app layout report.' });
      continue;
    }
    const designImg = readImage(runInfo.reference.image, 'design reference');
    const appImg = readImage(runInfo.app, 'app capture');
    const boundsPath = runInfo.appLayout ?? runInfo.hier;
    let boundsJson;
    try {
      boundsJson = JSON.parse(readFileSync(boundsPath, 'utf8'));
    } catch (error) {
      fail(`${show(boundsPath)} is not valid JSON: ${error.message}`, 'Capture again.');
    }
    const bounds = runInfo.appLayout ? parseAppLayout(boundsJson) : parseMaestroHierarchy(boundsJson, { unitScale: device.platform === 'android' ? device.scale : 1 });
    const region = frame.probe ? { ...frame.probe, name: frame.probe.region, rect: info.region.rect, source: info.region.source } : null;
    const result = compareRun({ design: { img: designImg, layout }, app: { img: appImg, bounds }, device, facts, floors, scrollY: info.scrollY, region, reachedBy: frame.modal?.reachedBy ?? null, appDrawn: frame.appDrawn });
    const { kept, waived, unused } = applyWaivers(result.problems, waiverFile.waivers, info);
    runs += 1;
    const c = result.checked;
    report.note(`run   ${show(dir)}: ${info.frame} (${layout.kind}) ${info.device} ${info.theme}-${info.lang}${info.scrollY ? ` scrollY ${info.scrollY}` : ''} [${bounds.source}]`);
    report.note(`      reference ${runInfo.reference.name}${info.variant ? ` (variant ${info.variant}, chosen by the app's facts)` : ''}`);
    report.note(`      checked: bounds ${c.bounds}, text ${c.text}, fill ${c.fill}, border ${c.border}, text-ink ${c['text-ink']}, structure ${c.structure}${result.stats.pixelDiffPercent !== undefined ? `; whole-screen pixel diff ${result.stats.pixelDiffPercent} % (report only, never a gate)` : ''}`);
    if (result.offscreen.length) report.note(`      off-screen in this capture (another scroll offset shows them): ${result.offscreen.length} elements, first ${result.offscreen.slice(0, 5).join(', ')}`);
    for (const n of result.notes.slice(0, 12)) report.note(`      note  ${n}`);
    if (result.notes.length > 12) report.note(`      note  ... ${result.notes.length - 12} more in report.json`);
    for (const w of waived) report.note(`      WAIVED [${w.rule}] ${w.message} (waiver ${w.waiver.index}, ${w.waiver.class}: ${w.waiver.reason}; reviewer told ${w.waiver.reportedOn})`);
    for (const w of unused) report.note(`      note  waiver ${w.index} (${w.testID} ${w.rule}) matched nothing here: delete it if the problem is gone everywhere`);
    for (const p of kept) {
      const element = p.testID ? layout.elements.find((el) => el.testID === p.testID) : null;
      const known = knownCauseFor(p, element, device.platform);
      report.problem({ file, rule: p.rule, message: p.message, fix: known ? `${p.fix} Known platform cause: ${known.cause}. Open the crop; when it shows only that, add a platform waiver naming this cause (references/signoff-and-waivers.md); anything more is a fix.` : p.fix });
    }
    if (kept.length === 0) passed += 1;
    if (!options['no-write']) {
      const reportJson = {
        version: 1,
        result: kept.length === 0 ? 'PASS' : 'FAIL',
        frame: info.frame,
        kind: layout.kind,
        device: info.device,
        platform: device.platform,
        theme: info.theme,
        lang: info.lang,
        scrollY: info.scrollY,
        boundsSource: bounds.source,
        createdAt: new Date().toISOString(),
        tolerances: TOLERANCES,
        reference: { image: relative(dir, runInfo.reference.image), name: runInfo.reference.name, imageSha256: sha256(readFileSync(runInfo.reference.image)), layoutSha256: sha256(readFileSync(runInfo.reference.layout)) },
        app: { imageSha256: sha256(readFileSync(runInfo.app)), boundsSha256: sha256(readFileSync(boundsPath)) },
        checked: result.checked,
        coverage: result.coverage,
        offscreen: result.offscreen,
        stats: result.stats,
        problems: kept,
        waived,
        notes: result.notes,
      };
      writeFileSync(join(dir, RUN_FILES.report), `${JSON.stringify(reportJson, null, 1)}\n`);
    }
  }
  if (runs > 0) report.note(`${passed} of ${runs} runs pass${runs > passed ? '; fix the first rule listed for each failing run, rebuild, capture, check again' : '; now run make-sheet.mjs and look'}`);
  return report.finish({ checked: runs, unit: 'runs' });
});
