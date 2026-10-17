// maestro-spawns.mjs: the maestro-device rule for repo tooling (a helper, not an entry point).
//
// One machine often runs several simulators (parallel CI jobs, several agent sessions). A Maestro run
// that does not name its device drives whichever simulator answers first, and on iOS the XCTest driver
// listens on a fixed default port (7001), so two runs on one Mac also share a driver unless each picks
// its own port. So every spawn of the Maestro binary in repo tooling starts its arguments with the
// global flags, before the command:
//   maestro --device <udid> --driver-host-port <port> test ...
// either written out, or built by a device-binding helper (default name maestroGlobalArgs, for
// example maestroGlobalArgs({ udid, driverPort })) whose port comes from a free-port lookup per run.
// Maestro's per-command --udid is not enough (it leaves the driver port shared).
//
// maestroSpawnProblems(files, options) takes [{ rel, code }] (code with comments masked, strings
// kept) for every non-test tooling source and returns [{ file, line, message, fix }]:
//   - a spawn of the binary whose arguments (inline, through one const, or through one tooling
//     function that builds them) neither call a device-binding helper nor put '--device' (and, unless
//     requireDriverPort is false, '--driver-host-port') before the command;
//   - Maestro's per-command '--udid' anywhere in the tooling;
//   - a fixed driver port ('--driver-host-port', '7001' or driverPort: 7001).
// The binary: a path ending in maestro/bin/maestro (or join(..., '.maestro', 'bin', 'maestro')), a
// const bound to one, or the bare command 'maestro' on PATH. A spawn whose command is --version or
// check-syntax needs no device and is left alone.
// options: { helpers: ['maestroGlobalArgs'] (device-binding helper names), requireDriverPort: true,
//            fix: '<the fix text a problem names>' }
//
// Changed from the older copy: the helper names and the fix text are options (no fixed tooling path),
// and the bare 'maestro' command and the default install (~/.maestro/bin/maestro) are recognised.

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
/** join(..., 'maestro' or '.maestro', 'bin', 'maestro') or a path string ending in maestro/bin/maestro. */
const BINARY_VALUE = String.raw`(?:join\([^)]*['"]\.?maestro['"]\s*,\s*['"]bin['"]\s*,\s*['"]maestro['"]\s*\)|['"\`][^'"\`\n]*maestro/bin/maestro['"\`])`;
const BINDING = new RegExp(String.raw`(?:export\s+)?(?:const|let)\s+(${IDENT})\s*=\s*${BINARY_VALUE}`, 'g');
const SPAWNERS = String.raw`(?:spawnSync|spawn|execFileSync|execFile|execa|execaSync)`;
const COMMANDS = ['test', 'hierarchy', 'record', 'start-device', 'studio', 'mcp', 'download-samples', 'cloud', 'login'];
const NO_DEVICE = /^\s*\[\s*['"](?:--version|-v|check-syntax)['"]/;
const PATH_BINARY = String.raw`['"\`][^'"\`\n]*maestro/bin/maestro['"\`]`;
const BARE_BINARY = String.raw`['"\`]maestro['"\`]`;

export const DEFAULT_DEVICE_HELPERS = Object.freeze(['maestroGlobalArgs']);

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The expression that starts at `from`: up to the first , ) ; or } at depth 0. */
function expressionAt(code, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return code.slice(from, i).trim();
      depth -= 1;
    } else if ((ch === ',' || ch === ';') && depth === 0) return code.slice(from, i).trim();
  }
  return code.slice(from).trim();
}

/** The body of `function name(...) {...}` or `const name = (...) => ...` in any of the files. */
function functionBody(files, name) {
  const declared = new RegExp(String.raw`(?:function\s+${name}\s*\(|(?:const|let)\s+${name}\s*=\s*(?:async\s*)?\()`);
  for (const { code } of files) {
    const match = declared.exec(code);
    if (!match) continue;
    const open = code.indexOf('{', match.index);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}' && (depth -= 1) === 0) return code.slice(open, i + 1);
    }
  }
  return '';
}

/** Whether argument text puts --device (and --driver-host-port) before the Maestro command. */
function flagsFirst(text, requireDriverPort) {
  const words = [...text.matchAll(/['"]([^'"\n]+)['"]/g)].map((match) => match[1]);
  const command = words.findIndex((word) => COMMANDS.includes(word));
  const before = command === -1 ? words : words.slice(0, command);
  return before.includes('--device') && (!requireDriverPort || before.includes('--driver-host-port'));
}

/**
 * True when the argument expression (resolved one const and one builder deep) names the device. A
 * bare name resolves to its nearest const or let before the spawn (a file may reuse the name `args`).
 */
