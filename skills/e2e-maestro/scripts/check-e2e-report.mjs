#!/usr/bin/env node
// check-e2e-report.mjs: reads the artefacts of one end-to-end run and proves it: the run was the full
// evidence run (run.json: no tag filter, large text not skipped), every flow in junit.xml passed,
// every smoke flow ran, one socket sampler watched each device of the run until the end and found the
// app (network-samplers.json) and the app opened no socket its network policy does not allow, the
// a11y flows passed at the largest text size in every contract locale on the phone and the tablet,
// and (with --screenshots) this platform's capture captured every combination, no screenshot differs
// from its baseline and every set is complete. Prints the evidence lines for the report.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/check-e2e-report.mjs [repo-root] --platform <ios|android> [--screenshots]

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, run, walk } from './check-lib.mjs';
import { e2eApps, isAdopted, readContract, readRepoJson } from './lib/e2e-repo.mjs';
import { parseFlow } from './lib/maestro-yaml.mjs';

const SPEC = {
  name: 'check-e2e-report',
  summary: 'Checks the reports of one e2e run (and of the screenshot capture) and prints the evidence lines.',
  usage: '[repo-root] --platform <ios|android> [options]',
  options: {
    platform: { type: 'string', value: 'ios|android', help: 'The platform the run was for (required)' },
    reports: { type: 'string', default: 'reports', value: 'dir', help: "The reports folder, relative to the app's folder" },
    screenshots: { type: 'boolean', help: "Also check reports/screenshots/<platform>/summary.json of the platform's screenshot capture" },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Reads <reports>/e2e/<platform>/{run.json, junit.xml, network.txt, network-samplers.json,',
    'large-text/<phone|tablet>-<locale>/junit.xml} and, with --screenshots, <reports>/screenshots/<platform>/summary.json',
    '(the capture empties that folder first, so it is always the last capture of this platform). When multi-package,',
    'run it per app folder.',
    '',
    'Rules:',
    '  run-record           run.json is missing: the run did not come from the runner (scripts/e2e/run-e2e.ts)',
    '  run-filtered         the run had a tag filter (--include-tags) or skipped the large-text step: never evidence',
    '  flow-failed          a test case has a failure or error, or a status other than SUCCESS or WARNING',
    '  no-flows             junit.xml holds no test case',
    '  smoke-not-run        a smoke flow of .maestro/flows/ is not in junit.xml',
    '  network-sampler      the network policy is not off but network.txt or network-samplers.json is missing, a device',
    '                       of run.json has no sampler, or a sampler took no sample, never found the app, or died',
    '                       before the end (an empty network.txt from a sampler that was not watching proves nothing)',
    '  network-sockets      network.txt lists a socket the policy does not allow (offline-only: any host;',
    '                       allowlist: a host outside allowHosts)',
    '  large-text-missing   a11y flows exist but a large-text/<device>-<locale>/junit.xml is missing',
    '  large-text-failed    an a11y flow failed at the largest text size',
    '  screenshot-capture-failed (--screenshots) a device x locale x theme combination captured nothing (a device that',
    '                       did not start, a matrix flow that failed): its summary row has result kind capture-failed',
    '  screenshot-platform  (--screenshots) a summary row whose label does not start with the --platform',
    '  screenshot-changed   (--screenshots) a screenshot differs from its baseline, changed size or has no baseline',
    '  matrix-incomplete    (--screenshots) a set has fewer screenshots than the other sets of its platform',
    'NOT APPLICABLE: the app has no Maestro E2E yet. Missing junit.xml is bad input (exit 2): run the runner first.',
  ].join('\n'),
};

const PASSED = ['SUCCESS', 'WARNING'];

function decode(text) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The test cases of a Maestro JUnit report: { name, file, status, failure, line }. */
export function testCases(xml) {
  const cases = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((pair) => [pair[1], decode(pair[2])]));
    const failure = /<(failure|error)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/.exec(match[3] ?? '');
    cases.push({ name: attrs.name ?? '', file: attrs.file ?? '', status: attrs.status ?? (failure ? 'ERROR' : 'SUCCESS'), failure: failure ? decode(failure[2] ?? failure[0]).trim() : null, line: xml.slice(0, match.index).split('\n').length });
  }
  return cases;
}

