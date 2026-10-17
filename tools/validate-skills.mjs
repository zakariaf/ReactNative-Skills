#!/usr/bin/env node
// validate-skills.mjs: enforces every checkable part of the skill standard (CONTRIBUTING.md), with
// the constants read from tools/standard.json.
// Usage: node tools/validate-skills.mjs [skill-name-or-path...]   (see --help)

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMON_OPTIONS, STANDARD_PATH, compareShared, defaultTargets, loadStandard, readManifest, resolveRoots, resolveTargets, targetLabel } from './lib/library.mjs';
import { parseYamlSubset, splitFrontmatter } from './lib/frontmatter.mjs';
import { RESULT_PATTERN, UsageError, createReporter, formatProblem, isBinary, makeTempDir, parseArgs, removeTempDir, resultLine, run, toPosix, walk } from './shared/scripts/check-lib.mjs';

// ---------------------------------------------------------------------------------------------
// The standard, compiled from tools/standard.json
// ---------------------------------------------------------------------------------------------

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turn the JSON constants into the sets and regexes the rules use. */
export function compileStandard(std) {
  const device = std.device;
  const helpers = device.bindingHelpers.map(escapeRegExp).join('|');
  return {
    raw: std,
    allowedKeys: std.frontmatter.allowedKeys,
    bannedKeys: std.frontmatter.bannedKeys ?? {},
    keyAdvice: std.frontmatter.keyAdvice ?? {},
    runbook: {
      key: std.frontmatter.runbook.key,
      value: String(std.frontmatter.runbook.value),
      prefix: std.frontmatter.runbook.namePrefix,
      stopAndAsk: std.frontmatter.runbook.stopAndAskPatterns.map((pattern) => new RegExp(pattern, 'i')),
    },
    namePattern: new RegExp(std.names.pattern),
    nameMax: std.names.maxLength,
    reserved: new Set(std.names.reserved),
    reservedSubstrings: std.names.reservedSubstrings,
    descMax: std.description.maxChars,
    descTarget: std.description.targetChars,
    trigger: std.description.triggerPhrase,
    notVerbs: new Set(std.description.notVerbs),
    maxLines: std.skillMd.maxLines,
    sections: std.skillMd.sections,
    filesHeader: std.skillMd.filesTableHeader.map((cell) => cell.toLowerCase()),
    tocThreshold: std.skillMd.tocThreshold,
    dodLimit: std.skillMd.dodCharLimit,
    shouting: new RegExp(`\\b(${std.skillMd.shouting.map(escapeRegExp).join('|')})\\b`),
    topLevel: new Set(std.layout.topLevel),
    scriptsExt: std.layout.scriptsTopLevelExtensions,
    scriptsAllowed: new Set(std.layout.scriptsTopLevelAllowed ?? []),
    projectPatterns: std.projectRefs.patterns.map(({ pattern, flags, what }) => ({ re: new RegExp(pattern, flags ?? ''), what })),
    legacyLibrary: std.projectRefs.legacyLibraryFolder,
    tooling: { dir: std.projectRefs.repoTooling.dir, entries: new Set(std.projectRefs.repoTooling.entries), extensions: std.projectRefs.repoTooling.extensions },
    mdParent: std.projectRefs.markdownParentPath,
    scriptParent: std.projectRefs.scriptParentPath,
    envBanned: new RegExp(`\\b(${std.runtimeEnv.banned.map(escapeRegExp).join('|')})\\b`),
    scriptEnv: new RegExp(`\\bprocess\\.env(?:\\.|\\[\\s*['"\`])(${escapeRegExp(std.runtimeEnv.scriptEnvPrefix)}\\w*)`),
    device: {
      maestroCommands: new Set(device.maestroDeviceCommands),
      maestroValueOptions: new Set(device.maestroValueOptions),
      simctlCommands: new Set(device.simctlDeviceCommands),
      simctlImplicit: new Set(device.simctlImplicitDevices),
      adbCommands: new Set(device.adbDeviceCommands),
      adbValueOptions: new Set(device.adbValueOptions),
      adbSelectOptions: new Set(device.adbSelectOptions),
      helperCall: new RegExp(`\\b(?:${helpers})\\s*\\(`),
      factoryCall: new RegExp(`\\b(?:${device.bindingFactoryPrefixes.map(escapeRegExp).join('|')})\\w*(?:Maestro|Adb)\\w*\\s*\\([^)]*\\b(?:udid|device|serial)\\b`, 'i'),
      helperNames: device.bindingHelpers,
      naming: device.simulatorNaming,
    },
    timeoutMs: std.scripts.timeoutMs,
    builtins: new Set(std.scripts.nodeBuiltins),
    fixtures: {
      kinds: Object.keys(std.fixtures.caseKinds),
      overlayFiles: std.fixtures.overlayFiles,
      overlayDir: std.fixtures.overlayDir,
      suiteFile: std.fixtures.suiteFile ?? 'SUITE.json',
      casesFile: std.fixtures.casesFile ?? 'CASES.json',
      renameFor: Object.fromEntries(Object.entries(std.fixtures.hygieneRenames ?? {}).map(([stored, real]) => [real, stored])),
      expectFile: std.fixtures.expectFile,
      basesDir: std.fixtures.basesDir,
      mutationOps: new Set(std.fixtures.mutationOps),
      hygieneNames: new Set(std.fixtures.hygieneNames),
      budget: std.fixtures.budget,
      binaryExtensions: new Set(std.fixtures.budget.binaryExtensions.map((ext) => ext.toLowerCase())),
    },
  };
}

const DEFAULT_STANDARD = compileStandard(loadStandard());
const S0 = DEFAULT_STANDARD;
const PROBLEM_CAP = 25; // per skill and per file-level rule, so one bulky skill cannot drown the report

/** Every rule the validator reports, with the one-line meaning (printed by --help). */
export const RULES = {
  'skill-md': 'the folder has a SKILL.md',
  'fm-line1': '"---" is exactly line 1 (no blank line, no BOM)',
  'fm-close': 'the frontmatter has a closing "---" line',
  'fm-yaml': 'the frontmatter is inside the strict YAML subset (one-line values, quoted when they hold ": " or " #")',
  'fm-key': `only these keys: ${S0.allowedKeys.join(', ')}`,
  'fm-dmi-runbook': `${S0.runbook.key} only as "${S0.runbook.value}", only in a skill named ${S0.runbook.prefix}*, and only when its body has a stop-and-ask step`,
  'fm-no-allowed-tools': 'no allowed-tools (it makes autonomous runs ask for permission)',
  'name-format': `name is 1-${S0.nameMax} chars of [a-z0-9-], no leading, trailing or double hyphen`,
  'name-match': 'name equals the folder name',
  'name-reserved': `name does not shadow a bundled command or an Expo skill and has no ${S0.reservedSubstrings.map((word) => `"${word}"`).join('/')}`,
  'desc-length': `description is present and at most ${S0.descMax} characters (aim for ${S0.descTarget})`,
  'desc-angle': 'description has no < or >',
  'desc-verb': 'description starts with a third-person verb ("Builds", "Checks")',
  'desc-person': 'description has no "I" or "you"',
  'desc-trigger': `description says "${S0.trigger} ..."`,
  'skill-lines': `SKILL.md has at most ${S0.maxLines} lines`,
  sections: `SKILL.md has an H1 title, an intro line, then the sections in order: ${S0.sections.join(' > ')}`,
  'section-format': 'numbered rules and workflow, "- [ ]" done items, the Files table header, Related skills list',
  'dod-position': `the Definition of done ends within the first ${S0.dodLimit} characters (survives compaction)`,
  'dod-script': 'a skill with scripts ends its Definition of done with a ${CLAUDE_SKILL_DIR}/scripts/ run that prints RESULT: PASS',
  'link-resolve': 'every relative link and ${CLAUDE_SKILL_DIR} path resolves to a file inside the skill',
  'files-listed': 'every file in the skill is listed in the "Files in this skill" table (a "dir/" row covers a folder)',
  'files-exist': 'every file the table lists exists',
  'ref-toc': `references longer than ${S0.tocThreshold} lines start with a table of contents`,
  'no-project-ref': 'no paths that leave the skill: absolute home paths (/Users/, /home/, C:\\Users\\), scratchpad and /private/tmp/ paths, ../ in markdown, ../../ in scripts, other skills\' folders, repo tooling (tools/..., skills/_library/...)',
  'no-runtime-env': 'no variables that exist only in some agents or install scopes (CLAUDE_PLUGIN_ROOT, CLAUDE_PROJECT_DIR, ...), and scripts read no CLAUDE_* environment variable',
  'no-shouting': 'no ALL-CAPS shouting (MUST, NEVER, ALWAYS, IMPORTANT, ...) outside code',
  'device-explicit': 'every documented or scripted maestro, simctl, xcodebuild and adb call names its device: maestro --device <udid> before the command, a simctl UDID (never booted or all), xcodebuild -destination id=<udid>, adb -s <serial> before the command',
  layout: `only ${[...S0.topLevel].map((entry) => (entry.includes('.') ? entry : `${entry}/`)).join(', ')}; no symlinks, empty folders or nested SKILL.md`,
  'fixture-hygiene': `no file or folder named ${[...S0.fixtures.hygieneNames].join(', ')} anywhere in a skill (store dot-gitignore / dot-metadata.json; the skills CLI drops metadata.json and git obeys a nested .gitignore)`,
  'fixture-budget': `tests/ at most ${S0.fixtures.budget.testsMaxBytes} bytes and ${S0.fixtures.budget.testsMaxFiles} files; every file at most ${S0.fixtures.budget.fileMaxBytes} bytes; binary files only ${[...S0.fixtures.binaryExtensions].join(' ')}`,
  'script-lib': 'scripts are Node .mjs entry points that import ./check-lib.mjs (selftest.mjs uses runSelftest)',
  'script-deps': 'scripts import only node: built-ins, relative files, or packages pinned in scripts/package.json (loaded with await import())',
  'script-help': 'every script prints "Usage:" and exits 0 for --help',
  'script-result': 'every script run with no arguments in an empty folder exits 0, 1 or 2 and ends with the RESULT line',
  'selftest-missing': 'a skill with scripts has scripts/selftest.mjs',
  fixtures: 'the self-test has tests/fixtures/ suites, each with a bad-* case and a good/ case or a declared base (SUITE.json, base/, tests/bases/); every bad-*, pass-* and error-* case has a non-empty EXPECT.txt; overlay files (mutation.json, DELETE.txt, overlay/, SUITE.json, a suite\'s CASES.json) are well formed',
  'shared-json': 'assets/shared.json is a valid list of { "from", "to" } entries',
  'shared-drift': 'every declared shared file is identical to the canonical copy (run node tools/sync-shared.mjs)',
  'shared-undeclared': 'a check-lib.mjs copy is declared in assets/shared.json',
  'library-layout': 'the skills folder holds only skill folders (no README.md, no _library/, no stray files or links)',
};