function namesDevice(files, file, expression, at, settings) {
  const texts = [expression];
  const bare = /^(\w+)$/.exec(expression)?.[1];
  if (bare) {
    const assignments = [...file.code.slice(0, at).matchAll(new RegExp(String.raw`(?:const|let)\s+${bare}\s*=\s*`, 'g'))];
    const assigned = assignments.at(-1);
    if (assigned) texts.push(expressionAt(file.code, assigned.index + assigned[0].length));
  }
  for (const text of [...texts]) {
    for (const call of text.matchAll(new RegExp(String.raw`(${IDENT})\s*\(`, 'g'))) texts.push(functionBody(files, call[1]));
  }
  return texts.some((text) => settings.helperPattern.test(text) || flagsFirst(text, settings.requireDriverPort));
}

/** Names bound to the Maestro binary: local consts plus names imported from a file that binds them. */
function binaryNames(files) {
  const exported = new Set();
  const local = new Map(files.map((file) => [file.rel, new Set()]));
  for (const file of files) {
    for (const match of file.code.matchAll(BINDING)) {
      local.get(file.rel).add(match[1]);
      exported.add(match[1]);
    }
  }
  for (const file of files) {
    for (const match of file.code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        const original = part.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, '').trim();
        if (name && original && exported.has(original)) local.get(file.rel).add(name);
      }
    }
  }
  return local;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maestroSpawnProblems(files, { helpers = DEFAULT_DEVICE_HELPERS, requireDriverPort = true, fix } = {}) {
  const helperList = helpers.length > 0 ? helpers : DEFAULT_DEVICE_HELPERS;
  const settings = {
    helperPattern: new RegExp(String.raw`\b(?:${helperList.map(escapeRegExp).join('|')})\s*\(`),
    requireDriverPort,
  };
  const flags = requireDriverPort ? '--device <udid> --driver-host-port <port>' : '--device <udid>';
  const FIX_DEVICE = fix ?? `Build the arguments with ${helperList[0]}({ udid${requireDriverPort ? ', driverPort' : ''} })${requireDriverPort ? ' (driverPort: a free port per run)' : ''}, or write the flags out, before the command: maestro ${flags} test ...`;
  const missing = requireDriverPort ? '--device <udid> and --driver-host-port <port>' : '--device <udid>';
  const reach = requireDriverPort ? "so the run can reach another session's simulator or XCTest driver" : 'so the run can drive whichever simulator answers first';
  const problems = [];
  const names = binaryNames(files);
  for (const file of files) {
    const { rel, code } = file;
    const bound = [...names.get(rel)];
    const targets = [...bound, PATH_BINARY, BARE_BINARY];
    for (const target of targets) {
      const spawnAt = new RegExp(String.raw`${SPAWNERS}\(\s*(?:${target})\s*,\s*`, 'g');
      for (const match of code.matchAll(spawnAt)) {
        const args = expressionAt(code, match.index + match[0].length);
        if (NO_DEVICE.test(args) || namesDevice(files, file, args, match.index, settings)) continue;
        problems.push({ file: rel, line: lineOf(code, match.index), message: `spawns Maestro without ${missing} before the command, ${reach}`, fix: FIX_DEVICE });
      }
      if (target === PATH_BINARY || target === BARE_BINARY) continue;
      // An exec step object: { file: MAESTRO_BIN, args } or { file: MAESTRO_BIN, args: [...] }.
      for (const match of code.matchAll(new RegExp(String.raw`\bfile\s*:\s*${target}\b`, 'g'))) {
        const rest = code.slice(match.index, code.indexOf('}', match.index) + 1);
        const named = /\bargs\s*:\s*/.exec(rest);
        const args = named ? expressionAt(rest, named.index + named[0].length) : /[,{]\s*args\s*[,}]/.test(rest) ? 'args' : '';
        if (NO_DEVICE.test(args) || namesDevice(files, file, args, match.index, settings)) continue;
        problems.push({ file: rel, line: lineOf(code, match.index), message: `runs Maestro without ${missing} before the command`, fix: FIX_DEVICE });
      }
    }
    for (const match of code.matchAll(/['"]--udid['"]/g)) problems.push({ file: rel, line: lineOf(code, match.index), message: "passes Maestro's per-command --udid, which leaves the XCTest driver port shared with every other session", fix: FIX_DEVICE });
    for (const match of code.matchAll(/['"]--driver-host-port['"]\s*,\s*['"]?\d+|\bdriverPort\s*:\s*\d/g)) problems.push({ file: rel, line: lineOf(code, match.index), message: 'uses a fixed Maestro driver port, which a second run on this Mac shares', fix: 'Take a free port per run (a free-port lookup in the device-binding helper) or the port the session passes in (for example --driver-port).' });
  }
  return problems;
}