const isPassed = (item) => item.failure === null && PASSED.includes(item.status);
const sameFlow = (file, rel) => file === rel || file.endsWith(`/${rel}`) || file.endsWith(`/${posix.basename(posix.dirname(rel))}/${posix.basename(rel)}`);

/** The runner's flows with their tags: .maestro/flows/<area>/*.yaml. */
function flowsOf(root, app) {
  const dir = posix.join(app.layout.e2eDir, 'flows');
  if (!existsSync(join(root, dir))) return [];
  return walk(join(root, dir), { include: ['*.yaml', '*.yml'] }).filter((local) => local.split('/').length === 2).map((local) => {
    const rel = posix.join(dir, local);
    const tags = parseFlow(readFileSync(join(root, rel), 'utf8')).header?.tags;
    const list = Array.isArray(tags) ? tags.map(String) : [];
    return { rel, isSmoke: list.includes('smoke'), isQuarantined: list.includes('quarantine'), isA11y: list.includes('a11y') };
  });
}

function checkRecord(ctx) {
  const rel = posix.join(ctx.out, 'run.json');
  const record = readRepoJson(ctx.root, rel);
  if (record === null || record.error !== undefined) {
    ctx.report.problem({ file: rel, line: 0, rule: 'run-record', message: record === null ? 'is missing, so this is no runner run' : `is not JSON: ${record.error}`, fix: `Run the evidence run through the runner: npm run e2e:${ctx.platform} (a hand-run maestro test is never evidence).` });
    return null;
  }
  const data = record.data;
  if (data.includeTags !== null && data.includeTags !== undefined) ctx.report.problem({ file: rel, line: 0, rule: 'run-filtered', message: `the run was filtered with --include-tags ${data.includeTags}`, fix: `Run npm run e2e:${ctx.platform} without --include-tags for evidence (filters are for iterating).` });
  if (data.largeText === 'skipped') ctx.report.problem({ file: rel, line: 0, rule: 'run-filtered', message: 'the run skipped the large-text step (--skip-large-text)', fix: `Run npm run e2e:${ctx.platform} without --skip-large-text for evidence.` });
  return data;
}

function checkJunit(ctx, flows) {
  const rel = posix.join(ctx.out, 'junit.xml');
  if (!existsSync(join(ctx.root, rel))) fail(`nothing to check: ${rel} does not exist`, `Run npm run e2e:${ctx.platform} first (it needs a Release build of a test variant).`);
  const cases = testCases(readFileSync(join(ctx.root, rel), 'utf8'));
  if (cases.length === 0) ctx.report.problem({ file: rel, line: 1, rule: 'no-flows', message: 'holds no test case', fix: 'Check that flows exist under .maestro/flows/<area>/ and that the runner lists them.' });
  for (const item of cases.filter((entry) => !isPassed(entry))) ctx.report.problem({ file: item.file || rel, line: 0, rule: 'flow-failed', message: `"${item.name}" ${item.status}: ${String(item.failure ?? 'no detail').split('\n')[0].slice(0, 160)}`, fix: `Open ${ctx.out}/ (per-flow logs and screenshots) and rerun that flow alone; if it passes alone it is flaky: fix the wait, the setup or the app, never add retry.` });
  for (const flow of flows.filter((item) => item.isSmoke && !item.isQuarantined && !cases.some((entry) => sameFlow(entry.file, item.rel)))) ctx.report.problem({ file: flow.rel, line: 0, rule: 'smoke-not-run', message: 'this smoke flow is not in junit.xml', fix: `Run the full suite (npm run e2e:${ctx.platform}) without filters before calling the run done.` });
  const quarantined = flows.filter((item) => item.isQuarantined).map((item) => item.rel);
  ctx.report.note(`evidence: End-to-end (${ctx.platform}): ${cases.filter(isPassed).length}/${cases.length} flows pass, quarantined: ${quarantined.length === 0 ? 'none' : quarantined.join(', ')} (${rel})`);
  return cases.length;
}

