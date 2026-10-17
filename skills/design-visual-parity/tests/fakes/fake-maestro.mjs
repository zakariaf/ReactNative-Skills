#!/usr/bin/env node
// Fake "maestro --device <id> --driver-host-port <port> hierarchy" for the self-test: prints
// scenario.hierarchy (a JSON file relative to the fixture folder, default fake/hier.json) after a line
// of noise, as the real CLI may, with the marker parity.launch.<nonce> of the last launch added (the
// fake xcrun and fake adb write the nonce to $FAKE_PARITY_STATE), as the app's parity root renders it.
// In a probe launch (probe=<region> in the query) it prints scenario.probeHierarchy instead.
// scenario.omitNonce leaves the marker out; scenario.omitNonceDumps: n leaves it out of the first n
// dumps of each launch only (a driver answering before the app's tree is attached). Without --device
// and --driver-host-port before the command (on iOS and Android alike) it answers as another
// session's driver on the default port would: with no marker.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const scenario = existsSync('scenario.json') ? JSON.parse(readFileSync('scenario.json', 'utf8')) : {};
const argv = process.argv.slice(2);
const command = argv.findIndex((a) => a === 'hierarchy');
if (command === -1) process.exit(64);
const globals = argv.slice(0, command);
const named = globals.includes('--device') && /^\d+$/.test(globals[globals.indexOf('--driver-host-port') + 1] ?? '');
const state = process.env.FAKE_PARITY_STATE && existsSync(process.env.FAKE_PARITY_STATE) ? JSON.parse(readFileSync(process.env.FAKE_PARITY_STATE, 'utf8')) : null;
const isProbe = state?.query ? new URLSearchParams(state.query).has('probe') : false;
const json = JSON.parse(readFileSync(isProbe ? (scenario.probeHierarchy ?? 'fake/probe.json') : (scenario.hierarchy ?? 'fake/hier.json'), 'utf8'));
let isEarlyDump = false;
if (scenario.omitNonceDumps && process.env.FAKE_PARITY_STATE && state?.nonce) {
  const countPath = `${process.env.FAKE_PARITY_STATE}.dumps.json`;
  const counts = existsSync(countPath) ? JSON.parse(readFileSync(countPath, 'utf8')) : {};
  counts[state.nonce] = (counts[state.nonce] ?? 0) + 1;
  writeFileSync(countPath, JSON.stringify(counts));
  isEarlyDump = counts[state.nonce] <= scenario.omitNonceDumps;
}
if (named && !scenario.omitNonce && !isEarlyDump && state?.nonce) {
  json.children = [...(json.children ?? []), { attributes: { accessibilityText: state.nonce, 'resource-id': `parity.launch.${state.nonce}`, bounds: '[0,0][1,1]' }, children: [] }];
}
process.stdout.write(`Running on the parity device\n${JSON.stringify(json, null, 1)}`);
