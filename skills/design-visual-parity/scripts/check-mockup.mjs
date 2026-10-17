#!/usr/bin/env node
// check-mockup.mjs: proves the parity contract, the screen contract and the design mockup agree,
// without a browser: every design frame is drawn exactly once (data-frame), every testID the screen
// contract gives the frame is drawn exactly once inside it (data-testid) and nothing else is, parts sit
// inside their parent, the screenshot reach policy holds (crop-only parts are never bounds-checked and
// are covered by a reachable ancestor), and the mockup loads nothing from the network.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { createReporter, parseArgs, run } from './check-lib.mjs';
import { CHECKS, factsMatch, isCropOnly, loadParity, NO_FRAMES_REASON } from './lib/contract.mjs';
import { descendants, isInside, isRemote, parseHtml, urlsOf } from './lib/mockup-html.mjs';

const SPEC = {
  name: 'check-mockup',
  summary:
    'Checks the parity contract (contracts/visual-parity.json), the screen contract\'s design frames and the design ' +
    'mockup against each other, statically: one data-frame per design frame, one data-testid per element of the frame ' +
    'and no unknown ones, parts inside their parent, the reach policy (crop-only parts: no bounds, text or fill check, ' +
    'coveredBy a reachable ancestor; state cards: no bounds), device profiles and variants well formed, and a mockup ' +
    'that loads nothing from the network (fonts from local files).',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json, or rn-skills.config.json "visualParityContract")' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Mockup conventions (references/mockup-and-references.md): each design frame is one element with',
    'data-frame="<frame-key>" (the key is the state\'s reference file name without .png); each element of the frame',
    'carries data-testid="<the testID>" with its keys filled in (tasks.task-row.milk). A frame drawn only to discuss',
    'something (never captured) carries data-mock-only.',
    '',
    'Reach policy: Maestro\'s hierarchy is the accessibility tree, so it never lists the children of an accessible',
    'element or a part hidden from screen readers. Such parts ("parent" or "a11yHidden" in the screen contract) are',
    'crop-only: "checks" is ["crop"] (or []), and "coveredBy" names the nearest reachable ancestor whose crop is',
    'compared (one with "crop" or "fill" in its checks, or the frame root).',
    '',
    'NOT APPLICABLE when the app keeps no parity contract, or no design frame yet (no screen state has a',
    '"reference" and the contract\'s "frames" is empty: the capture wiring came before an approved design).',
    '',
    'Example: node check-mockup.mjs .',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const report = createReporter({ name: 'check-mockup', json: options.json });
  const parity = loadParity(root, { contract: options.contract ?? null, strict: false });
  if (parity.missing) return report.notApplicable(`${parity.contractRel} does not exist: the app keeps no approved design references`);
  if (parity.noFrames && parity.problems.length === 0) return report.notApplicable(NO_FRAMES_REASON);
  for (const p of parity.problems) report.problem({ file: p.file, rule: 'contract-invalid', message: p.message, fix: p.fix });
  if (parity.broken) return report.finish({ checked: 1, unit: 'files' });
  const contractFile = parity.contractRel;

  // The reach policy, per frame (needs only the two contracts).
  for (const frame of parity.frames.values()) {
    const byId = new Map(frame.elements.map((el) => [el.testID, el]));
    for (const el of frame.elements) {
      for (const c of el.checks) if (!CHECKS.includes(c)) report.problem({ file: parity.screensRel, rule: 'element-reach', message: `${frame.key}: ${el.testID} has the unknown check "${c}"`, fix: `Checks are ${CHECKS.join(', ')}.` });
      if (frame.kind === 'state-card' && el.checks.includes('bounds')) report.problem({ file: parity.screensRel, rule: 'state-card-bounds', message: `${frame.key}: ${el.testID} asks for a bounds check, but ${frame.key} is a state card (a fragment compared by text, fill, ink size and crop, never by position)`, fix: 'Drop "bounds" from its checks (or make the frame a phone frame).' });
      if (!isCropOnly(el)) continue;
      const bad = el.checks.filter((c) => c !== 'crop');
      if (bad.length) report.problem({ file: parity.screensRel, rule: 'element-reach', message: `${frame.key}: ${el.testID} is crop-only (${el.parent ? `inside the accessible ${el.parent}` : 'hidden from screen readers'}), so "${bad.join('", "')}" cannot be checked: Maestro never lists it`, fix: 'Give it "checks": ["crop"] and a "coveredBy"; never un-hide a decorative part to measure it.' });
      const cover = el.coveredBy ? byId.get(el.coveredBy) : null;
      if (!el.coveredBy) report.problem({ file: parity.screensRel, rule: 'element-cover', message: `${frame.key}: ${el.testID} is crop-only but names no "coveredBy"`, fix: `Set "coveredBy": "${el.parent ?? frame.root}" (the nearest reachable ancestor whose crop is compared).` });
      else if (!cover) report.problem({ file: parity.screensRel, rule: 'element-cover', message: `${frame.key}: ${el.testID} is coveredBy ${el.coveredBy}, which is not an element of the frame`, fix: 'Name a reachable ancestor of the frame.' });
      else if (isCropOnly(cover)) report.problem({ file: parity.screensRel, rule: 'element-cover', message: `${frame.key}: ${el.testID} is coveredBy ${el.coveredBy}, which is crop-only itself`, fix: `Name the nearest reachable ancestor (Set "coveredBy": "${cover.coveredBy ?? frame.root}").` });
      else if (cover.testID !== frame.root && !cover.checks.some((c) => c === 'crop' || c === 'fill')) report.problem({ file: parity.screensRel, rule: 'element-cover', message: `${frame.key}: ${el.testID} is coveredBy ${el.coveredBy}, whose crop is never compared (its checks are ${JSON.stringify(cover.checks)})`, fix: `Give ${el.coveredBy} "crop" or "fill" in its checks, or cover the part with the frame root.` });
    }
  }

  // The mockup.
  const mockupPath = join(root, parity.paths.mockup);
  const mockupRel = parity.paths.mockup;
  if (!existsSync(mockupPath)) {
    report.problem({ file: mockupRel, rule: 'mockup-missing', message: 'the design mockup the contract names does not exist', fix: "Put the approved mockup there (static HTML and CSS, one data-frame per design frame; the skill's templates/design/parity/mockup/index.html shows the shape), or fix mockup.file." });
    return report.finish({ checked: parity.frames.size, unit: 'frames' });
  }
  const html = readFileSync(mockupPath, 'utf8');
  const parsed = parseHtml(html);
  for (const u of urlsOf(parsed)) {
    if (isRemote(u.url)) report.problem({ file: `${mockupRel}:${u.line}`, rule: 'mockup-offline', message: `the mockup loads ${u.url} from the network`, fix: 'Copy the file next to the mockup (fonts: the exact files the app bundles) and point at the local copy; references render offline, so a remote file never loads.' });
    else if (!/^(data:|#|mailto:|about:)/i.test(u.url) && u.kind === 'css' && /\.(ttf|otf|woff2?)(\?|#|$)/i.test(u.url)) {
      const local = resolve(dirname(mockupPath), decodeURI(u.url.split(/[?#]/)[0]));
      if (!existsSync(local)) report.problem({ file: `${mockupRel}:${u.line}`, rule: 'mockup-font', message: `the font ${u.url} does not exist (${relative(root, local)})`, fix: 'Copy the exact font file the app bundles there: both sides must rasterise the same outlines.' });
    }
  }
  const frameNodes = parsed.nodes.filter((n) => n.attrs.has('data-frame'));
  for (const node of frameNodes) {
    const key = node.attrs.get('data-frame');
    if (!parity.frames.has(key) && !node.attrs.has('data-mock-only')) {
      report.problem({ file: `${mockupRel}:${node.line}`, rule: 'mockup-frame', message: `data-frame="${key}" is not a design frame of the screen contract`, fix: `Give the state its "reference": "${key}.png" in the screen contract, fix the key, or mark a frame that is never captured data-mock-only.` });
    }
  }
  for (const frame of parity.frames.values()) {
    const matches = frameNodes.filter((n) => n.attrs.get('data-frame') === frame.key);
    if (matches.length !== 1) {
      report.problem({ file: mockupRel, rule: 'mockup-frame', message: `the frame ${frame.key} is drawn ${matches.length} times (data-frame="${frame.key}")`, fix: 'Draw each design frame exactly once.' });
      continue;
    }
    const frameNode = matches[0];
    const inside = [frameNode, ...descendants(frameNode)].filter((n) => n.attrs.has('data-testid'));
    const byTestId = new Map();
    for (const n of inside) {
      const id = n.attrs.get('data-testid');
      byTestId.set(id, [...(byTestId.get(id) ?? []), n]);
    }
    const drawn = frame.elements.filter((el) => !el.when || factsMatch(el.when, parity.designFacts));
    const known = new Set(frame.elements.map((el) => el.testID));
    for (const el of drawn) {
      const found = byTestId.get(el.testID) ?? [];
      if (found.length !== 1) report.problem({ file: `${mockupRel}:${found[1]?.line ?? frameNode.line}`, rule: 'mockup-testid', message: `${frame.key}: ${el.testID} matches ${found.length} elements of the frame`, fix: found.length ? 'Give exactly one element of the frame this data-testid.' : `Mark the element the design draws for ${el.testID} with data-testid="${el.testID}" (or fix the screen contract).` });
    }
    for (const [id, list] of byTestId) {
      if (!known.has(id)) report.problem({ file: `${mockupRel}:${list[0].line}`, rule: 'mockup-unknown-testid', message: `${frame.key}: data-testid="${id}" is not an element of ${frame.screen} ${frame.state} in the screen contract`, fix: 'Add the element to the screen contract first (screen-contracts), or fix the id in the mockup.' });
    }
    for (const el of drawn) {
      const node = (byTestId.get(el.testID) ?? [])[0];
      if (!node) continue;
      if (el.parent) {
        const parent = (byTestId.get(el.parent) ?? [])[0];
        if (parent && !isInside(node, parent)) report.problem({ file: `${mockupRel}:${node.line}`, rule: 'mockup-parent', message: `${frame.key}: ${el.testID} names the parent ${el.parent}, but the mockup does not draw it inside that element`, fix: 'Nest the part inside its parent in the mockup, or fix "parent" in the screen contract.' });
      }
      if (el.coveredBy && isCropOnly(el)) {
        const cover = (byTestId.get(el.coveredBy) ?? [])[0];
        if (cover && el.coveredBy !== frame.root && !isInside(node, cover)) report.problem({ file: `${mockupRel}:${node.line}`, rule: 'element-cover', message: `${frame.key}: ${el.testID} is coveredBy ${el.coveredBy}, but the mockup does not draw it inside that element`, fix: 'Name the ancestor that really holds the part.' });
      }
      if (!isCropOnly(el)) {
        // A reachable element inside a part hidden from screen readers is hidden with it.
        const hiddenAncestor = frame.elements.find((other) => other.a11yHidden && other.testID !== el.testID && (byTestId.get(other.testID) ?? []).some((h) => isInside(node, h)));
        if (hiddenAncestor) report.problem({ file: `${mockupRel}:${node.line}`, rule: 'element-reach', message: `${frame.key}: ${el.testID} is reachable, but it sits inside ${hiddenAncestor.testID}, which is hidden from screen readers (so Maestro never lists it either)`, fix: 'Draw it outside the hidden part (as a sibling), or mark it crop-only with a coveredBy.' });
      }
    }
  }
  return report.finish({ checked: parity.frames.size, unit: 'frames' });
});
