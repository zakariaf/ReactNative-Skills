// device-safety.mjs: the device rules for repo tooling (a helper, not an entry point). Several
// sessions, agents and CI jobs share one Mac, so a command that picks "the booted simulator", "all
// simulators" or "the only device" can reach someone else's. Xcode is selected per process, never
// switched for the whole Mac.
//
//   deviceSafetyProblems(files, { prefix }) over [{ rel, code, shell, line? }] (code with comments
//   masked; shell: a .sh file or an npm script, line: a fixed line for the whole entry) returns
//   [{ file, line, rule, message, fix }] for the rules:
//     no-xcode-select  xcode-select -s/--switch, and sudo, anywhere in tooling
//     sim-safety       simctl targeting booted or all; simctl targeting a device by a literal name instead of
//                      a UDID or a variable; a simulator created with a name outside <prefix>-*; an
//                      xcodebuild -destination that is neither id=<udid> nor generic/platform=...; an iOS
//                      eas build:run without --simulator
//     maestro-device   (shell text, npm scripts and JS/TS command strings; maestro-spawns.mjs covers JS/TS
//                      argument-list spawns) a maestro command without --device and --driver-host-port
//                      before it, or a literal port
//   In JS/TS, a string or template literal that starts with xcrun, simctl, maestro or eas (a whole command
//   line, as execSync takes it) is also read as shell text for the by-name, maestro and eas rules.
//     adb-device       adb without -s <serial> before a device command (or -e/-d); emulator without -avd
//   Limits (text heuristics): a value built in a variable or in another module is not judged, and a
//   command split across lines with backslashes is read line by line.
//   ADB_HELPERS        the device-binding helpers an adb argument list may start with (...adbArgs(serial))

export const ADB_HELPERS = Object.freeze(['adbArgs', 'adbDeviceArgs', 'deviceArgs']);

const ADB_DEVICE_COMMANDS = ['shell', 'install', 'install-multiple', 'uninstall', 'push', 'pull', 'logcat', 'reverse', 'forward', 'emu', 'reboot', 'root', 'unroot', 'remount', 'wait-for-device', 'exec-out', 'bugreport', 'sideload', 'get-state', 'get-serialno', 'jdwp', 'sync', 'tcpip', 'usb'];
const EMULATOR_INFO_FLAGS = ['-list-avds', '-version', '-help', '-accel-check'];

/** simctl commands whose first argument (after options) is the device. */
const SIMCTL_DEVICE_COMMANDS = ['boot', 'bootstatus', 'shutdown', 'erase', 'delete', 'install', 'uninstall', 'launch', 'terminate', 'io', 'openurl', 'spawn', 'get_app_container', 'listapps', 'appinfo', 'privacy', 'push', 'status_bar', 'ui', 'addmedia', 'keychain', 'location', 'pbcopy', 'pbpaste', 'clone', 'rename', 'diagnose'];
const SIMCTL_KEYWORDS = ['booted', 'all', 'unavailable'];
const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const MAESTRO_COMMANDS = ['test', 'hierarchy', 'record', 'start-device', 'studio', 'mcp', 'cloud', 'download-samples', 'login'];
const MAESTRO_NO_DEVICE = ['--version', '-v', 'check-syntax', '--help', '-h'];

const XCODE_SELECT_FIX = 'Select Xcode per process with DEVELOPER_DIR (selectXcode() in scripts/ios/toolchain.ts): xcode-select needs sudo and switches every build on the Mac.';
const SUDO_FIX = 'Tooling never needs sudo: installing Xcode and accepting its licence are human steps the developer does once.';
const ALL_FIX = 'Target one of your own <prefix>-<purpose> simulators by UDID (shutdownOwnSimulator / deleteOwnSimulator): other sessions use the other simulators on this Mac.';
const BOOTED_FIX = 'Pass the UDID ensureSimulator() returned: "booted" picks whichever simulator another session booted.';

function lineAt(code, index) {
  return code.slice(0, index).split('\n').length;
}

