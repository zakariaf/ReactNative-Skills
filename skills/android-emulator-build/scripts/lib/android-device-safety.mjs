// android-device-safety.mjs: the Android device and shared-machine rules for repo tooling (a helper,
// not an entry point). Several sessions, agents and CI jobs share one machine and one adb server, so
// a command that picks "the only emulator", restarts the adb server, stops every Gradle daemon or
// starts an AVD another session owns reaches someone else's work. The JDK is selected per process,
// never switched for the whole machine, and licences are accepted by a person.
//
//   androidSafetyProblems(files, { prefix }) over [{ rel, code, shell, line? }] (code with comments
//   masked; shell: a .sh file or an npm script; line: a fixed line for the whole entry) returns
//   [{ file, line, rule, message, fix }] for the rules:
//     adb-device        adb without -s <serial> before a device command, adb -e / -d, and
//                       eas build:run for Android (it installs on the first running emulator)
//     emulator-avd      an emulator launch without -avd <name>, or a literal AVD name outside <prefix>-*
//                       in emulator -avd / @name, avdmanager create|delete avd -n
//     shared-machine    adb kill-server, adb disconnect without a serial, gradlew --stop, Gradle install*
//                       tasks (they install on every connected device), pkill/killall of emulators, adb,
//                       Java or Gradle
//     no-global-switch  sudo, jenv global, sdk default java, update-alternatives for java, sdkmanager --licenses
//   In JS/TS: argument lists ('adb', [...], adbPath, [...], adb([...]); 'emulator', [...]; 'create', 'avd', ...;
//   './gradlew', [...] or { file: './gradlew', args: [...] } with an install task; 'pkill' / 'killall', [...];
//   '--stop' near "gradle"), and whole command lines in one string or template literal that starts with
//   adb, emulator, avdmanager, sdkmanager, gradlew, eas, sudo, pkill, killall or jenv.
//   Limits (text heuristics): a value built in a variable or another module is not judged, and a shell
//   command split across lines with backslashes is read line by line.
//   ADB_HELPERS   the device-binding helpers an adb argument list may start with (...adbArgs(serial))

export const ADB_HELPERS = Object.freeze(['adbArgs', 'adbDeviceArgs', 'deviceArgs']);

export const ADB_DEVICE_COMMANDS = Object.freeze(['shell', 'install', 'install-multiple', 'uninstall', 'push', 'pull', 'logcat', 'reverse', 'forward', 'emu', 'reboot', 'root', 'unroot', 'remount', 'wait-for-device', 'exec-out', 'bugreport', 'sideload', 'get-state', 'get-serialno', 'jdwp', 'sync', 'tcpip', 'usb']);
const EMULATOR_INFO_FLAGS = ['-list-avds', '-version', '-help', '-accel-check', '-help-all'];
const KILLED_PROCESSES = /\b(?:pkill|killall)\b[^\n;&|]*\b(?:emulator|qemu-system[\w-]*|adb|java|gradle|GradleDaemon|kotlin[\w-]*)\b/g;

const SERIAL_FIX = 'Write adb -s <serial> <command> (in code: adbArgs(serial, ...) from scripts/android/adb-args.ts): without it adb fails with two devices attached, or reaches the device another session started.';
const LAUNCH_FIX = 'Launch emulators by AVD name, emulator -avd <prefix>-<purpose> -port <even port> (emulatorArgs() in scripts/android/emulators.ts), then address them by their serial emulator-<port>.';

function lineAt(code, index) {
  return code.slice(0, index).split('\n').length;
}

