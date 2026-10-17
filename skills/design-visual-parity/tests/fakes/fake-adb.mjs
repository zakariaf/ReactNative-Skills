#!/usr/bin/env node
// Fake "adb" for the self-test: one running emulator (emulator-5580, AVD tasks-parity) unless
// scenario.json says otherwise. "-s <serial>" must come before every device command (the real adb
// would pick "the only device" otherwise). The launch link's nonce goes to $FAKE_PARITY_STATE.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scenario = existsSync('scenario.json') ? JSON.parse(readFileSync('scenario.json', 'utf8')) : {};
const s = { serial: 'emulator-5580', avd: 'tasks-parity', size: 'Physical size: 1080x2400', density: 'Physical density: 480', night: 'Night mode: no', fontScale: '1.0', demo: '1', booted: '1', navigation: 'gestural', screenshots: ['fake/screen.png'], ...scenario.adb };
const args = process.argv.slice(2);
const done = (text = '', code = 0) => {
  process.stdout.write(text);
  process.exit(code);
};
if (args[0] === 'devices') done(`List of devices attached\n${s.running === false ? '' : `${s.serial}\tdevice\n`}`);
if (args[0] !== '-s' || args[1] !== s.serial) done(`adb: device '${args[1] ?? ''}' not found (fake adb wants -s ${s.serial} first)\n`, 1);
const [cmd, ...rest] = args.slice(2);
const line = rest.join(' ');
if (cmd === 'emu' && line === 'avd name') done(`${s.avd}\nOK\n`);
if (cmd === 'exec-out' && line === 'screencap -p') {
  const counter = resolve('.fake-screencap-count');
  const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
  writeFileSync(counter, String(n + 1));
  process.stdout.write(readFileSync(resolve(s.screenshots[Math.min(n, s.screenshots.length - 1)])));
  process.exit(0);
}
if (cmd === 'shell') {
  if (line === 'getprop sys.boot_completed') done(`${s.booted}\n`);
  if (line === 'wm size') done(`${s.size}\n`);
  if (line === 'wm density') done(`${s.density}\n`);
  if (line === 'cmd uimode night') done(`${s.night}\n`);
  if (line === 'settings get system font_scale') done(`${s.fontScale}\n`);
  if (line === 'settings get global sysui_demo_allowed') done(`${s.demo}\n`);
  if (line === 'cmd overlay list') {
    const mark = (mode) => `[${s.navigation === mode ? 'x' : ' '}] com.android.internal.systemui.navbar.${mode}`;
    done(`android\n${['gestural', 'threebutton'].map(mark).join('\n')}\n`);
  }
  if (/^cmd overlay enable-exclusive --category com\.android\.internal\.systemui\.navbar\.\w+$/.test(line)) done('');
  if (/^am start /.test(line)) {
    const url = /-d "([^"]+)"/.exec(line)?.[1] ?? '';
    const query = url.split('?')[1] ?? '';
    const nonce = new URLSearchParams(query).get('nonce');
    if (process.env.FAKE_PARITY_STATE && nonce) writeFileSync(process.env.FAKE_PARITY_STATE, JSON.stringify({ nonce, query }));
    done('Starting: Intent { act=android.intent.action.VIEW }\nStatus: ok\n');
  }
  done('');
}
done(`fake adb: unhandled ${args.join(' ')}\n`, 1);