/** The devices of the run (run.json devices, else its phone). */
function runDevices(record) {
  if (Array.isArray(record?.devices)) return record.devices.filter((device) => typeof device?.id === 'string');
  return typeof record?.deviceId === 'string' ? [{ name: record.device ?? record.deviceId, id: record.deviceId }] : [];
}

/** The samplers' liveness (network-samplers.json, written by the runner): a summary, or null. */
function checkSamplers(ctx, record) {
  const rel = posix.join(ctx.out, 'network-samplers.json');
  const problem = (message) => ctx.report.problem({ file: rel, line: 0, rule: 'network-sampler', message, fix: `Rerun npm run e2e:${ctx.platform}: each socket sampler must sample until the end and find the app on its device (the runner proves it before stopping them); a sampler's lastError names the ${ctx.platform === 'ios' ? 'pgrep or lsof' : 'adb (pm list packages -U, pidof, /proc/net)'} failure to fix.` });
  const read = readRepoJson(ctx.root, rel);
  const entries = Array.isArray(read?.data) ? read.data : null;
  if (entries === null || entries.length === 0) {
    problem(read === null ? 'is missing, so no socket sampler was proven alive and an empty network.txt proves nothing' : read.error !== undefined ? `is not JSON: ${read.error}` : 'lists no socket sampler');
    return null;
  }
  let isAlive = true;
  for (const entry of entries) {
    const who = `${entry?.device ?? '?'} (${entry?.deviceId ?? '?'})`;
    const problems = Array.isArray(entry?.problems) ? entry.problems.map(String) : ['has no verdict'];
    if (!(entry?.samples > 0)) problems.push('took no sample');
    else if (!(entry?.appSamples > 0) && !problems.some((text) => text.startsWith('never found the app'))) problems.push(`never found the app in ${entry.samples} samples`);
    else if (entry?.appSamples > 0 && entry?.listErrors >= entry.appSamples && !problems.some((text) => text.startsWith('found the app but never listed'))) problems.push(`found the app in ${entry.appSamples} samples but never listed its sockets`);
    for (const text of problems) problem(`the sampler on ${who} ${text}${/^(never found|found the app in)/.test(text) && entry?.lastError ? ` (last error: ${String(entry.lastError).slice(0, 100)})` : ''}`);
    if (problems.length > 0) isAlive = false;
  }
  for (const device of runDevices(record).filter((item) => !entries.some((entry) => entry?.deviceId === item.id))) {
    problem(`${device.name ?? device.id} (${device.id}) ran flows but has no socket sampler`);
    isAlive = false;
  }
  if (!isAlive) return null;
  const samples = entries.reduce((sum, entry) => sum + entry.samples, 0);
  return `${entries.length} sampler(s) alive to the end, ${samples} samples`;
}

function checkNetwork(ctx, mode, record) {
  const rel = posix.join(ctx.out, 'network.txt');
  if (mode === 'off') {
    ctx.report.note('evidence: Network: no runtime proof (contracts/e2e.json network.mode off)');
    return;
  }
  const alive = checkSamplers(ctx, record);
  if (!existsSync(join(ctx.root, rel))) {
    ctx.report.problem({ file: rel, line: 0, rule: 'network-sampler', message: 'is missing: every socket sampler creates it when it starts, so none started', fix: `Run through npm run e2e:${ctx.platform}: the runner samples the app's sockets every second on each device of the run.` });
    return;
  }
  const lines = readFileSync(join(ctx.root, rel), 'utf8').split('\n').filter((line) => line.trim() !== '');
  const allowed = mode === 'allowlist' ? 'outside allowHosts' : 'to another host (offline-only)';
  lines.forEach((line, index) => ctx.report.problem({ file: rel, line: index + 1, rule: 'network-sockets', message: `the app opened a socket ${allowed}: ${line.trim().slice(0, 140)}`, fix: 'Find the code path that opened it (only src/api/ talks to the network, through the ApiClient; an SDK that phones home belongs behind a port and off in test builds). If the host is intended, add it to contracts/e2e.json allowHosts with the reviewer.' }));
  if (lines.length === 0 && alive !== null) ctx.report.note(`evidence: Network (${ctx.platform}, ${mode}): no disallowed socket (${rel} empty; ${alive})`);
}