function scan(file, pattern, visit) {
  for (const match of file.code.matchAll(pattern)) {
    const lead = /^[\s;&|(/'"`]*/.exec(match[0])[0].length;
    visit(match, file.line ?? lineAt(file.code, match.index + lead));
  }
}

function isOwnName(name, prefix) {
  return name.startsWith('$') || name.startsWith('${') || name.startsWith(`${prefix}-`);
}

function adbToken(token, line, add) {
  if (token === '-e' || token === '-d') add(line, 'adb-device', `adb ${token} picks "the only ${token === '-e' ? 'emulator' : 'device'}"`, SERIAL_FIX);
  else if (ADB_DEVICE_COMMANDS.includes(token)) add(line, 'adb-device', `adb ${token} runs without -s <serial> before the command`, SERIAL_FIX);
}

function sharedShell(file, add) {
  scan(file, /\badb\s+kill-server\b/g, (match, line) => add(line, 'shared-machine', 'restarts the adb server, which every session on this machine shares (their devices drop)', 'Never restart the shared adb server from tooling; reconnect only your own device with adb -s <serial> reconnect.'));
  scan(file, /\badb\s+disconnect\s*(?:$|[;&|)\n])/gm, (match, line) => add(line, 'shared-machine', 'adb disconnect without a serial drops every network device of every session', 'Disconnect only your own device: adb disconnect <host:port>.'));
  scan(file, /\bgradlew?(?:\.bat)?\b[^\n;&|]*\s--stop\b/g, (match, line) => add(line, 'shared-machine', 'gradlew --stop stops every Gradle daemon of this Gradle version, other sessions\' builds included', 'Run the build with --no-daemon (gradleReleaseArgs) instead of stopping daemons afterwards.'));
  scan(file, /\bgradlew?(?:\.bat)?\b[^\n;&|]*\s:?(?:app:)?install[A-Z]\w*/g, (match, line) => add(line, 'shared-machine', 'a Gradle install task installs on every connected device and emulator, other sessions\' included', 'Build with :app:assembleRelease, then install on your own emulator: adb -s <serial> install <apk>.'));
  scan(file, KILLED_PROCESSES, (match, line) => add(line, 'shared-machine', 'kills emulators, adb, Java or Gradle by name, other sessions\' included', 'Stop only your own emulator with adb -s <serial> emu kill (stopOwnEmulator).'));
}

function globalShell(file, add) {
  const sudo = file.shell ? /(?:^|[\s;&|(])sudo\s/g : /(['"`])sudo(?:\1|\s)/g;
  scan(file, sudo, (match, line) => add(line, 'no-global-switch', 'runs sudo', 'Tooling never needs sudo: installing a JDK or the Android SDK and accepting licences are human steps the developer does once.'));
  scan(file, /\b(?:jenv\s+global|sdk\s+default\s+java|update-alternatives\s+--(?:set|config)\s+java)\b/g, (match, line) => add(line, 'no-global-switch', 'switches the JDK for the whole machine', 'Select JDK 17 per process: JAVA_HOME on the child environment from selectToolchain() in scripts/android/toolchain.ts.'));
  scan(file, /\bsdkmanager\b[^\n;&|]*--licenses\b|(['"`])--licenses\1/g, (match, line) => add(line, 'no-global-switch', 'accepts the Android SDK licences from tooling', 'Accepting a licence is a legal agreement the developer makes once (sdkmanager --licenses in their own terminal, or the SDK Manager); tooling stops and asks.'));
}

function emulatorShell(file, add, prefix) {
  scan(file, /(?:^|[\s;&|(/])emulator["']?\s+([-@][^\n;&|]*)/g, (match, line) => {
    const words = match[1].trim().split(/\s+/);
    if (EMULATOR_INFO_FLAGS.includes(words[0])) return;
    const at = words.indexOf('-avd');
    const name = words[0].startsWith('@') ? words[0].slice(1) : (at >= 0 ? words[at + 1] ?? '' : null);
    if (name === null) add(line, 'emulator-avd', 'launches an emulator without -avd <name>', LAUNCH_FIX);
    else if (!isOwnName(name.replace(/^["']|["']$/g, ''), prefix)) add(line, 'emulator-avd', `launches the AVD "${name}", outside ${prefix}-*`, `Create and launch only ${prefix}-<purpose> AVDs (avdName()): another session may be running "${name}".`);
  });
  scan(file, /\bavdmanager\b[^\n;&|]*\b(create|delete)\s+avd\b[^\n;&|]*?\s(?:-n|--name)\s+["']?([^\s"';&|]+)/g, (match, line) => {
    if (!isOwnName(match[2], prefix)) add(line, 'emulator-avd', `avdmanager ${match[1]}s the AVD "${match[2]}", outside ${prefix}-*`, `Name every AVD ${prefix}-<purpose> through avdName(): only prefixed AVDs are ever created or deleted, so cleanup never touches another session's emulator.`);
  });
}

function easRun(file, add) {
  scan(file, /(?:^|[\s;&|(/])eas[ \t]+build:run\b([^\n;&|]*)/g, (match, line) => {
    if (/\s(?:-p|--platform)(?:\s+|=)["']?android\b/.test(` ${match[1]} `)) add(line, 'adb-device', 'eas build:run -p android installs on the first running emulator, which may be another session\'s', 'Download or build the APK (eas build --local --output <file>), then install it on your own emulator: adb -s <serial> install <apk> (references/eas-and-ios.md).');
  });
}

function shellRules(file, add, prefix) {
  scan(file, /\badb\s+(-[a-zA-Z]+\b|[a-z][a-z-]*)/g, (match, line) => adbToken(match[1], line, add));
  emulatorShell(file, add, prefix);
  sharedShell(file, add);
  easRun(file, add);
}

function adbListFirst(first) {
  const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(first);
  if (spread && ADB_HELPERS.includes(spread[1])) return null;
  return /^(['"`])([^'"`]+)\1/.exec(first)?.[2] ?? null;
}

function codeRules(file, add, prefix) {
  // An argument list for adb: 'adb', [...], adbPath, [...], ADB, [...], or a runner adb([...]).
  scan(file, /(?:(['"`])adb\1|\b[\w.]*(?:[aA]db|ADB)(?:Path|Bin|Binary|Exe|_PATH|_BIN)?)\s*(?:,\s*|\(\s*)\[\s*([^\]\n]*)/g, (match, line) => {
    const literal = adbListFirst(match[2].trim());
    if (literal === '-e' || literal === '-d' || ADB_DEVICE_COMMANDS.includes(literal ?? '')) add(line, 'adb-device', `adb ${literal} runs without -s <serial> before the command`, `Start the arguments with '-s', serial (or adbArgs(serial, ...) from scripts/android/adb-args.ts).`);
    if (literal === 'kill-server') add(line, 'shared-machine', 'restarts the adb server, which every session on this machine shares', 'Never restart the shared adb server from tooling.');
  });
  scan(file, /(?:(['"`])(?:[^'"`\n]*\/)?emulator\1|\b[\w.]*[eE]mulator(?:Path|Bin|Binary)\b)\s*,\s*\[([^\]]*)\]/g, (match, line) => {
    const list = match[2];
    if (EMULATOR_INFO_FLAGS.some((flag) => new RegExp(`['"\`]${flag}['"\`]`).test(list))) return;
    const name = /(['"`])-avd\1\s*,\s*(['"`])([^'"`]+)\2/.exec(list)?.[3];
    if (!/['"`]-avd['"`]/.test(list)) add(line, 'emulator-avd', 'launches an emulator without -avd <name>', LAUNCH_FIX);
    else if (name !== undefined && !isOwnName(name, prefix)) add(line, 'emulator-avd', `launches the AVD "${name}", outside ${prefix}-*`, `Launch only ${prefix}-<purpose> AVDs (avdName()).`);
  });
  scan(file, /(['"`])(create|delete)\1\s*,\s*(['"`])avd\3([^\]\n]*)/g, (match, line) => {
    const name = /(['"`])(?:-n|--name)\1\s*,\s*(['"`])([^'"`]+)\2/.exec(match[4])?.[3];
    if (name !== undefined && !isOwnName(name, prefix)) add(line, 'emulator-avd', `avdmanager ${match[2]}s the AVD "${name}", outside ${prefix}-*`, `Name every AVD ${prefix}-<purpose> through avdName().`);
  });
  // A Gradle argument list ('./gradlew', [...] or { file: './gradlew', args: [...] }) naming an install task.
  scan(file, /(['"`])(?:[^'"`\n]*\/)?gradlew(?:\.bat)?\1\s*,\s*(?:args\s*:\s*)?\[([^\]]*)\]/g, (match, line) => {
    const task = /(['"`])((?:[\w-]*:)*install[A-Z]\w*)\1/.exec(match[2])?.[2];
    if (task !== undefined) add(line, 'shared-machine', `the Gradle task ${task} installs on every connected device and emulator, other sessions' included`, 'Build with :app:assembleRelease (gradleReleaseArgs), then install on your own emulator: adb -s <serial> install <apk>.');
  });
  // pkill / killall as an argument list ('pkill', ['-f', 'qemu-system']).
  scan(file, /(['"`])(pkill|killall)\1\s*,\s*\[([^\]]*)\]/g, (match, line) => {
    if (/\b(?:emulator|qemu-system[\w-]*|adb|java|gradle|GradleDaemon|kotlin[\w-]*)\b/.test(match[3])) add(line, 'shared-machine', `${match[2]} kills emulators, adb, Java or Gradle by name, other sessions' included`, 'Stop only your own emulator with adb -s <serial> emu kill (stopOwnEmulator).');
  });
  scan(file, /(['"`])--stop\1/g, (match, line) => {
    if (/gradle/i.test(file.code.slice(Math.max(0, match.index - 200), match.index))) add(line, 'shared-machine', 'gradlew --stop stops every Gradle daemon of this Gradle version, other sessions\' included', 'Run the build with --no-daemon (gradleReleaseArgs) instead.');
  });
}

/** Whole command lines inside one JS/TS string or template literal, read like shell text. */
function commandStrings(file) {
  const out = [];
  const head = String.raw`(?:\.\/)?(?:adb|emulator|avdmanager|sdkmanager|gradlew|eas|sudo|pkill|killall|jenv)\s`;
  const pattern = new RegExp(String.raw`(['"])(${head}(?:\\.|(?!\1)[^\\\n])*)\1|\x60(${head}[^\x60]*)\x60`, 'g');
  for (const match of file.code.matchAll(pattern)) out.push({ rel: file.rel, code: match[2] ?? match[3], shell: true, base: file.line ?? lineAt(file.code, match.index) });
  return out;
}

/** Every Android device-safety problem in the tooling files. */
export function androidSafetyProblems(files, { prefix }) {
  const problems = [];
  for (const file of files) {
    const add = (line, rule, message, fix) => {
      if (!problems.some((found) => found.file === file.rel && found.line === line && found.rule === rule && found.message === message)) problems.push({ file: file.rel, line, rule, message, fix });
    };
    globalShell(file, add);
    if (file.shell) {
      shellRules(file, add, prefix);
      continue;
    }
    codeRules(file, add, prefix);
    for (const command of commandStrings(file)) {
      const at = (line, ...rest) => add(command.base + line - 1, ...rest);
      shellRules(command, at, prefix);
      globalShell(command, at);
    }
  }
  return problems;
}