function scan(file, pattern, visit) {
  for (const match of file.code.matchAll(pattern)) {
    // A pattern may start at the separator before the command (a newline, ';', '|'): skip it.
    const lead = /^[\s;&|(/]*/.exec(match[0])[0].length;
    visit(match, file.line ?? lineAt(file.code, match.index + lead));
  }
}

function xcodeSelect(file, add) {
  const switches = file.shell ? /\bxcode-select\s+(?:-s|--switch)\b/g : /(['"`])xcode-select\1\s*,\s*\[\s*(['"`])(?:-s|--switch)\2|(['"`])xcode-select\s+(?:-s|--switch)\b/g;
  scan(file, switches, (match, line) => add(line, 'no-xcode-select', 'switches the global Xcode with xcode-select', XCODE_SELECT_FIX));
  const sudo = file.shell ? /(?:^|[\s;&|(])sudo\s/g : /(['"`])sudo(?:\1|\s)/g;
  scan(file, sudo, (match, line) => add(line, 'no-xcode-select', 'runs sudo', SUDO_FIX));
}

/** A device argument that names a simulator: neither a UDID, a variable, nor a keyword other rules judge. */
function isDeviceName(value) {
  return value !== '' && !UDID.test(value) && !value.startsWith('$') && !SIMCTL_KEYWORDS.includes(value);
}

function simctlByName(file, add) {
  const commands = SIMCTL_DEVICE_COMMANDS.join('|');
  const options = String.raw`(?:-{1,2}[\w-]+(?:=\S+)?\s+)*`;
  const pattern = file.shell
    ? new RegExp(String.raw`\bsimctl\s+(${commands})\s+${options}(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'\x60;&|)]+))`, 'g')
    : new RegExp(String.raw`(?:(['"\x60])simctl\1\s*,\s*|simctl\(\s*\[\s*)(['"\x60])(${commands})\2\s*,\s*(['"\x60])([^'"\x60\n]*)\4`, 'g');
  scan(file, pattern, (match, line) => {
    const command = file.shell ? match[1] : match[3];
    const device = file.shell ? (match[2] ?? match[3] ?? match[4]) : match[5];
    // An option first ('--terminate-running-process', udid) or a template literal is not judged.
    if (!isDeviceName(device) || device.startsWith('${') || device.startsWith('-')) return;
    add(line, 'sim-safety', `simctl ${command} targets the simulator named "${device}" instead of a UDID`, 'Pass the UDID ensureSimulator() returned (or a variable holding it): simctl resolves a name to any simulator with that name, and on a shared Mac it may be another session\'s.');
  });
}

/** A -destination value that selects one simulator by UDID, or a generic (build-only) destination. */
function isSafeDestination(value) {
  if (value.startsWith('$') || /^generic\/platform=/.test(value)) return true;
  return value.split(',').some((part) => /^id=\S/.test(part.trim()));
}

function destination(file, add) {
  const fix = "Pass -destination id=<udid> with the UDID ensureSimulator() returned (xcodebuildSimArgs in scripts/build/sim-build-plan.ts), or generic/platform=iOS Simulator for a build that runs nowhere: a name or OS picks whichever simulator matches, another session's included.";
  const report = (value, line) => {
    if (!isSafeDestination(value)) add(line, 'sim-safety', `xcodebuild -destination "${value}" does not select a simulator by UDID`, fix);
  };
  // Inline text (a .sh file, an npm script, or a whole command line inside a code string).
  // ([n] keeps the repo's own docs lint from reading these patterns as xcodebuild calls.)
  scan(file, /-destinatio[n][ \t]+(?:\\?"([^"\\\n]*)\\?"|'([^'\n]*)'|([^\s"'\x60;&|)]+))/g, (match, line) => report(match[1] ?? match[2] ?? match[3], line));
  if (file.shell) return;
  // An argument list: '-destination', '<literal>' (a template literal starting with ${ is a variable).
  scan(file, /(['"\x60])-destinatio[n]\1\s*,\s*(['"\x60])([^'"\x60\n]*)\2/g, (match, line) => {
    if (!match[3].startsWith('${')) report(match[3], line);
  });
}

function maestroShell(file, add) {
  const fix = 'Run Maestro through the repo\'s runner, which starts the arguments with maestroGlobalArgs({ udid, driverPort }) from scripts/e2e/maestro-args.ts (a free port per run), or write maestro --device "$UDID" --driver-host-port "$PORT" <command> with both from variables.';
  scan(file, /(?:^|[\s;&|(/])maestro[ \t]+([^\n;&|]*)/g, (match, line) => {
    const words = match[1].trim().split(/\s+/);
    const at = words.findIndex((word) => MAESTRO_COMMANDS.includes(word) || MAESTRO_NO_DEVICE.includes(word));
    if (at < 0 || MAESTRO_NO_DEVICE.includes(words[at])) return;
    const globals = words.slice(0, at);
    const missing = ['--device', '--driver-host-port'].filter((flag) => !globals.some((word) => word === flag || word.startsWith(`${flag}=`)));
    if (missing.length > 0) add(line, 'maestro-device', `maestro ${words[at]} runs without ${missing.join(' and ')} before the command`, fix);
    const port = globals.join(' ').match(/--driver-host-port(?:=|\s+)["']?(\d+)/);
    if (port) add(line, 'maestro-device', `maestro uses the fixed driver port ${port[1]}, which a second run on this Mac shares`, fix);
  });
}

/** eas build:run for iOS without --simulator installs on the first booted simulator, another session's included. */
function easRun(file, add) {
  scan(file, /(?:^|[\s;&|(/])eas[ \t]+build:run\b([^\n;&|]*)/g, (match, line) => {
    const rest = ` ${match[1]} `;
    if (/\s--simulator(?:\s|=)/.test(rest) || /\s(?:-p|--platform)(?:\s+|=)["']?android\b/.test(rest)) return;
    add(line, 'sim-safety', 'eas build:run installs on the first booted simulator (no --simulator <udid>)', 'Pass --simulator <udid> with the UDID ensureSimulator() returned (eas-and-android reference); the first booted simulator may be another session\'s.');
  });
}

/**
 * Whole command lines held in one JS/TS string or template literal (execSync('xcrun simctl boot ...')),
 * as shell files: { rel, code, shell: true, base } where base is the line the literal starts on.
 */
function commandStrings(file) {
  const out = [];
  const pattern = /(['"])((?:xcrun\s+)?(?:simctl|maestro|eas)\s(?:\\.|(?!\1)[^\\\n])*)\1|`((?:xcrun\s+)?(?:simctl|maestro|eas)\s[^`]*)`/g;
  for (const match of file.code.matchAll(pattern)) {
    out.push({ rel: file.rel, code: match[2] ?? match[3], shell: true, base: file.line ?? lineAt(file.code, match.index) });
  }
  return out;
}

function simctl(file, add, prefix) {
  const all = file.shell ? /\bsimctl\s+(?:shutdown|erase|delete)\s+all\b/g : /(['"`])(?:shutdown|erase|delete)\1\s*,\s*(['"`])all\2|simctl\s+(?:shutdown|erase|delete)\s+all\b/g;
  scan(file, all, (match, line) => add(line, 'sim-safety', 'shuts down, erases or deletes all simulators', ALL_FIX));
  const booted = file.shell ? /\bsimctl\b[^\n]*?\bbooted\b/g : /(['"`])booted\1|simctl\s+[a-z_]+\s+booted\b/g;
  scan(file, booted, (match, line) => add(line, 'sim-safety', 'targets the "booted" simulator instead of a UDID', BOOTED_FIX));
  const create = file.shell ? /\bsimctl\s+create\s+(?:"([^"]+)"|'([^']+)'|([^\s"'`]+))/g : /(?:(['"`])simctl\1\s*,\s*|simctl\(\s*\[\s*)(['"`])create\2\s*,\s*(['"`])([^'"`]+)\3|simctl\s+create\s+(?:"([^"]+)"|'([^']+)')/g;
  scan(file, create, (match, line) => {
    const name = file.shell ? (match[1] ?? match[2] ?? match[3]) : (match[4] ?? match[5] ?? match[6]);
    // A variable ($NAME, ${name}) cannot be judged here; simulatorName() guards the TypeScript path.
    if (name.startsWith('$') || name.startsWith(`${prefix}-`)) return;
    add(line, 'sim-safety', `creates a simulator named "${name}", outside ${prefix}-*`, `Name every simulator ${prefix}-<purpose> through simulatorName(): only prefixed simulators are ever shut down or deleted, so cleanup never touches another session's device.`);
  });
}

function adbToken(token, line, add) {
  if (token === '-e' || token === '-d') add(line, 'adb-device', `adb ${token} picks "the only ${token === '-e' ? 'emulator' : 'device'}"`, 'Pass -s <serial> (adb devices lists them; an emulator you started is emulator-<port>).');
  else if (ADB_DEVICE_COMMANDS.includes(token)) add(line, 'adb-device', `adb ${token} runs without -s <serial> before the command`, 'Write adb -s <serial> <command>: without it adb fails with several devices attached, or reaches the one another session started.');
}

function adbShell(file, add) {
  scan(file, /\badb\s+(-[a-zA-Z]+\b|[a-z][a-z-]*)/g, (match, line) => adbToken(match[1], line, add));
  scan(file, /(?:^|[\s;&|(/])emulator["']?\s+(-[\w-]+)[^\n]*/g, (match, line) => {
    if (!EMULATOR_INFO_FLAGS.includes(match[1]) && !/\s-avd\s/.test(` ${match[0]} `)) add(line, 'adb-device', 'launches an emulator without -avd <name>', 'Launch emulators by AVD name (emulator -avd <project>-<purpose>), then address them by their serial.');
  });
}

function adbCode(file, add) {
  // A whole adb command line inside one string, as execSync takes it.
  scan(file, /(['"`])adb\s+(-[a-zA-Z]+\b|[a-z][a-z-]*)/g, (match, line) => adbToken(match[2], line, add));
  scan(file, /(['"`])adb\1\s*,\s*\[\s*([^\]\n]*)/g, (match, line) => {
    const first = match[2].trim();
    const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(first);
    if (spread && ADB_HELPERS.includes(spread[1])) return;
    const literal = /^(['"`])([^'"`]+)\1/.exec(first)?.[2];
    if (literal === '-s') return;
    if (literal === '-e' || literal === '-d' || ADB_DEVICE_COMMANDS.includes(literal ?? '') || spread) {
      add(line, 'adb-device', `adb ${literal ?? first.slice(0, 30)} runs without -s <serial> before the command`, `Start the arguments with '-s', serial (or ...${ADB_HELPERS[0]}(serial)).`);
    }
  });
  scan(file, /(['"`])(?:[^'"`\n]*\/)?emulator\1\s*,\s*\[([^\]]*)\]/g, (match, line) => {
    if (!/['"`]-avd['"`]/.test(match[2]) && !EMULATOR_INFO_FLAGS.some((flag) => match[2].includes(`'${flag}'`))) add(line, 'adb-device', 'launches an emulator without -avd <name>', "Pass '-avd', '<project>-<purpose>' and address the emulator by its serial afterwards.");
  });
}

/** Every device-safety problem in the tooling files. */
export function deviceSafetyProblems(files, { prefix }) {
  const problems = [];
  for (const file of files) {
    const add = (line, rule, message, fix) => problems.push({ file: file.rel, line, rule, message, fix });
    xcodeSelect(file, add);
    simctl(file, add, prefix);
    simctlByName(file, add);
    destination(file, add);
    if (file.shell) {
      maestroShell(file, add);
      easRun(file, add);
      adbShell(file, add);
      continue;
    }
    adbCode(file, add);
    for (const command of commandStrings(file)) {
      const at = (line, ...rest) => add(command.base + line - 1, ...rest);
      simctlByName(command, at);
      maestroShell(command, at);
      easRun(command, at);
    }
  }
  return problems;
}