function checkLargeText(ctx, flows, locales) {
  const a11y = flows.filter((flow) => flow.isA11y && !flow.isQuarantined);
  if (a11y.length === 0) return 0;
  if (locales.length === 0) {
    ctx.report.problem({ file: 'contracts/e2e.json', line: 1, rule: 'large-text-missing', message: `${a11y.length} a11y flow(s) exist but contracts/e2e.json largeText.locales is empty, so no large-text run is due`, fix: 'List a left-to-right locale and, when the app has one, a right-to-left locale in largeText.locales, then rerun the evidence run.' });
    return 0;
  }
  let passed = 0;
  let total = 0;
  for (const device of ['phone', 'tablet']) for (const locale of locales) {
    const rel = posix.join(ctx.out, 'large-text', `${device}-${locale}`, 'junit.xml');
    if (!existsSync(join(ctx.root, rel))) {
      ctx.report.problem({ file: rel, line: 0, rule: 'large-text-missing', message: `${a11y.length} a11y flow(s) exist but the ${device} ${locale} large-text run left no report`, fix: `Run the evidence run without --skip-large-text: npm run e2e:${ctx.platform}.` });
      continue;
    }
    for (const item of testCases(readFileSync(join(ctx.root, rel), 'utf8'))) {
      total += 1;
      if (isPassed(item)) passed += 1;
      else ctx.report.problem({ file: item.file || rel, line: 0, rule: 'large-text-failed', message: `${device}-${locale}: "${item.name}" ${item.status}: ${String(item.failure ?? 'no detail').split('\n')[0].slice(0, 140)}`, fix: `Open ${posix.dirname(rel)}/ (log and screenshots): text must grow without clipping; let rows wrap and stack, use minHeight, never cap the font size.` });
    }
  }
  ctx.report.note(`evidence: Large text (${ctx.platform}): ${passed}/${total} a11y flow runs pass at the largest size (phone and tablet, ${locales.join(' and ')}); open the screenshots in ${ctx.out}/large-text/`);
  return total;
}