// ---------------------------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------------------------

/** Lines of a markdown file with fenced code blanked and inline code masked (line numbers kept). */
export function proseLines(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let fence = null;
  return lines.map((line) => {
    const opener = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (opener && line.trim().startsWith(fence)) fence = null;
      return '';
    }
    if (opener) {
      fence = opener[1];
      return '';
    }
    return line.replace(/(`+)([\s\S]*?)\1/g, (match) => ' '.repeat(match.length));
  });
}

/** Headings outside fenced code: [{ level, text, line (1-based), index (0-based) }]. */
function headings(lines, offset = 0) {
  const out = [];
  let fence = null;
  lines.forEach((line, index) => {
    const opener = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (opener && line.trim().startsWith(fence)) fence = null;
      return;
    }
    if (opener) {
      fence = opener[1];
      return;
    }
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) out.push({ level: match[1].length, text: match[2].trim(), line: index + 1 + offset, index });
  });
  return out;
}

function sectionLines(lines, heads, title) {
  const start = heads.find((head) => head.level === 2 && head.text.toLowerCase() === title.toLowerCase());
  if (!start) return null;
  const next = heads.find((head) => head.index > start.index && head.level <= 2);
  return { head: start, lines: lines.slice(start.index + 1, next ? next.index : lines.length), firstIndex: start.index + 1 };
}

function tableRows(sectionText) {
  return sectionText.filter((line) => /^\s*\|/.test(line)).map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
}

/** The path named in the first cell of a Files table row. */
function cellPath(cell) {
  const code = /`([^`]+)`/.exec(cell);
  if (code) return code[1].trim();
  const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(cell);
  if (link) return link[1].trim();
  return cell.replace(/\*\*/g, '').trim();
}

function normalizeRel(path) {
  return posix.normalize(path.replace(/^\.\//, '').replace(/^\$\{CLAUDE_SKILL_DIR\}\//, ''));
}

// ---------------------------------------------------------------------------------------------
// Project references and runtime variables
// ---------------------------------------------------------------------------------------------

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]'"`>]+/gi;
const TOKEN_PATTERN = /[A-Za-z0-9_.~@$%{}+*-]*(?:\/[A-Za-z0-9_.~@$%{}+*-]*)+/g;

/** Find references that leave the skill in one line. Returns [{ index, what }]. */
export function findProjectRefs(line, { markdownProse = false, script = false } = {}, S = DEFAULT_STANDARD) {
  const found = [];
  const clean = line.replace(URL_PATTERN, (match) => ' '.repeat(match.length));
  for (const { re, what } of S.projectPatterns) {
    const match = re.exec(clean);
    if (match) found.push({ index: match.index, what });
  }
  for (const match of clean.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const segments = token.split('/');
    while (segments.length && ['', '.', '..'].includes(segments[0])) segments.shift();
    if (segments.length >= 2 && segments[0] === S.tooling.dir) {
      const next = segments[1].replace(/[.,;:)]+$/, '');
      if (S.tooling.entries.has(next) || S.tooling.extensions.some((ext) => next.endsWith(ext))) {
        found.push({ index: match.index, what: `the repo tooling path ${token} (it is not installed with the skill)` });
        continue;
      }
    }
    // skills/<name>/ or <agent folder>/skills/<name>/ (.claude, .agents, .cursor, ...): another skill's files.
    const k = segments.findIndex((segment, i) => segment === 'skills' && (i === 0 || /^\.[a-z][a-z0-9-]*$/.test(segments[i - 1])));
    if (k !== -1) {
      const next = segments[k + 1];
      if (next === S.legacyLibrary) found.push({ index: match.index, what: `the old library folder (${token}); the maintainer tools live in the repo, not in an installed skill` });
      else if (next && S.namePattern.test(next) && segments.length > k + 2) found.push({ index: match.index, what: `another skill's folder (${token})` });
    }
  }
  if (markdownProse) {
    const index = clean.indexOf(S.mdParent);
    if (index !== -1) found.push({ index, what: `a "${S.mdParent}" path that leaves the folder` });
  }
  if (script) {
    const index = clean.indexOf(S.scriptParent);
    if (index !== -1) found.push({ index, what: `a "${S.scriptParent}" path that leaves the skill` });
  }
  return found;
}

/** Variables that exist only in some agents or install scopes, in one line. Returns [{ index, what }]. */
export function findRuntimeEnv(line, { script = false } = {}, S = DEFAULT_STANDARD) {
  const found = [];
  const banned = S.envBanned.exec(line);
  if (banned) found.push({ index: banned.index, what: `${banned[1]} (it is set only in some agents or install scopes)` });
  if (script) {
    const read = S.scriptEnv.exec(line);
    if (read && !(banned && banned[1] === read[1])) found.push({ index: read.index, what: `a read of the ${read[1]} environment variable (scripts locate themselves with import.meta.url and take paths as arguments)` });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Device-explicit calls: maestro, simctl, xcodebuild and adb always name their device
// ---------------------------------------------------------------------------------------------

// Several sessions share one machine. A call that picks "the booted simulator", Maestro's first
// device or adb's only device can reach another session's device: a hierarchy dump from someone
// else's screen, a shutdown of someone else's run. So every command line a skill documents or
// scripts names its device: maestro --device <udid> before the command, a simctl UDID or variable,
// xcodebuild -destination id=<udid> (or generic/platform=... for an archive, which targets no
// device), and adb -s <serial> before the command.
// A span that forbids the command ("never `xcrun simctl shutdown all`") names it without running it.
const NEGATION_BEFORE = /\b(never|not|no|avoid|without|instead of|rather than|forbidden|banned|refuses?|rejects?|don't)\b[^.,;:!?]{0,40}$/i;
const ARG_LIKE = /^(?:-|<|\$|"|'|>|\||\.{0,2}\/|[\w.@-]*\/|[\w.@-]+\.(?:ya?ml|json|mp4|png|txt)\b)/;
const OPERAND_LIKE = /^(?:<|\$|"\$|'\$|\.{0,2}\/|[\w.@${}-]*\/|[\w.@-]+\.(?:ya?ml|json)\b)/;

const cleanToken = (token) => token.replace(/^[`'"(]+|[`'",;)]+$/g, '');

/** maestro command lines in one span of command text: [{ index, what, fix }]. */
function maestroTextHits(text, { isCode }, S) {
  const hits = [];
  const word = /(?:^|[\s;&|(`"'=])((?:[\w.~${}-]*\/)*maestro|"?\$\{?MAESTRO\w*\}?"?)(?=\s)/g;
  for (const match of text.matchAll(word)) {
    const start = match.index + match[0].length - match[1].length;
    const tokens = text.slice(start + match[1].length).trim().split(/\s+/).filter(Boolean);
    const globals = [];
    let i = 0;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const option = tokens[i].split('=')[0];
      globals.push(option);
      i += S.device.maestroValueOptions.has(option) && !tokens[i].includes('=') ? 2 : 1;
    }
    const sub = tokens[i];
    if (!sub || !S.device.maestroCommands.has(sub)) continue;
    const rest = tokens.slice(i + 1);
    const isCommandLine = isCode || (sub === 'test' || sub === 'record' ? rest.some((token) => !token.startsWith('-') && OPERAND_LIKE.test(token)) : rest.length > 0 && ARG_LIKE.test(rest[0]));
    if (!isCommandLine || globals.includes('--device')) continue;
    hits.push({ index: start, what: `"maestro ${sub}" without --device <udid> before the command`, fix: `Write maestro --device <udid> ${sub} ... (the global option comes before the command; in code build the arguments with a device-binding helper such as ${S.device.helperNames[0]}()), so the call can only reach this session's simulator.` });
  }
  return hits;
}

/** simctl calls in one span of command text that pick booted or all: [{ index, what, fix }]. */
function simctlTextHits(text, S) {
  const hits = [];
  for (const match of text.matchAll(/\bsimctl\s+(?:--set\s+\S+\s+)?([a-z_]+)((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)\s+(\S+)/g)) {
    const device = cleanToken(match[3]);
    if (S.device.simctlCommands.has(match[1]) && S.device.simctlImplicit.has(device)) {
      hits.push({ index: match.index, what: `"simctl ${match[1]} ${device}" targets ${device === 'all' ? 'every simulator on the Mac' : 'whichever simulator is booted'}`, fix: `Name the simulator by its UDID (xcrun simctl <command> "$UDID" ...; find it with xcrun simctl list devices -j and the ${S.device.naming} name), so the call never touches another session's simulator.` });
    }
  }
  return hits;
}

/** xcodebuild -destination values that do not name the simulator by id=. */
function destinationHits(text) {
  const hits = [];
  for (const match of text.matchAll(/(?<![\w-])-destination(?![\w-])/g)) {
    let i = match.index + match[0].length;
    const skip = () => {
      while (i < text.length && /[\s,]/.test(text[i])) i += 1;
    };
    skip();
    if (/['"`]/.test(text[i]) && /^['"`]\s*,/.test(text.slice(i))) {
      i += 1;
      skip();
    }
    let value;
    let quoted = false;
    if (/['"`]/.test(text[i] ?? '')) {
      const quote = text[i];
      const end = text.indexOf(quote, i + 1);
      value = text.slice(i + 1, end === -1 ? text.length : end);
      quoted = true;
    } else {
      value = /^[^\s,)\]`;]*/.exec(text.slice(i))[0];
    }
    if (value === '') continue;
    const variable = /^\$|^<|^\{/.test(value) || (!quoted && /^[A-Za-z_][\w.]*$/.test(value) && !value.includes('='));
    if (variable || /(^|[,\s])id=/.test(value) || value.startsWith('generic/')) continue;
    hits.push({ index: match.index, what: `xcodebuild -destination "${value}" does not name the simulator by id=`, fix: 'Use -destination id=<udid> (or "id=$UDID") for a simulator build, and generic/platform=iOS only for an archive, so xcodebuild never picks a simulator by name or OS.' });
  }
  return hits;
}

/** adb command lines in one span of command text that do not pick a device with -s: [{ index, what, fix }]. */
function adbTextHits(text, { isCode }, S) {
  const hits = [];
  const word = /(?:^|[\s;&|(`"'=])((?:[\w.~${}-]*\/)*adb|"?\$\{?ADB\w*\}?"?)(?=\s)/g;
  for (const match of text.matchAll(word)) {
    const start = match.index + match[0].length - match[1].length;
    if (/\bANDROID_SERIAL=\S/.test(text.slice(0, start))) continue;
    const tokens = text.slice(start + match[1].length).trim().split(/\s+/).filter(Boolean);
    const globals = [];
    let i = 0;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      globals.push(tokens[i]);
      i += S.device.adbValueOptions.has(tokens[i]) ? 2 : 1;
    }
    const sub = cleanToken(tokens[i] ?? '');
    if (!S.device.adbCommands.has(sub) || globals.some((option) => S.device.adbSelectOptions.has(option))) continue;
    if (!isCode && tokens.length <= i + 1) continue; // "the adb shell command" in prose names it without running it
    hits.push({ index: start, what: `"adb ${sub}" without -s <serial> before the command`, fix: `Write adb -s <serial> ${sub} ... (find the serial with adb devices; an emulator started with emulator -avd <project>-<purpose> shows as emulator-5554), so the call never reaches another session's device.` });
  }
  return hits;
}

/** maestro, simctl and adb calls written as code: maestro('--device', udid, 'hierarchy'), simctl('io', 'booted', ...). */
function callFormHits(line, S) {
  const hits = [];
  const bound = S.device.helperCall.test(line);
  const call = /(?:\b(?:run)?[Mm]aestro\w*\s*\(|['"]maestro['"]\s*,\s*\[|\[\s*['"]maestro['"])/g;
  for (const match of line.matchAll(call)) {
    const after = line.slice(match.index);
    const sub = new RegExp(`['"](${[...S.device.maestroCommands].map(escapeRegExp).join('|')})['"]`).exec(after);
    if (!sub) continue;
    const before = after.slice(0, sub.index);
    if (/['"]--device['"]/.test(before) || bound) continue;
    hits.push({ index: match.index, what: `a maestro "${sub[1]}" call without "--device", <udid> before the command`, fix: `Build the arguments with ${S.device.helperNames[0]}() or pass '--device', udid before '${sub[1]}'.` });
  }
  const simctlCall = /(?:\bsimctl\s*\(\s*|\[\s*['"]simctl['"]\s*,\s*)['"]([a-z_]+)['"]\s*,\s*(?:['"]-[\w-]+['"]\s*,\s*)*['"](booted|all)['"]/g;
  for (const match of line.matchAll(simctlCall)) {
    if (S.device.simctlCommands.has(match[1])) hits.push({ index: match.index, what: `a simctl "${match[1]}" call on "${match[2]}"`, fix: 'Pass the simulator\'s UDID (a variable), never booted or all.' });
  }
  const adbCall = /(?:\b(?:run)?[Aa]db\w*\s*\(|['"]adb['"]\s*,\s*\[|\[\s*['"]adb['"])/g;
  for (const match of line.matchAll(adbCall)) {
    const after = line.slice(match.index);
    const sub = new RegExp(`['"](${[...S.device.adbCommands].map(escapeRegExp).join('|')})['"]`).exec(after);
    if (!sub) continue;
    const before = after.slice(0, sub.index);
    if (/['"]-s['"]/.test(before) || bound) continue;
    hits.push({ index: match.index, what: `an adb "${sub[1]}" call without "-s", <serial> before the command`, fix: `Pass '-s', serial before '${sub[1]}' (or build the arguments with a device-binding helper such as ${S.device.helperNames.find((name) => /adb/i.test(name)) ?? 'adbArgs'}()).` });
  }
  return hits;
}

/**
 * Calls in one file that reach a device without naming it. kind 'md' reads fenced code lines and
 * inline code spans (a forbidding sentence or an Anti-patterns section names a command without
 * running it); kind 'script' reads every line. Returns [{ line, what, fix }].
 */
export function findImplicitDeviceCalls(text, { kind = 'md' } = {}, S = DEFAULT_STANDARD) {
  const found = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const push = (line, hits) => {
    for (const hit of hits) if (!found.some((item) => item.line === line && item.what === hit.what)) found.push({ line, what: hit.what, fix: hit.fix });
  };
  const negated = (prefix) => NEGATION_BEFORE.test(prefix);
  const textHits = (span, isCode) => [...maestroTextHits(span, { isCode }, S), ...simctlTextHits(span, S), ...destinationHits(span), ...adbTextHits(span, { isCode }, S)];
  if (kind === 'script') {
    // A script whose runner is built for one device (a binding helper, or a make/create factory given
    // the udid or serial) names the device in every call through that runner.
    const bindsDevice = S.device.helperCall.test(text) || S.device.factoryCall.test(text);
    lines.forEach((line, i) => {
      const calls = callFormHits(line, S).filter((hit) => !(bindsDevice && (hit.what.startsWith('a maestro') || hit.what.startsWith('an adb'))));
      const hits = [...textHits(line, false), ...calls];
      push(i + 1, hits.filter((hit) => !negated(line.slice(0, hit.index))));
    });
    return found;
  }
  let fence = null;
  let section = '';
  let continued = null;
  lines.forEach((line, i) => {
    const opener = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (opener && line.trim().startsWith(fence)) {
        fence = null;
        continued = null;
        return;
      }
      if (/^\s*anti-patterns\s*$/i.test(section)) return;
      // A shell command continued with a trailing backslash is one command line.
      const start = continued ?? { line: i + 1, text: '' };
      start.text += `${line.replace(/\\\s*$/, '')} `;
      if (/\\\s*$/.test(line)) {
        continued = start;
        return;
      }
      continued = null;
      push(start.line, [...textHits(start.text, true), ...callFormHits(start.text, S)]);
      return;
    }
    if (opener) {
      fence = opener[1];
      return;
    }
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && /^#{1,2}\s/.test(line)) section = heading[1];
    if (/^\s*anti-patterns\s*$/i.test(section)) return;
    for (const span of line.matchAll(/(`+)([\s\S]*?)\1/g)) {
      if (negated(line.slice(0, span.index))) continue;
      push(i + 1, [...textHits(span[2], false), ...callFormHits(span[2], S)]);
    }
  });
  return found;
}

// ---------------------------------------------------------------------------------------------
// Per-skill validation
// ---------------------------------------------------------------------------------------------

/** Every folder and file under root (posix rel paths), symlinks included, node_modules skipped. */
function listEntries(root) {
  const out = [];
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = join(abs, entry.name);
      const rel = toPosix(relative(root, child));
      out.push({ rel, name: entry.name, isDir: entry.isDirectory(), isLink: entry.isSymbolicLink() });
      if (entry.isDirectory() && entry.name !== '.git') visit(child);
    }
  };
  visit(root);
  return out;
}

function runScript(script, args, timeoutMs) {
  const cwd = makeTempDir('validate-skills-');
  try {
    const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return { status: result.status, stdout: result.stdout ?? '', output: `${result.stdout ?? ''}${result.stderr ?? ''}`, timedOut: result.error?.code === 'ETIMEDOUT' };
  } finally {
    removeTempDir(cwd);
  }
}

function lastLine(text) {
  return text.split('\n').map((line) => line.trimEnd()).filter(Boolean).at(-1) ?? '';
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    { re: /^\s*import\s+(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm, dynamic: false },
    { re: /^\s*export\s+[^;'"]*?\s+from\s+['"]([^'"]+)['"]/gm, dynamic: false },
    { re: /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, dynamic: true },
    { re: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, dynamic: false },
  ];
  for (const { re, dynamic } of patterns) {
    for (const match of source.matchAll(re)) specs.push({ spec: match[1], index: match.index + match[0].indexOf(match[1]), dynamic });
  }
  return specs;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Binary sniff from the first 8 KB only, so a large tree is cheap to check. */
function looksBinary(abs) {
  const fd = openSync(abs, 'r');
  try {
    const buffer = Buffer.alloc(8000);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return isBinary(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}

/** Case kind of a fixture folder name ('good', 'pass-', 'bad-', 'error-') or null. */
function caseKindOf(name, S) {
  if (name === 'good') return 'good';
  return S.fixtures.kinds.find((kind) => kind.endsWith('-') && name.startsWith(kind) && name.length > kind.length) ?? null;
}

/** Problems in one overlay mutation.json: [message]. */
function mutationProblems(text, S) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return [`not valid JSON: ${error.message}`];
  }
  const ops = Array.isArray(data) ? data : Array.isArray(data?.ops) ? data.ops : null;
  if (!ops) return ['is not a list of overlay ops (a mutation.json at a case root is the op list; input data with that name belongs under overlay/ or a subfolder)'];
  const problems = [];
  ops.forEach((op, index) => {
    // An op may carry a "$comment" next to its one key (check-lib and API.md accept it).
    const keys = op && typeof op === 'object' && !Array.isArray(op) ? Object.keys(op).filter((key) => key !== '$comment') : [];
    const name = op && typeof op === 'object' && !Array.isArray(op) ? (typeof op.op === 'string' ? op.op : keys.length === 1 ? keys[0] : null) : null;
    if (!name || !S.fixtures.mutationOps.has(name)) problems.push(`op ${index + 1} ${JSON.stringify(op).slice(0, 80)} is not one of ${[...S.fixtures.mutationOps].join(', ')}`);
  });
  return problems;
}

export function validateSkill(target, roots, { runScripts = true, standard = DEFAULT_STANDARD } = {}) {
  const S = standard;
  const problems = [];
  const label = targetLabel(target);
  const add = (rule, file, line, message, fix) => problems.push({ rule, file: file ? `${label}/${file}` : label, line, message, fix });
  const capped = new Map();
  const addCapped = (rule, file, line, message, fix) => {
    const count = (capped.get(rule) ?? 0) + 1;
    capped.set(rule, count);
    if (count <= PROBLEM_CAP) add(rule, file, line, message, fix);
  };
  const finish = () => {
    for (const [rule, count] of capped) {
      if (count > PROBLEM_CAP) add(rule, '', 0, `${count - PROBLEM_CAP} more ${rule} problems not shown (${count} in all)`, 'Fix the ones above, then rerun to see the rest.');
    }
    return problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  };
  const dir = target.dir;
  const folderName = dir.split('/').pop();

  // ---- files and layout ----
  const symlinks = [];
  const files = walk(dir, { defaultIgnores: false, ignore: ['node_modules', '.git', '.DS_Store'], onSymlink: (rel) => symlinks.push(rel) });
  const entries = listEntries(dir);
  const dirs = entries.filter((entry) => entry.isDir && entry.name !== '.git').map((entry) => entry.rel);
  for (const rel of symlinks) add('layout', rel, 0, 'is a symlink; a skill must hold real files so it works when copied', 'Replace the link with the file itself (sync-shared copies shared files).');
  const topLevel = new Set([...files, ...dirs].map((rel) => rel.split('/')[0]));
  for (const entry of [...topLevel].sort()) {
    if (!S.topLevel.has(entry)) add('layout', entry, 0, `"${entry}" is not part of the skill layout (${[...S.topLevel].join(', ')})`, 'Move it into one of those folders or delete it.');
  }
  for (const rel of dirs) {
    const hasContent = readdirSync(join(dir, rel)).some((name) => name !== '.DS_Store');
    if (!hasContent) add('layout', `${rel}/`, 0, 'empty folder', 'Delete it; create only the folders the skill needs.');
  }
  for (const rel of files) {
    if (rel !== 'SKILL.md' && rel.endsWith('/SKILL.md') && !rel.startsWith('tests/')) add('layout', rel, 0, 'nested SKILL.md outside tests/', 'A skill is one folder deep; remove the nested SKILL.md.');
  }

  // ---- fixture hygiene: names the skills CLI drops or git obeys ----
  for (const entry of entries) {
    if (!S.fixtures.hygieneNames.has(entry.name)) continue;
    if (entry.rel.split('/').slice(0, -1).some((segment) => S.fixtures.hygieneNames.has(segment))) continue;
    const stored = S.fixtures.renameFor[entry.name];
    const advice = stored ? `Store it as ${stored} (check-lib's case assembly renames it back to ${entry.name}), or create it in the test at run time.` : 'Delete it; the skills CLI drops it on install and it does not belong in a skill.';
    addCapped('fixture-hygiene', `${entry.rel}${entry.isDir ? '/' : ''}`, 0, `${entry.isDir ? 'folder' : 'file'} named ${entry.name} inside the skill`, advice);
  }

  // ---- fixture budget ----
  const budget = S.fixtures.budget;
  let testsBytes = 0;
  let testsFiles = 0;
  for (const rel of files) {
    const abs = join(dir, rel);
    const size = statSync(abs).size;
    if (rel.startsWith('tests/')) {
      testsBytes += size;
      testsFiles += 1;
    }
    if (size > budget.fileMaxBytes) addCapped('fixture-budget', rel, 0, `is ${size} bytes (limit ${budget.fileMaxBytes} per file)`, 'Shrink it: generate large inputs at test time (an overlay op or writePng), or cut it to what the rule needs.');
    const ext = extname(rel).toLowerCase();
    if (!S.fixtures.binaryExtensions.has(ext) && size > 0 && looksBinary(abs)) addCapped('fixture-budget', rel, 0, `is a binary file with "${ext || 'no'}" extension (allowed: ${[...S.fixtures.binaryExtensions].join(' ')})`, 'Replace it with text, generate it at test time, or use an allowed format.');
  }
  if (testsBytes > budget.testsMaxBytes) add('fixture-budget', 'tests/', 0, `tests/ holds ${testsBytes} bytes (limit ${budget.testsMaxBytes})`, 'Move cases to the overlay format (a base tree plus EXPECT.txt and mutation.json per case) and generate images at test time.');
  if (testsFiles > budget.testsMaxFiles) add('fixture-budget', 'tests/', 0, `tests/ holds ${testsFiles} files (limit ${budget.testsMaxFiles})`, 'Move cases to the overlay format: one shared base tree, and only EXPECT.txt plus mutation.json in each case.');

  // ---- SKILL.md ----
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) {
    add('skill-md', 'SKILL.md', 0, 'missing', 'Create SKILL.md (skill-maintenance scaffolds one).');
    return finish();
  }
  const rawSkill = readFileSync(skillPath, 'utf8');
  const skillText = rawSkill.replace(/\r\n/g, '\n');
  const fm = splitFrontmatter(rawSkill);
  if (!fm.line1Ok) add('fm-line1', 'SKILL.md', 1, fm.bom ? 'starts with a byte-order mark before "---"' : 'line 1 is not exactly "---", so agents read no frontmatter at all', 'Make "---" the very first line of the file.');
  let data = {};
  let keyLines = {};
  if (fm.found && !fm.closed) add('fm-close', 'SKILL.md', 1, 'the frontmatter has no closing "---" line', 'Add a line with exactly "---" after the last frontmatter key.');
  const body = fm.closed ? fm.lines.slice(fm.bodyStart) : [];
  if (fm.closed) {
    const parsed = parseYamlSubset(fm.yaml);
    data = parsed.data;
    keyLines = parsed.lines;
    for (const error of parsed.errors) add('fm-yaml', 'SKILL.md', error.line, error.message, 'Keep each value on one line and wrap values that contain ": " or " #" in double quotes.');
    for (const key of Object.keys(parsed.lines)) {
      if (key === S.runbook.key) {
        const name = typeof data.name === 'string' ? data.name : folderName;
        const missing = [];
        if (key in data && String(data[key]) !== S.runbook.value) missing.push(`its value is ${JSON.stringify(data[key])}, not ${S.runbook.value}`);
        if (!name.startsWith(S.runbook.prefix)) missing.push(`the name "${name}" does not start with "${S.runbook.prefix}"`);
        const prose = proseLines(body.join('\n')).join('\n');
        if (!S.runbook.stopAndAsk.some((re) => re.test(prose))) missing.push('the body has no stop-and-ask step');
        if (missing.length) add('fm-dmi-runbook', 'SKILL.md', parsed.lines[key], `${key} hides the skill from the agent; it is only for side-effecting ${S.runbook.prefix}* runbooks that stop and ask: ${missing.join('; ')}`, `Delete the ${key} line, or make this a ${S.runbook.prefix}<action> runbook whose workflow says "stop and ask the developer before ...".`);
      } else if (key in S.bannedKeys) {
        add('fm-no-allowed-tools', 'SKILL.md', parsed.lines[key], S.bannedKeys[key], `Delete the ${key} line; project settings allow the skill scripts.`);
      } else if (!S.allowedKeys.includes(key)) {
        add('fm-key', 'SKILL.md', parsed.lines[key], `key "${key}" is not allowed${S.keyAdvice[key] ? `: ${S.keyAdvice[key]}` : ''}`, `Use only ${S.allowedKeys.join(', ')}.`);
      }
    }
    // name
    const nameLine = keyLines.name ?? 1;
    if (!('name' in keyLines)) add('name-format', 'SKILL.md', 1, 'no name key', `Add "name: ${folderName}".`);
    else if ('name' in data) {
      const name = data.name;
      if (typeof name !== 'string' || name.length === 0 || name.length > S.nameMax || !S.namePattern.test(name)) {
        add('name-format', 'SKILL.md', nameLine, `name ${JSON.stringify(name)} is not 1-${S.nameMax} characters of lowercase letters, digits and single hyphens`, 'Use a kebab-case name such as "state-management-zustand".');
      } else {
        if (name !== folderName) add('name-match', 'SKILL.md', nameLine, `name "${name}" differs from the folder name "${folderName}"`, 'Make the name and the folder name the same.');
        if (S.reserved.has(name) || S.reservedSubstrings.some((word) => name.includes(word))) add('name-reserved', 'SKILL.md', nameLine, `name "${name}" is reserved (a bundled command, an Expo skill, or contains ${S.reservedSubstrings.map((word) => `"${word}"`).join('/')})`, 'Pick a more specific name, for example with a domain prefix.');
      }
    }
    // description
    const descLine = keyLines.description ?? 1;
    if (!('description' in keyLines)) add('desc-length', 'SKILL.md', 1, 'no description key', `Add a one-line description: "<Verb>s ... ${S.trigger} ...".`);
    else if ('description' in data) {
      const desc = data.description;
      if (typeof desc !== 'string' || desc.trim() === '') add('desc-length', 'SKILL.md', descLine, 'description is empty', 'Write what the skill does and when to use it.');
      else {
        if (desc.length > S.descMax) add('desc-length', 'SKILL.md', descLine, `description is ${desc.length} characters (limit ${S.descMax}; aim for ${S.descTarget})`, 'Cut it to the trigger words and the one job.');
        if (/[<>]/.test(desc)) add('desc-angle', 'SKILL.md', descLine, 'description contains < or >', 'Remove angle brackets (write "a name" instead of "<name>").');
        const first = desc.trim().split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
        if (!/^[A-Z][a-z]+s$/.test(first) || S.notVerbs.has(first.toLowerCase())) add('desc-verb', 'SKILL.md', descLine, `description starts with "${first}", not a third-person verb`, 'Start with a verb such as "Builds", "Checks", "Explains" or "Adds".');
        if (/(^|[^A-Za-z0-9_/])I('m|'ll|'ve|'d)?(?![A-Za-z0-9_'/])/.test(desc) || /\b(you|your|yours|yourself|yourselves)\b/i.test(desc)) add('desc-person', 'SKILL.md', descLine, 'description speaks as "I" or to "you"', `Write in the third person: "Builds ...", "${S.trigger} ...".`);
        if (!new RegExp(`\\b${escapeRegExp(S.trigger)}\\b`).test(desc)) add('desc-trigger', 'SKILL.md', descLine, 'description does not say when to use the skill', `Add "${S.trigger} <concrete intents and trigger words>."`);
      }
    }
  }

  // ---- SKILL.md body ----
  const allLines = skillText.split('\n');
  const lineCount = skillText.endsWith('\n') ? allLines.length - 1 : allLines.length;
  if (lineCount > S.maxLines) add('skill-lines', 'SKILL.md', S.maxLines + 1, `SKILL.md has ${lineCount} lines (limit ${S.maxLines})`, 'Move detail into references/ and link it with when to read it.');

  const entryScripts = files.filter((rel) => /^scripts\/[^/]+\.mjs$/.test(rel) && rel !== 'scripts/check-lib.mjs');
  const checkerScripts = entryScripts.filter((rel) => rel !== 'scripts/selftest.mjs');

  if (fm.closed) {
    const offset = fm.bodyStart;
    const heads = headings(body, offset);
    const h2 = heads.filter((head) => head.level === 2);
    const firstContent = body.findIndex((line) => line.trim() !== '');
    const firstHead = heads[0];
    const [firstSection] = S.sections;
    if (!firstHead || firstHead.level !== 1 || firstHead.index !== firstContent) add('sections', 'SKILL.md', offset + firstContent + 1, 'the body does not start with an H1 title ("# Title")', 'Start the body with "# <Title>" and one or two sentences on what the skill makes true.');
    else {
      if (heads.filter((head) => head.level === 1).length > 1) add('sections', 'SKILL.md', heads.filter((head) => head.level === 1)[1].line, 'more than one H1 title', 'Keep one "# Title"; use "##" for sections.');
      const nextHead = heads[1];
      const intro = body.slice(firstHead.index + 1, nextHead ? nextHead.index : body.length).some((line) => line.trim() !== '');
      if (!intro) add('sections', 'SKILL.md', firstHead.line, 'no intro sentence under the title', 'Add one or two sentences on what the skill makes true.');
    }
    let lastPos = -1;
    for (const title of S.sections) {
      const matches = h2.filter((head) => head.text.toLowerCase() === title.toLowerCase());
      if (matches.length === 0) {
        add('sections', 'SKILL.md', 0, `missing section "## ${title}"`, `Add the sections in this order: ${S.sections.join(', ')}.`);
        continue;
      }
      if (matches.length > 1) add('sections', 'SKILL.md', matches[1].line, `section "## ${title}" appears twice`, 'Merge the two sections.');
      const pos = h2.indexOf(matches[0]);
      if (pos < lastPos) add('sections', 'SKILL.md', matches[0].line, `section "## ${title}" is out of order`, `Order the sections: ${S.sections.join(', ')}.`);
      lastPos = Math.max(lastPos, pos);
    }
    if (h2.length > 0 && h2[0].text.toLowerCase() !== firstSection.toLowerCase() && h2.some((head) => head.text.toLowerCase() === firstSection.toLowerCase())) {
      add('sections', 'SKILL.md', h2[0].line, `"## ${h2[0].text}" comes before "## ${firstSection}"`, `Put "## ${firstSection}" first, right under the intro, so it survives compaction.`);
    }

    const rules = sectionLines(body, heads, S.sections[0]);
    if (rules && !rules.lines.some((line) => /^\d+\.\s+\S/.test(line))) add('section-format', 'SKILL.md', rules.head.line, `"${S.sections[0]}" has no numbered rules`, 'Write the rules as "1. **Rule.** Why it matters."');
    const workflow = sectionLines(body, heads, S.sections[1]);
    if (workflow && !workflow.lines.some((line) => /^\d+\.\s+\S/.test(line))) add('section-format', 'SKILL.md', workflow.head.line, `"${S.sections[1]}" has no numbered steps`, 'Write the workflow as numbered steps.');
    const dod = sectionLines(body, heads, S.sections[2]);
    if (dod) {
      const items = dod.lines.map((line, i) => ({ line, i })).filter(({ line }) => /^\s*- \[ \]\s+\S/.test(line));
      if (items.length === 0) add('section-format', 'SKILL.md', dod.head.line, `"${S.sections[2]}" has no "- [ ]" checklist items`, 'Write each done condition as "- [ ] ...".');
      const endIndex = dod.firstIndex + dod.lines.length;
      const endChar = fm.lines.slice(0, offset + endIndex).join('\n').length;
      if (endChar > S.dodLimit) add('dod-position', 'SKILL.md', dod.head.line, `the ${S.sections[2]} ends at character ${endChar}; only about the first ${S.dodLimit} survive compaction`, 'Shorten the intro, rules and workflow, and move detail into references/.');
      if (checkerScripts.length > 0 && items.length > 0) {
        const last = items.at(-1).line;
        if (!last.includes('${CLAUDE_SKILL_DIR}/scripts/') || !last.includes('RESULT: PASS')) {
          add('dod-script', 'SKILL.md', dod.head.line + 1 + items.at(-1).i, 'the last done item is not a skill script run that must print RESULT: PASS', 'End with "- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/<check>.mjs <args>` prints `RESULT: PASS`".');
        }
      }
    }
    const filesSection = sectionLines(body, heads, S.sections[4]);
    let listed = [];
    if (filesSection) {
      const rows = tableRows(filesSection.lines);
      const header = rows[0]?.map((cell) => cell.toLowerCase());
      const [fileCell, whatCell, whenCell] = S.filesHeader;
      if (!header || header[0] !== fileCell || header[1] !== whatCell || !(header[2] ?? '').startsWith(whenCell)) {
        add('section-format', 'SKILL.md', filesSection.head.line, `the Files table header is not "| ${S.raw.skillMd.filesTableHeader.join(' | ')} |"`, 'Use exactly that header row.');
      }
      listed = rows.slice(1).filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell))).map((cells) => ({ path: cellPath(cells[0] ?? ''), line: 0 }));
      filesSection.lines.forEach((line, i) => {
        const cells = /^\s*\|/.test(line) ? line.trim().replace(/^\|/, '').split('|') : null;
        if (!cells) return;
        const path = cellPath(cells[0].trim());
        const item = listed.find((entry) => entry.path === path && entry.line === 0);
        if (item) item.line = filesSection.head.line + 1 + i;
      });
    }
    const related = sectionLines(body, heads, S.sections[5]);
    if (related && !related.lines.some((line) => /^\s*- \S/.test(line))) add('section-format', 'SKILL.md', related.head.line, `"${S.sections[5]}" has no list items`, 'List related skills as "- `name` - when to hand off", or "- None".');

    // files-listed / files-exist
    const normalized = listed.map((entry) => ({ ...entry, rel: normalizeRel(entry.path) }));
    for (const entry of normalized) {
      if (!entry.path) continue;
      const isDirRow = entry.path.endsWith('/');
      const abs = join(dir, entry.rel);
      if (!existsSync(abs) || (isDirRow && !statSync(abs).isDirectory())) add('files-exist', 'SKILL.md', entry.line, `the Files table lists ${entry.path}, which does not exist`, 'Remove the row or add the file.');
    }
    for (const rel of files) {
      if (rel === 'SKILL.md') continue;
      const covered = normalized.some((entry) => entry.rel === rel || (entry.path.endsWith('/') && rel.startsWith(`${entry.rel.replace(/\/$/, '')}/`)));
      if (!covered) addCapped('files-listed', rel, 0, 'is not listed in the "Files in this skill" table', `Add a row: | \`${rel}\` | what it is | when to read or run it |`);
    }
  }

  // ---- markdown links, ToC, shouting ----
  for (const rel of files.filter((path) => path.endsWith('.md') && !path.startsWith('tests/'))) {
    const text = readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
    const prose = proseLines(text);
    prose.forEach((line, i) => {
      const targets = [];
      for (const match of line.matchAll(/!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) targets.push(match[1]);
      const refDef = /^\s*\[[^\]]+\]:\s*(\S+)/.exec(line);
      if (refDef) targets.push(refDef[1]);
      for (const raw of targets) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
        let clean = raw.replace(/[#?].*$/, '');
        try {
          clean = decodeURIComponent(clean);
        } catch {
          // keep the raw text
        }
        if (clean === '') continue;
        const base = clean.startsWith('${CLAUDE_SKILL_DIR}/') ? dir : dirname(join(dir, rel));
        const abs = resolve(base, clean.replace(/^\$\{CLAUDE_SKILL_DIR\}\//, ''));
        const inside = abs === dir || abs.startsWith(`${dir}/`);
        let real = abs;
        try {
          real = realpathSync(abs);
        } catch {
          real = abs;
        }
        const realDir = realpathSync(dir);
        if (!inside || !(real === realDir || real.startsWith(`${realDir}/`))) add('link-resolve', rel, i + 1, `link "${raw}" points outside the skill`, 'Copy the content into this skill and link the copy.');
        else if (!existsSync(abs)) add('link-resolve', rel, i + 1, `link "${raw}" does not resolve to a file in the skill`, 'Fix the path or add the file.');
      }
      if (S.shouting.test(line)) add('no-shouting', rel, i + 1, `shouting "${S.shouting.exec(line)[0]}"`, 'Write calmly and explain why; use bold for emphasis sparingly.');
    });
    // ${CLAUDE_SKILL_DIR} paths anywhere in the file, code included.
    text.split('\n').forEach((line, i) => {
      for (const match of line.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9_.\/-]+)/g)) {
        const path = match[1].replace(/[.,;:]+$/, '');
        if (/[*<]/.test(line.slice(match.index + match[0].length, match.index + match[0].length + 1)) || path.endsWith('/')) continue;
        if (!existsSync(join(dir, path))) add('link-resolve', rel, i + 1, `\${CLAUDE_SKILL_DIR}/${path} does not exist in the skill`, 'Fix the path or add the file.');
      }
    });
    if (rel.startsWith('references/')) {
      const count = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
      if (count > S.tocThreshold) {
        const head = text.split('\n').slice(0, 40);
        const tocAt = head.findIndex((line) => /^(#{1,3}\s*)?(\*\*)?(table of )?contents(\*\*)?:?\s*$/i.test(line.trim()));
        const items = tocAt === -1 ? 0 : head.slice(tocAt + 1).filter((line) => /^\s*([-*]|\d+\.)\s+\S/.test(line)).length;
        if (tocAt === -1 || items < 2) add('ref-toc', rel, 1, `${count} lines and no table of contents near the top`, 'Add "## Contents" with a list of the sections right after the title.');
      }
    }
  }

  // ---- project references and runtime variables (everything but tests/: fixtures plant them on purpose) ----
  for (const rel of files.filter((path) => !path.startsWith('tests/'))) {
    const abs = join(dir, rel);
    if (statSync(abs).size > S.fixtures.budget.fileMaxBytes * 4 || looksBinary(abs)) continue;
    const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const isMd = rel.endsWith('.md');
    const isScript = rel.startsWith('scripts/');
    const prose = isMd ? proseLines(text) : null;
    text.split('\n').forEach((line, i) => {
      const refs = findProjectRefs(line, { script: isScript }, S);
      if (isMd) refs.push(...findProjectRefs(prose[i], { markdownProse: true }, S).filter((ref) => ref.what.startsWith(`a "${S.mdParent}"`)));
      const seen = new Set();
      for (const ref of refs) {
        if (seen.has(ref.what)) continue;
        seen.add(ref.what);
        add('no-project-ref', rel, i + 1, `refers to ${ref.what}`, 'Copy what the skill needs into this skill (references/ or assets/) and refer to the copy; name other skills only by name.');
      }
      for (const hit of findRuntimeEnv(line, { script: isScript && rel.endsWith('.mjs') }, S)) {
        add('no-runtime-env', rel, i + 1, `uses ${hit.what}`, 'Use ${CLAUDE_SKILL_DIR} (the folder of this SKILL.md) in markdown, import.meta.url in scripts, and take the repo root as the positional argument (default ".").');
      }
    });
  }

  // ---- device-explicit calls (SKILL.md, references, examples, templates' docs and scripts) ----
  for (const rel of files.filter((path) => !path.startsWith('tests/') && !path.startsWith('assets/') && (path.endsWith('.md') || /\.sh$/.test(path) || (path.startsWith('scripts/') && /\.mjs$/.test(path) && path !== 'scripts/check-lib.mjs')))) {
    const abs = join(dir, rel);
    if (looksBinary(abs)) continue;
    const kind = rel.endsWith('.md') ? 'md' : 'script';
    for (const hit of findImplicitDeviceCalls(readFileSync(abs, 'utf8'), { kind }, S)) add('device-explicit', rel, hit.line, hit.what, hit.fix);
  }

  // ---- scripts ----
  const packageJsonPath = join(dir, 'scripts', 'package.json');
  let pinned = {};
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      pinned = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [name, version] of Object.entries(pinned)) {
        if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) add('script-deps', 'scripts/package.json', 0, `${name} is pinned as "${version}", not an exact version`, 'Pin an exact version such as "1.2.3".');
      }
    } catch (error) {
      add('script-deps', 'scripts/package.json', 0, `not valid JSON: ${error.message}`, 'Fix the JSON.');
    }
  }
  for (const rel of files.filter((path) => path.startsWith('scripts/'))) {
    const isTopLevel = /^scripts\/[^/]+$/.test(rel);
    if (isTopLevel && !S.scriptsExt.some((ext) => rel.endsWith(ext)) && !S.scriptsAllowed.has(rel)) {
      add('script-lib', rel, 0, 'scripts are Node ESM .mjs files', 'Rewrite it as a .mjs script that uses check-lib (helpers go in scripts/lib/).');
    }
    if (!rel.endsWith('.mjs') || rel === 'scripts/check-lib.mjs') continue;
    const source = readFileSync(join(dir, rel), 'utf8');
    for (const { spec, index, dynamic } of importSpecifiers(source)) {
      if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue;
      const line = lineAt(source, index);
      const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (S.builtins.has(spec) || S.builtins.has(root)) add('script-deps', rel, line, `imports "${spec}" without the node: prefix`, `Import "node:${spec}".`);
      else if (!(root in pinned)) add('script-deps', rel, line, `imports the package "${spec}", which scripts/package.json does not pin`, 'Use node: built-ins only, or pin the package in scripts/package.json and load it with check-lib\'s importPackage from the --tooling folder.');
      else if (!dynamic) add('script-deps', rel, line, `imports the package "${spec}" statically, so --help fails before the packages are installed`, `Load it inside main() with await import('${spec}') (or importPackage) and exit 2 with the install command when it is missing.`);
    }
    if (!isTopLevel) continue;
    if (!/from\s+['"]\.\/check-lib\.mjs['"]/.test(source)) add('script-lib', rel, 1, 'does not import ./check-lib.mjs', 'Import parseArgs, walk, createReporter and run from ./check-lib.mjs.');
    else if (rel === 'scripts/selftest.mjs' && !/\brunSelftest\b/.test(source)) add('script-lib', rel, 1, 'selftest.mjs does not use runSelftest', 'Call runSelftest(import.meta.url, [...]) from ./check-lib.mjs.');
  }
  if (runScripts) {
    for (const rel of entryScripts) {
      const abs = join(dir, rel);
      const help = runScript(abs, ['--help'], S.timeoutMs);
      if (help.timedOut || help.status !== 0 || !/Usage:/.test(help.stdout)) {
        const said = lastLine(help.output).slice(0, 160);
        add('script-help', rel, 0, `--help ${help.timedOut ? 'timed out' : `exited ${help.status}`}${/Usage:/.test(help.stdout) ? '' : ' without a "Usage:" line'}${said ? ` (last output: ${said})` : ''}`, 'Parse arguments with parseArgs() from check-lib so --help prints usage and exits 0.');
      }
      if (rel === 'scripts/selftest.mjs') continue;
      const bare = runScript(abs, [], S.timeoutMs);
      const final = lastLine(bare.stdout);
      if (bare.timedOut || ![0, 1, 2].includes(bare.status) || !RESULT_PATTERN.test(final)) {
        add('script-result', rel, 0, `run with no arguments in an empty folder: ${bare.timedOut ? 'timed out' : `exit ${bare.status}`}, last line "${final.slice(0, 120)}"`, 'Wrap main() in run() and finish with report.finish(); a missing target must exit 2 with the RESULT line.');
      }
    }
  }
  if (checkerScripts.length > 0 || entryScripts.includes('scripts/selftest.mjs')) {
    if (!files.includes('scripts/selftest.mjs')) add('selftest-missing', 'scripts/', 0, 'the skill has scripts but no scripts/selftest.mjs', 'Add scripts/selftest.mjs that calls runSelftest() on tests/fixtures.');
    else fixtureProblems(dir, S, files).forEach(([file, message, fix]) => add('fixtures', file, 0, message, fix));
  }

  // ---- shared files ----
  const manifest = readManifest(dir, roots.shared);
  for (const error of manifest.errors) add('shared-json', 'assets/shared.json', 0, error, 'Use [{ "from": "<path in the shared folder>", "to": "<path in this skill>" }].');
  if (manifest.errors.length === 0) {
    for (const finding of compareShared(dir, manifest.entries, roots.shared)) {
      const message = finding.kind === 'missing' ? `missing copy of shared ${finding.from}` : finding.kind === 'drift' ? `differs from the canonical shared ${finding.from}` : `is not in the shared folder ${finding.from}`;
      add('shared-drift', finding.rel, 0, message, 'Run: node tools/sync-shared.mjs');
    }
    const declared = new Set(manifest.entries.filter((entry) => !entry.isDir).map((entry) => entry.to));
    const importsLib = entryScripts.some((rel) => /from\s+['"]\.\/check-lib\.mjs['"]/.test(readFileSync(join(dir, rel), 'utf8')));
    if ((files.includes('scripts/check-lib.mjs') || importsLib) && !declared.has('scripts/check-lib.mjs')) {
      add('shared-undeclared', 'scripts/check-lib.mjs', 0, 'check-lib.mjs is used but not declared in assets/shared.json', 'Add { "from": "scripts/check-lib.mjs", "to": "scripts/check-lib.mjs" } to assets/shared.json, then run node tools/sync-shared.mjs.');
    }
  }
  return finish();
}

/**
 * The self-test fixtures: suites in tests/fixtures/ itself or in tests/fixtures/<suite>/, each with at
 * least one bad-* case and a good/ case or a declared base (tests/bases/, or a "base" in selftest.mjs).
 * A case is either a whole tree or an overlay (EXPECT.txt plus mutation.json, DELETE.txt and overlay/,
 * EXPECT.txt alone with its ops and args in the suite's CASES.json, or one CASES.json entry with "expect").
 * Returns [[file, message, fix]].
 */
function fixtureProblems(dir, S, files) {
  const out = [];
  const fixturesDir = join(dir, 'tests', 'fixtures');
  const childDirs = (abs) => (existsSync(abs) ? readdirSync(abs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []);
  if (!existsSync(fixturesDir)) return [['tests/fixtures/', 'missing: the self-test has no fixtures', 'Add tests/fixtures/ with good/ (or a base) and one bad-* case per rule.']];
  const isCase = (name) => caseKindOf(name, S) !== null;
  // Cases that live only in a suite's CASES.json (their EXPECT.txt lines inline as "expect"): name -> expect.
  const inlineCases = (suiteAbs) => {
    try {
      const data = JSON.parse(readFileSync(join(suiteAbs, S.fixtures.casesFile ?? 'CASES.json'), 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
      return Object.fromEntries(Object.entries(data).filter(([name, entry]) => name !== '$comment' && isCase(name) && entry && typeof entry === 'object' && !Array.isArray(entry) && entry.expect !== undefined).map(([name, entry]) => [name, entry.expect]));
    } catch {
      return {};
    }
  };
  const holdsCases = (abs) => childDirs(abs).some(isCase) || Object.keys(inlineCases(abs)).length > 0;
  const suites = [];
  if (holdsCases(fixturesDir)) suites.push('');
  for (const name of childDirs(fixturesDir).filter((item) => !isCase(item))) if (holdsCases(join(fixturesDir, name))) suites.push(name);
  if (suites.length === 0) return [['tests/fixtures/', 'holds no suite (no good/, bad-*/, pass-*/ or error-*/ case folders)', 'Add the cases directly in tests/fixtures/ or in tests/fixtures/<checker>/.']];
  const selftestSource = files.includes('scripts/selftest.mjs') ? readFileSync(join(dir, 'scripts', 'selftest.mjs'), 'utf8') : '';
  // A base tree: tests/bases/, a base/ folder in the suite, or a selftest.mjs that assembles cases.
  const skillBase = existsSync(join(dir, ...S.fixtures.basesDir.split('/'))) || /\bbase\b|\bassemble/i.test(selftestSource);
  for (const suite of suites) {
    const suiteRel = posix.join('tests/fixtures', suite);
    const names = childDirs(join(fixturesDir, suite));
    const inline = inlineCases(join(fixturesDir, suite));
    const cases = [...new Set([...names.filter(isCase), ...Object.keys(inline)])].sort();
    if (!cases.some((name) => caseKindOf(name, S) === 'bad-')) out.push([`${suiteRel}/`, 'the suite has no bad-* case', 'Add one bad-<case>/ per rule, each planting exactly one bug.']);
    const suiteFile = join(fixturesDir, suite, S.fixtures.suiteFile);
    if (existsSync(suiteFile)) {
      let spec = null;
      try {
        spec = JSON.parse(readFileSync(suiteFile, 'utf8'));
      } catch (error) {
        out.push([`${suiteRel}/${S.fixtures.suiteFile}`, `not valid JSON: ${error.message}`, 'Fix the JSON (keys: base, extends, ops, argsFile, renames).']);
      }
      if (spec !== null && (typeof spec !== 'object' || Array.isArray(spec))) out.push([`${suiteRel}/${S.fixtures.suiteFile}`, 'must hold one object', 'Write { "base": "<folder>" } or the other suite keys.']);
    }
    const casesFile = join(fixturesDir, suite, S.fixtures.casesFile);
    if (existsSync(casesFile)) {
      const casesRel = `${suiteRel}/${S.fixtures.casesFile}`;
      const opsFix = `Write { "<case>": [ops] } or { "<case>": { "ops": [...], "args": "..." } }; ops are ${[...S.fixtures.mutationOps].join(', ')}.`;
      let packed = null;
      try {
        packed = JSON.parse(readFileSync(casesFile, 'utf8'));
      } catch (error) {
        out.push([casesRel, `not valid JSON: ${error.message}`, opsFix]);
      }
      if (packed !== null && (typeof packed !== 'object' || Array.isArray(packed))) out.push([casesRel, 'must hold one object keyed by case name', opsFix]);
      else if (packed !== null) {
        for (const [name, entry] of Object.entries(packed)) {
          if (name === '$comment') continue;
          if (!cases.includes(name)) out.push([casesRel, `"${name}" is not a case folder of this suite and has no "expect"`, 'Each key names a case folder that keeps its EXPECT.txt, or carries the EXPECT.txt lines as "expect"; remove the stale entry, add the folder or add "expect".']);
          else if (existsSync(join(fixturesDir, suite, name, 'mutation.json'))) out.push([casesRel, `"${name}" also has its own mutation.json`, 'Keep the ops in one place.']);
          const ops = Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? entry.ops ?? [] : null;
          if (ops === null) out.push([casesRel, `"${name}" is neither a list of ops nor an object`, opsFix]);
          else for (const message of mutationProblems(JSON.stringify(ops), S)) out.push([casesRel, `"${name}": ${message}`, opsFix]);
        }
      }
    }
    if (!cases.includes('good') && !skillBase && !names.includes('base') && !existsSync(suiteFile)) out.push([`${suiteRel}/`, `the suite has no good/ case and declares no base tree (${S.fixtures.basesDir}/, a base/ folder, ${S.fixtures.suiteFile}, or a base in selftest.mjs)`, 'Add good/, or a base tree the overlay cases are assembled from.']);
    for (const name of cases) {
      const caseRel = `${suiteRel}/${name}`;
      const caseDir = join(fixturesDir, suite, name);
      if (name in inline) {
        const text = typeof inline[name] === 'string' ? inline[name] : Array.isArray(inline[name]) && inline[name].every((line) => typeof line === 'string') ? inline[name].join('\n') : null;
        if (text === null || (caseKindOf(name, S) !== 'good' && text.trim() === '')) out.push([`${suiteRel}/${S.fixtures.casesFile ?? 'CASES.json'}`, `"${name}" "expect" is empty or not a list of lines`, 'Write what the checker must print for this case (the rule id and file:line, the SKIP line, or the ERROR text), one line per item.']);
        if (existsSync(join(caseDir, S.fixtures.expectFile))) out.push([`${caseRel}/${S.fixtures.expectFile}`, `the case also has "expect" in the suite's ${S.fixtures.casesFile ?? 'CASES.json'}`, 'Keep the expected lines in one place.']);
      } else if (caseKindOf(name, S) !== 'good') {
        const expect = join(caseDir, S.fixtures.expectFile);
        if (!existsSync(expect) || readFileSync(expect, 'utf8').trim() === '') out.push([`${caseRel}/${S.fixtures.expectFile}`, 'missing or empty', 'Write what the checker must print for this case (the rule id and file:line, the SKIP line, or the ERROR text), one per line.']);
      }
      const mutation = join(caseDir, 'mutation.json');
      if (existsSync(mutation)) for (const message of mutationProblems(readFileSync(mutation, 'utf8'), S)) out.push([`${caseRel}/mutation.json`, message, `Write an ordered list of ops: ${[...S.fixtures.mutationOps].join(', ')} (for example [{ "replace": { "file": "a.ts", "find": "x", "with": "y" } }]).`]);
      const deleteFile = join(caseDir, 'DELETE.txt');
      if (existsSync(deleteFile)) {
        const paths = readFileSync(deleteFile, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
        if (paths.length === 0) out.push([`${caseRel}/DELETE.txt`, 'lists no paths', 'List one base-relative path per line, or delete the file.']);
        for (const path of paths.filter((item) => item.startsWith('/') || item.split('/').includes('..'))) out.push([`${caseRel}/DELETE.txt`, `"${path}" leaves the case folder`, 'Use paths relative to the base tree, without "..".']);
      }
      const overlay = join(caseDir, S.fixtures.overlayDir);
      if (existsSync(overlay) && !statSync(overlay).isDirectory()) out.push([`${caseRel}/${S.fixtures.overlayDir}`, 'is a file; the overlay is a folder of files laid over the base', `Make ${S.fixtures.overlayDir}/ a folder.`]);
    }
  }
  return out;
}

/** The skills folder holds only skill folders (every folder in it is validated as a skill). */
export function libraryLayout(roots) {
  const problems = [];
  for (const entry of readdirSync(roots.skillsRoot, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue; // check-repo-hygiene reports it
    const abs = join(roots.skillsRoot, entry.name);
    const stat = lstatSync(abs);
    const add = (message, fix) => problems.push({ rule: 'library-layout', file: entry.name, line: 0, message, fix });
    if (stat.isSymbolicLink()) add('is a symlink inside the skills folder', 'Keep real skill folders here; a symlink is copied as a link or dereferenced unpredictably by installers.');
    else if (!stat.isDirectory()) add(`stray file in the skills folder (it holds only skill folders${entry.name === 'README.md' ? '; the catalogue is the repo README.md, generated by tools/build-catalog.mjs' : ''})`, 'Move it out of skills/: tooling to tools/, documentation to the repo root or docs/.');
    else if (/^[_.]/.test(entry.name)) add('folder names starting with "_" or "." are not skill names (the maintainer tooling lives in tools/)', 'Move it to tools/ or rename it to the skill\'s kebab-case name.');
    // A folder without SKILL.md is validated as a skill and fails skill-md there.
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const SPEC = {
  name: 'validate-skills',
  summary: 'Validates skills against the skill standard (CONTRIBUTING.md; constants in tools/standard.json). With no arguments it checks every folder in the skills root and the layout of the skills root itself.',
  usage: '[options] [skill-name-or-path...]',
  options: {
    ...COMMON_OPTIONS,
    standard: { type: 'string', value: 'file', help: 'Standard constants file (default: tools/standard.json)' },
    'no-run': { type: 'boolean', help: 'Skip running the skill scripts (--help and no-argument runs)' },
    rule: { type: 'string', multiple: true, value: 'id', help: 'Report only this rule (comma-separated ids allowed)' },
    summary: { type: 'boolean', help: 'Print one line per skill and the problem count per rule instead of every problem' },
    json: { type: 'boolean', help: 'Also print the results as one JSON line before the RESULT line' },
  },
  positionals: { min: 0, max: Infinity },
  details: `Rules:\n${Object.entries(RULES).map(([id, text]) => `  ${id.padEnd(22)} ${text}`).join('\n')}\n\nA skill that fails the newer rules (fixture-hygiene, fixture-budget, no-runtime-env, ...) is the progress meter of a library still being generalized: run with --summary to track it.`,
};

/** Description statistics for --summary: average length and the listing estimate. */
function descriptionStats(targets, std) {
  const lengths = [];
  let listing = 0;
  for (const target of targets) {
    const path = join(target.dir, 'SKILL.md');
    if (!existsSync(path)) continue;
    const fm = splitFrontmatter(readFileSync(path, 'utf8'));
    if (!fm.closed) continue;
    const { data } = parseYamlSubset(fm.yaml);
    if (typeof data.description !== 'string') continue;
    lengths.push(data.description.length);
    if (String(data[std.frontmatter.runbook.key]) !== String(std.frontmatter.runbook.value)) listing += String(data.name ?? target.name).length + data.description.length + (std.listing?.perEntryOverheadChars ?? 4);
  }
  return { count: lengths.length, average: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0, longest: Math.max(0, ...lengths), listing };
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const roots = resolveRoots(options);
  const std = loadStandard(options.standard ?? STANDARD_PATH);
  const S = options.standard ? compileStandard(std) : DEFAULT_STANDARD;
  const ruleFilter = new Set(options.rule.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean));
  for (const id of ruleFilter) if (!(id in RULES)) throw new UsageError(`unknown rule "${id}"`, `Use one of: ${Object.keys(RULES).join(', ')}.`);
  const wants = (rule) => ruleFilter.size === 0 || ruleFilter.has(rule);
  const runScripts = !options['no-run'] && (wants('script-help') || wants('script-result'));
  const targets = positionals.length ? resolveTargets(positionals, roots) : defaultTargets(roots);
  const report = createReporter({ name: 'validate-skills' });
  const results = [];
  const quiet = options.summary;
  if (positionals.length === 0 && wants('library-layout')) {
    const layout = libraryLayout(roots);
    for (const problem of layout) report.problem(problem);
    if (layout.length) {
      console.log(`FAIL  skills folder layout (${layout.length} problems)`);
      if (!quiet) for (const problem of layout) console.log(`      ${formatProblem(problem)}`);
    }
    results.push({ skill: '(skills folder)', dir: roots.skillsRoot, problems: layout });
  }
  for (const target of targets) {
    const problems = validateSkill(target, roots, { runScripts, standard: S }).filter((problem) => wants(problem.rule));
    results.push({ skill: targetLabel(target), dir: target.dir, problems });
    const label = targetLabel(target);
    if (problems.length === 0) console.log(`PASS  ${label}`);
    else {
      console.log(`FAIL  ${label} (${problems.length} problems)`);
      if (!quiet) for (const problem of problems) console.log(`      ${formatProblem(problem)}`);
    }
    for (const problem of problems) report.problem(problem);
  }
  const byRule = {};
  for (const result of results) {
    for (const problem of result.problems) {
      byRule[problem.rule] ??= { problems: 0, skills: new Set() };
      byRule[problem.rule].problems += 1;
      byRule[problem.rule].skills.add(result.skill);
    }
  }
  if (options.summary) {
    console.log('');
    console.log(`${'RULE'.padEnd(22)}  PROBLEMS  SKILLS`);
    for (const id of Object.keys(RULES).filter((rule) => wants(rule))) {
      const entry = byRule[id];
      console.log(`${id.padEnd(22)}  ${String(entry?.problems ?? 0).padStart(8)}  ${String(entry?.skills.size ?? 0).padStart(6)}`);
    }
    const stats = descriptionStats(targets, std);
    console.log('');
    console.log(`descriptions: ${stats.count} read, average ${stats.average} characters (target ${std.description.targetChars}, limit ${std.description.maxChars}), longest ${stats.longest}; listing estimate ${stats.listing} characters (set budget ${std.listing?.setBudgetChars ?? 'n/a'})`);
  }
  const total = report.count;
  const skillResults = results.filter((result) => result.skill !== '(skills folder)');
  console.log(`validate-skills: ${targets.length} skills checked, ${skillResults.filter((result) => result.problems.length === 0).length} passed, ${total} problems`);
  if (options.json) {
    const rules = Object.fromEntries(Object.entries(byRule).map(([id, entry]) => [id, { problems: entry.problems, skills: entry.skills.size }]));
    console.log(JSON.stringify({ skills: skillResults, layout: results.find((result) => result.skill === '(skills folder)')?.problems ?? [], byRule: rules, problems: total }));
  }
  if (targets.length === 0) {
    console.log('ERROR [bad-input] nothing to check: no skill folders found Fix: pass a skill name or path, or --skills-root <dir>.');
    console.log(resultLine(1));
    return 2;
  }
  console.log(resultLine(total));
  return total === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(main);
