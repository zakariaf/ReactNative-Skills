#!/usr/bin/env node
// run-parity.mjs: the whole machine side of the parity loop for design frames on one device, in every
// theme x language of the done set (and at every scroll offset of a tall frame): capture-app.mjs,
// then check-parity.mjs, then make-sheet.mjs, with one summary table and the list of sheets to read.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, fail, makeTempDir, parseArgs, removeTempDir, run } from './check-lib.mjs';
import { describeFacts, describeReference, deviceOf, listOption, referenceFiles, requireParity, selectFrames, variantFor } from './lib/contract.mjs';
import { layoutFactsOf, scrollPlan } from './lib/gates.mjs';
import { RUN_FILES, defaultRunDir, runDirName } from './lib/runs.mjs';
import { driverPortOf, freePort } from './lib/tools.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

const SPEC = {
  name: 'run-parity',
  summary:
    'Runs the parity loop for design frames (--frame, or every frame of --screen) on one device: for each theme x ' +
    'language (default: the done set of the contract) and each scroll offset of a tall frame it captures the app ' +
    '(capture-app.mjs), checks it (check-parity.mjs) and draws the look-pass sheets (make-sheet.mjs). Prints one line ' +
    'per run and the sheets to read. --recheck skips the capture and checks the runs already captured.',
  usage: '[repo-root] (--frame <key>... | --screen <id>... | --all) [--device <id>] [options]',
  options: {
    frame: { type: 'string', multiple: true, value: 'key', help: 'Design frame key(s)' },
    screen: { type: 'string', multiple: true, value: 'id', help: 'Screen id(s): every frame of the screen' },
    all: { type: 'boolean', help: 'Every design frame' },
    device: { type: 'string', value: 'id', help: 'Device profile id (default: the only one in the contract)' },
    themes: { type: 'string', value: 'list', help: "Themes (default: the contract's; narrowing is for iteration, the sign-off needs all)" },
    langs: { type: 'string', value: 'list', help: "Languages (default: the contract's; narrowing is for iteration, the sign-off needs all)" },
    recheck: { type: 'boolean', help: 'Do not capture; check and draw the existing runs again' },
    'app-id': { type: 'string', value: 'id', help: 'Passed to capture-app.mjs (default: the contract\'s launch ids)' },
    scheme: { type: 'string', value: 'scheme', help: 'Passed to capture-app.mjs (Android)' },
    name: { type: 'string', value: 'name', help: "This session's simulator or AVD name (passed to capture-app.mjs)" },
    xcrun: { type: 'string', value: 'path', help: 'Passed to capture-app.mjs' },
    adb: { type: 'string', value: 'path', help: 'Passed to capture-app.mjs' },
    maestro: { type: 'string', value: 'path', help: 'Passed to capture-app.mjs' },
    'driver-port': { type: 'string', value: 'port', help: "Maestro's driver host port, iOS and Android (default: a free port picked once for this run)" },
    contract: { type: 'string', value: 'file', help: 'The parity contract (default: contracts/visual-parity.json)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Before the first run: setup-parity-device.mjs (once per boot) and the build installed on that device. After a',
    'PASS: read every sheet listed, then sign off with check-signoff.mjs.',
    'Each session uses its own device (--name <project>-parity-<key>); on iOS every Maestro call gets this run\'s own',
    'driver port, and each launch carries a nonce the hierarchy dump must contain. A run takes 10 to 20 s, so a screen',
    'with many frames can outlast a 2-minute command timeout: run it in the background or narrow it while fixing',
    '(never for the sign-off). Writes only into the contract\'s runsDir (.parity/ by default).',
    '',
    'Examples:',
    '  node run-parity.mjs . --screen tasks --device iphone-16-pro --name tasks-parity-a',
    '  node run-parity.mjs . --frame lists-default --themes dark --langs ar --name tasks-parity-a   (iteration only)',
    '  node run-parity.mjs . --screen tasks --recheck',
  ].join('\n'),
};

/** Run one of this skill's scripts; returns { status, problems: [{file, rule, message, fix}], out }. */
function runScript(name, args) {
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, name), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const problems = [];
  for (const line of out.split('\n')) {
    const m = /^FAIL (?:(\S+) )?\[([^\]]+)\] (.*?)(?: Fix: (.*))?$/.exec(line);
    if (m) problems.push({ file: m[1] ?? '', rule: m[2], message: m[3], fix: m[4] ?? '' });
  }
  // "ERROR [rule] <message> Fix: <fix>": keep the two apart so the relayed error has one Fix.
  const [error = null, errorFix = null] = /^ERROR \[[^\]]+\] (.*)$/m.exec(out)?.[1].split(' Fix: ') ?? [];
  return { status: r.status ?? 2, problems, error, errorFix, out };
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const parity = requireParity(root, { contract: options.contract ?? null });
  const keys = selectFrames(parity, { frame: options.frame ?? [], screen: options.screen ?? [], all: options.all === true });
  if (!keys.length) fail('nothing to run: pass --frame <key>, --screen <id> or --all', 'Run: node run-parity.mjs --help');
  const device = deviceOf(parity, options.device);
  const themes = listOption(options.themes, parity.contract.themes);
  const langs = listOption(options.langs, parity.contract.languages);
  for (const t of themes) if (!parity.contract.themes.includes(t)) fail(`unknown theme "${t}"`, `The contract lists ${parity.contract.themes.join(', ')}.`);
  for (const l of langs) if (!parity.contract.languages.includes(l)) fail(`unknown language "${l}"`, `The contract lists ${parity.contract.languages.join(', ')}.`);
  // One driver port for the whole run (iOS and Android): the one this session passed, else a free one.
  const driverPort = options.recheck ? null : (driverPortOf(options['driver-port']) ?? (await freePort()));
  const regionCacheDir = !options.recheck && keys.some((k) => parity.frames.get(k).probe) ? makeTempDir('run-parity-region-') : null;
  const facts = layoutFactsOf(parity.contract);
  const show = (p) => relative(process.cwd(), p) || '.';
  const shared = [...(options.contract ? ['--contract', options.contract] : [])];
  const report = createReporter({ name: 'run-parity' });
  const table = [];
  const sheets = [];
  let runs = 0;
  if (Object.keys(parity.appFacts).length) report.note(`facts ${parity.contractRel}: ${describeFacts(parity.appFacts)}`);
  if (driverPort) report.note(`Maestro driver port ${driverPort} for this run${options['driver-port'] ? ' (given)' : ' (free port)'}`);
  try {
    for (const key of keys) {
      const frame = parity.frames.get(key);
      const variant = variantFor(frame, parity.appFacts, parity.designFacts);
      report.note(`frame ${key}: reference ${describeReference(key, variant)}${frame.probe ? `; region ${frame.probe.region} masked from its probe launch` : ''}`);
      for (const theme of themes) {
        for (const lang of langs) {
          const layoutPath = join(root, referenceFiles(parity, { device: device.id, theme, lang, frame: key, variant: variant?.id }).layout);
          const offsets = frame.kind === 'phone-tall' && existsSync(layoutPath) ? scrollPlan(JSON.parse(readFileSync(layoutPath, 'utf8')), device, facts) : [0];
          if (!options.recheck) {
            // Captures at offsets this plan no longer uses would still be judged by check-signoff.
            const frameDir = join(root, parity.paths.runs, device.id, key);
            const planned = new Set(offsets.map((y) => runDirName(theme, lang, y)));
            const old = existsSync(frameDir) ? readdirSync(frameDir).filter((name) => name.startsWith(`${theme}-${lang}-y`) && !planned.has(name)) : [];
            for (const name of old) {
              rmSync(join(frameDir, name), { recursive: true, force: true });
              report.note(`removed ${show(join(frameDir, name))} (a scroll offset the plan no longer uses)`);
            }
          }
          for (const scrollY of offsets) {
            runs += 1;
            const dir = defaultRunDir(parity, { device: device.id, frame: key, theme, lang, scrollY });
            const label = `${key} ${device.id} ${theme}-${lang}${scrollY ? ` y${scrollY}` : ''}`;
            const relay = (result) => result.problems.forEach((p) => report.problem({ ...p, message: `${label}: ${p.message}` }));
            if (!options.recheck) {
              const extra = [
                ...(options['app-id'] ? ['--app-id', options['app-id']] : []),
                ...(options.scheme ? ['--scheme', options.scheme] : []),
                ...(options.name ? ['--name', options.name] : []),
                ...(options.xcrun ? ['--xcrun', options.xcrun] : []),
                ...(options.adb ? ['--adb', options.adb] : []),
                ...(options.maestro ? ['--maestro', options.maestro] : []),
                ...(driverPort ? ['--driver-port', String(driverPort)] : []),
                ...(regionCacheDir ? ['--region-cache', join(regionCacheDir, 'regions.json')] : []),
              ];
              const cap = runScript('capture-app.mjs', [root, '--frame', key, '--device', device.id, '--theme', theme, '--lang', lang, '--scroll', String(scrollY), ...extra, ...shared]);
              if (cap.status === 2) fail(`capture-app.mjs stopped on ${label}: ${cap.error ?? cap.out.trim().split('\n').at(-2)}`, cap.errorFix ?? 'Fix the environment (setup-parity-device.mjs, the installed build), then run again.');
              if (cap.status !== 0) {
                relay(cap);
                table.push(`${label.padEnd(44)} CAPTURE FAILED (${cap.problems.map((p) => p.rule).join(', ')})`);
                continue;
              }
            } else if (!existsSync(join(dir, RUN_FILES.info))) {
              report.problem({ file: show(dir), rule: 'not-captured', message: `${label}: no run folder to check again`, fix: 'Run without --recheck to capture it.' });
              table.push(`${label.padEnd(44)} NOT CAPTURED`);
              continue;
            }
            const check = runScript('check-parity.mjs', [root, '--run', dir, ...shared]);
            if (check.status === 2) fail(`check-parity.mjs stopped on ${label}: ${check.error}`, check.errorFix ?? 'Fix the input it names, then run again.');
            relay(check);
            const sheet = runScript('make-sheet.mjs', [root, '--run', dir, ...shared]);
            if (sheet.status !== 0) relay(sheet);
            else sheets.push(show(join(dir, 'sheet.png')));
            const first = check.problems[0];
            table.push(`${label.padEnd(44)} ${check.status === 0 ? 'PASS' : `FAIL ${check.problems.length} (first: [${first?.rule}] ${first?.message.slice(0, 70) ?? ''})`}`);
          }
        }
      }
    }
  } finally {
    if (regionCacheDir) removeTempDir(regionCacheDir);
  }
  for (const line of table) report.note(line);
  if (sheets.length) {
    report.note('Look at every sheet (sheet.png, zoom-*.png, eye-*.png, crops/) before signing off:');
    for (const s of sheets) report.note(`  ${s}`);
  }
  return report.finish({ checked: runs, unit: 'runs' });
});