function checkScreenshots(ctx) {
  const dir = posix.join(ctx.reports, 'screenshots', ctx.platform);
  const rel = posix.join(dir, 'summary.json');
  const read = readRepoJson(ctx.root, rel);
  if (read === null) fail(`nothing to check: ${rel} does not exist`, `Run npm run screenshots:${ctx.platform} first, or drop --screenshots.`);
  if (read.error !== undefined || !Array.isArray(read.data)) fail(`${rel} is not a list of rows`, `Rerun npm run screenshots:${ctx.platform}.`);
  const perSet = new Map();
  let changed = 0;
  let fresh = 0;
  let failed = 0;
  for (const row of read.data) {
    const label = String(row?.label ?? '');
    if (!label.startsWith(`${ctx.platform}/`)) {
      ctx.report.problem({ file: rel, line: 0, rule: 'screenshot-platform', message: `the row "${label.slice(0, 80)}" is not an ${ctx.platform} screenshot`, fix: `Rerun npm run screenshots:${ctx.platform}: it writes only ${ctx.platform} rows into ${dir}/ (each platform has its own folder; never copy or merge summaries).` });
      continue;
    }
    if (row.result?.kind === 'capture-failed') {
      failed += 1;
      ctx.report.problem({ file: row.result.outDir ?? rel, line: 0, rule: 'screenshot-capture-failed', message: `${label}: ${String(row.result.message ?? 'no detail').slice(0, 160)}`, fix: `Read the Maestro log in ${row.result.outDir ?? `${dir}/raw/`} (a device that did not start, a step that failed), fix it, then rerun npm run screenshots:${ctx.platform} (narrow with --devices and --locales while fixing; the evidence is a full run).` });
      continue;
    }
    const set = label.split('/').slice(0, 3).join('/');
    perSet.set(set, (perSet.get(set) ?? 0) + 1);
    if (row.result === 'baseline-written') {
      fresh += 1;
      continue;
    }
    const kind = row.result?.kind;
    if (kind === 'match') continue;
    changed += 1;
    const detail = kind === 'mismatch' ? `${(Number(row.result.diffRatio) * 100).toFixed(2)}% of pixels differ, diff ${row.result.diffPath}` : kind === 'size-changed' ? `size ${row.result.expected} became ${row.result.actual}` : kind === 'missing-baseline' ? `no baseline at ${row.result.baselinePath}` : `result ${JSON.stringify(row.result)}`;
    ctx.report.problem({ file: row.baseline ?? rel, line: 0, rule: 'screenshot-changed', message: `${row.label}: ${detail}`, fix: 'Open the baseline, this run and the diff. A bug: fix the screen. Intended: rerun with --update for that device and locale only, open every new PNG, commit with a Gate-Change trailer. Never raise the tolerance.' });
  }
  for (const platform of new Set([...perSet.keys()].map((set) => set.split('/')[0]))) {
    const sets = [...perSet].filter(([set]) => set.startsWith(`${platform}/`) && !set.endsWith('-largest'));
    const most = Math.max(0, ...sets.map(([, count]) => count));
    for (const [set, count] of sets.filter(([, value]) => value < most)) ctx.report.problem({ file: rel, line: 0, rule: 'matrix-incomplete', message: `${set} has ${count} screenshots, other ${platform} sets have ${most}`, fix: `Read the Maestro log under ${dir}/raw/${set.split('/').slice(1).join('/')}/ for the step that failed, fix it, and rerun that device and locale.` });
  }
  if (fresh > 0) ctx.report.note(`note: ${fresh} new baseline(s) written; open each one before committing`);
  const captured = [...perSet.values()].reduce((sum, count) => sum + count, 0);
  if (failed === 0) ctx.report.note(`evidence: Screenshots (${ctx.platform}): ${captured} captured in ${perSet.size} sets, ${changed} changed (${dir}/index.html)`);
  return read.data.length;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${positionals[0] ?? '.'} has no package.json`, 'Run from the app folder or pass it.');
  if (options.platform !== 'ios' && options.platform !== 'android') fail('pass --platform ios or --platform android', 'The runner writes reports/e2e/<platform>/.');
  const report = createReporter({ name: SPEC.name, json: options.json });
  const [app] = e2eApps(root).filter((item) => item.dir === '');
  if (!isAdopted(root, app)) return report.notApplicable("the app has no Maestro E2E yet: no .maestro/ folder, no contracts/e2e.json and no e2e npm script (e2e-maestro's workflow creates them)");
  const contract = readContract(root, app).data ?? {};
  const ctx = { root, report, platform: options.platform, reports: options.reports, out: posix.join(options.reports, 'e2e', options.platform) };
  const flows = flowsOf(root, app);
  let checked = checkJunit(ctx, flows);
  const record = checkRecord(ctx);
  checkNetwork(ctx, record?.networkMode ?? contract.network?.mode ?? 'offline-only', record);
  checked += checkLargeText(ctx, flows, Array.isArray(contract.largeText?.locales) ? contract.largeText.locales : []);
  if (options.screenshots) checked += checkScreenshots(ctx);
  return report.finish({ checked: Math.max(checked, 1), unit: 'flows and screenshots' });
});
