// repo-facts.mjs: the facts about an app repo the EAS checkers read as text (a helper, not an entry
// point): the app config's version, build numbers, project link and production id; package.json;
// the Node pin files; and every `eas build` / `eas submit` command written in package.json scripts,
// shell scripts and CI workflow files.
//
//   findAppConfig(root, appRel)        repo-relative path of app.config.{ts,js,mjs,cjs} or app.json, or null
//   appConfigFacts(text, rel)          { version, versionLine, buildNumberLine, versionCodeLine, projectId, appId }
//   readPackage(root, rel)             parsed package.json or null (malformed is bad input)
//   nodePin(root, appRel)              { rel, version } from .nvmrc or .node-version, or null
//   easCommands(root, appRel, pkg)     [{ file, line, sub, args, flags, ci, before, viaNpx, job }]: one entry per
//                                      command, and one per EAS Workflows `type: build` / `type: submit` job
//   yamlRunSegments(text)              the `run:` values of a workflow file as shell text with source lines
//   easWorkflowJobs(text, rel)         the pre-packaged build and submit jobs of an .eas/workflows file as commands
//   compareVersions(a, b)              -1 | 0 | 1 for x.y.z strings (missing parts count as 0)
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { UsageError, maskComments, walkRepo } from '../check-lib.mjs';

const CONFIG_FILES = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

export function findAppConfig(root, appRel) {
  for (const name of CONFIG_FILES) {
    const rel = posix.join(appRel, name);
    if (existsSync(join(root, rel))) return rel;
  }
  return null;
}

const lineAt = (text, index) => (index < 0 ? 0 : text.slice(0, index).split('\n').length);

function firstMatch(code, regex) {
  const match = regex.exec(code);
  return match ? { value: match[2] ?? match[1] ?? '', line: lineAt(code, match.index) } : null;
}

/** Facts read from the app config text (comments masked, so a commented example never counts). */
export function appConfigFacts(text, rel) {
  if (rel.endsWith('.json')) return jsonConfigFacts(text, rel);
  const code = maskComments(text);
  // `version: APP_VERSION` with `const APP_VERSION = 'x.y.z';` counts as the literal (the local iOS
  // lane's shape, which ios-release-testflight and design-review-workflow read too).
  const version =
    firstMatch(code, /(?<![\w$.])version\s*:\s*(['"`])([^'"`]*)\1/) ??
    (/(?<![\w$.'"])version\s*:\s*APP_VERSION\b/.test(code) ? firstMatch(code, /\bconst\s+APP_VERSION\s*=\s*(['"`])([^'"`]*)\1/) : null);
  const versionExpr = version ? null : firstMatch(code, /(?<![\w$.'"])version\s*:\s*([^,\n}]+)/);
  const buildNumber = firstMatch(code, /(?<![\w$.])['"]?buildNumber['"]?\s*:/);
  const versionCode = firstMatch(code, /(?<![\w$.])['"]?versionCode['"]?\s*:/);
  const appId =
    firstMatch(code, /(?<![\w$.])appId\s*:\s*(['"])([^'"]+)\1/) ??
    firstMatch(code, /(?<![\w$.])bundleIdentifier\s*:\s*(['"])([^'"]+)\1/) ??
    firstMatch(code, /(?<![\w$.])package\s*:\s*(['"])([^'"]+)\1/);
  return {
    version: version?.value ?? null,
    versionLine: version?.line ?? versionExpr?.line ?? 0,
    versionExpression: versionExpr ? versionExpr.value.trim() : null,
    buildNumberLine: buildNumber?.line ?? 0,
    versionCodeLine: versionCode?.line ?? 0,
    projectId: /\beas\s*:\s*\{[^}]*\bprojectId\s*:/s.test(code),
    appId: appId?.value ?? null,
  };
}

function jsonConfigFacts(text, rel) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, `Fix the JSON syntax of ${rel}.`);
  }
  const expo = data?.expo ?? data ?? {};
  const line = (key) => lineAt(text, text.indexOf(`"${key}"`));
  return {
    version: typeof expo.version === 'string' ? expo.version : null,
    versionLine: line('version'),
    versionExpression: null,
    buildNumberLine: expo.ios?.buildNumber !== undefined ? line('buildNumber') : 0,
    versionCodeLine: expo.android?.versionCode !== undefined ? line('versionCode') : 0,
    projectId: typeof expo.extra?.eas?.projectId === 'string',
    appId: expo.ios?.bundleIdentifier ?? expo.android?.package ?? null,
  };
}

export function readPackage(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`${rel} is not valid JSON: ${error.message}`, `Fix ${rel}.`);
  }
}

export function nodePin(root, appRel) {
  for (const dir of [...new Set([appRel, '.'])]) {
    for (const name of ['.nvmrc', '.node-version']) {
      const rel = posix.join(dir, name);
      if (!existsSync(join(root, rel))) continue;
      const version = readFileSync(join(root, rel), 'utf8').trim().replace(/^v/, '');
      return { rel, version };
    }
  }
  return null;
}

export function compareVersions(a, b) {
  const pa = String(a).replace(/^[v=]/, '').split(/[.+-]/).slice(0, 3).map(Number);
  const pb = String(b).replace(/^[v=]/, '').split(/[.+-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// eas build / eas submit commands. Shell text is tokenised the way a shell splits words: a quoted
// string is one token (quotes stripped), and a command ends at an unquoted ; & | ( ) or newline; a #
// at the start of a word begins a comment. Workflow files contribute only their `run:` values (inline,
// literal | and folded > blocks), so a step `name: eas build (production)` or a YAML comment is never a
// command, and a gate written only in a comment never counts. Limits (references/
// build-and-submit-runbook.md, "What the command checks read"): a command hidden inside a quoted
// `sh -c '...'`, an npm script that calls another script, and here-documents are not followed.

/** The tools that may stand in front of `eas` in command position. */
const PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=.*|npx|--yes|-y|exec|command|time)$/;
const EAS = /^(?:eas|eas-cli(?:@\S+)?)$/;

/**
 * Commands of a shell text: [{ words: [{ value, start, end }] }], where start/end index the text.
 * \u0001 marks a joined line continuation and counts as blank.
 */
function shellCommands(text) {
  const commands = [];
  let words = [];
  let word = null;
  const endWord = (at) => {
    if (word !== null) words.push({ ...word, end: at });
    word = null;
  };
  const endCommand = (at) => {
    endWord(at);
    if (words.length > 0) commands.push({ words });
    words = [];
  };
  const add = (char, at) => {
    if (word === null) word = { value: '', start: at };
    word.value += char;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '\n') {
      endWord(i);
      i += 1;
    } else if (char === '\\' && i + 1 < text.length) {
      add(text[i + 1], i);
      i += 1;
    } else if (char === "'" || char === '"') {
      if (word === null) word = { value: '', start: i };
      let j = i + 1;
      while (j < text.length && text[j] !== char) {
        if (char === '"' && text[j] === '\\' && j + 1 < text.length) j += 1;
        word.value += text[j];
        j += 1;
      }
      i = j;
    } else if (char === '$' && text[i + 1] === '(') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')' && --depth === 0) break;
      }
      add(text.slice(i, j + 1), i);
      i = j;
    } else if (char === '#' && word === null) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1;
    } else if (/[;&|()\n]/.test(char)) {
      endCommand(i);
    } else if (/[\s\u0001]/.test(char)) {
      endWord(i);
    } else {
      add(char, i);
    }
  }
  endCommand(text.length);
  return commands;
}

/** Where `eas build|submit` starts among the words of one command, or -1. */
function easIndex(words) {
  for (let i = 0; i < words.length - 1; i += 1) {
    if (EAS.test(words[i].value) && (words[i + 1].value === 'build' || words[i + 1].value === 'submit')) return i;
    if (!PREFIX.test(words[i].value)) return -1;
  }
  return -1;
}

/**
 * A gate command: npm run verify or the release preflight (in front of an eas build), and the record
 * check check-eas-build.mjs (the only gate in front of an eas submit: verify proves the code, never
 * what EAS built).
 */
function gateKind(words) {
  const values = words.map((entry) => entry.value).filter((value) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
  if (values[0] === 'npm' && values[1] === 'run' && values.slice(2).filter((value) => !value.startsWith('-'))[0] === 'verify') return 'verify';
  if (values[0] === 'node' && values.some((value) => /(?:^|\/)release-preflight\.ts$/.test(value))) return 'verify';
  if (values[0] === 'node' && values.some((value) => /(?:^|\/)check-eas-build\.mjs$/.test(value))) return 'record';
  return null;
}

/** Arguments with --flag=value split in two. */
function splitArgs(values) {
  return values.flatMap((token) => (token.startsWith('--') && token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token]));
}

function flagsOf(values) {
  const list = splitArgs(values);
  const valueOf = (...names) => {
    const index = list.findIndex((token) => names.includes(token));
    return index >= 0 && index + 1 < list.length ? list[index + 1] : null;
  };
  return {
    profile: valueOf('--profile', '-e'),
    platform: valueOf('--platform', '-p'),
    // -s and --submit are eas-cli's aliases of --auto-submit (build/index.js, 24.10.0 and 25.0.0)
    autoSubmit: ['--auto-submit', '--auto-submit-with-profile', '--submit', '-s'].some((flag) => list.includes(flag)),
    autoSubmitProfile: valueOf('--auto-submit-with-profile'),
    latest: list.includes('--latest'),
    nonInteractive: list.includes('--non-interactive'),
    local: list.includes('--local'),
    freezeCredentials: list.includes('--freeze-credentials'),
    id: valueOf('--id'),
  };
}

/**
 * Scans shell segments of one file in order: [{ text, lines }] where lines[i] is the source line of
 * text[i]. A gate in an earlier command of the same file counts for every later command.
 */
function scanSegments(segments, file, ci) {
  const found = [];
  const gates = new Set();
  for (const { text, lines } of segments) {
    for (const { words } of shellCommands(text)) {
      const at = easIndex(words);
      if (at < 0) {
        const kind = gateKind(words);
        if (kind) gates.add(kind);
        continue;
      }
      const sub = words[at + 1].value;
      const rest = words.slice(at + 2);
      const args = rest.length === 0 ? '' : text.slice(rest[0].start, rest.at(-1).end).replace(/\\\n|\u0001/g, ' ').replace(/\s+/g, ' ').trim();
      const before = sub === 'submit' ? gates.has('record') : gates.has('verify');
      const viaNpx = words.slice(0, at).some((entry) => entry.value === 'npx') || words[at].value.startsWith('eas-cli');
      found.push({ file, line: lines[words[at].start] ?? 0, sub, args, flags: flagsOf(rest.map((entry) => entry.value)), ci, before, viaNpx, job: null });
    }
  }
  return found;
}

/** A whole text as one segment, each character mapped to its 1-based line. */
function wholeText(text) {
  const lines = [];
  let line = 1;
  for (const char of text) {
    lines.push(line);
    if (char === '\n') line += 1;
  }
  return { text, lines };
}

/** A YAML scalar written inline after `run:` (plain, 'single' or "double" quoted). */
function inlineScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'")) return trimmed.slice(1, trimmed.lastIndexOf("'") > 0 ? trimmed.lastIndexOf("'") : undefined).replaceAll("''", "'");
  if (trimmed.startsWith('"')) return JSON.parse(trimmed.slice(0, trimmed.lastIndexOf('"') + 1) || '""');
  return trimmed.replace(/\s+#.*$/, '');
}

/** The `run:` values of a workflow file as shell segments (literal | keeps lines, folded > joins them). */
export function yamlRunSegments(text) {
  const source = text.split('\n');
  const segments = [];
  for (let i = 0; i < source.length; i += 1) {
    const match = /^(\s*)(-\s+)?run\s*:(.*)$/.exec(source[i]);
    if (!match) continue;
    const parentIndent = match[1].length + (match[2] ? match[2].length : 0);
    const value = match[3];
    const block = /^\s*([|>])[-+0-9]*\s*(?:#.*)?$/.exec(value);
    if (!block) {
      let scalar = '';
      try {
        scalar = inlineScalar(value);
      } catch {
        scalar = value.trim();
      }
      segments.push({ text: scalar, lines: Array.from(scalar, () => i + 1) });
      continue;
    }
    const folded = block[1] === '>';
    let text = '';
    const lines = [];
    let indent = null;
    let previous = null;
    for (let j = i + 1; j < source.length; j += 1) {
      const raw = source[j];
      if (raw.trim() === '') {
        text += '\n';
        lines.push(j + 1);
        previous = 'blank';
        continue;
      }
      const own = raw.length - raw.trimStart().length;
      if (own <= parentIndent || (indent !== null && own < indent)) break;
      indent ??= own;
      const content = raw.slice(indent);
      const more = own > indent;
      const joiner = text === '' || previous === 'blank' ? '' : folded && !more && previous === 'plain' ? ' ' : '\n';
      text += joiner + content;
      for (let k = 0; k < joiner.length + content.length; k += 1) lines.push(j + 1);
      previous = more ? 'more' : 'plain';
      i = j;
    }
    segments.push({ text, lines });
  }
  return segments;
}

// ---------------------------------------------------------------------------------------------
// EAS Workflows pre-packaged jobs. In .eas/workflows/*.yml a job with `type: build` or `type: submit`
// is an eas build / eas submit of its own (docs.expo.dev/eas/workflows/pre-packaged-jobs, read
// 2026-10-16): params.profile (absent means EAS's default, "production"), params.platform (build jobs;
// a submit job takes the platform of its build_id). Such a job is never interactive and never --local.
// Its gate is a job it depends on through `needs:` (directly or transitively; `after:` does not count,
// because it runs even when that job failed) whose run steps call npm run verify or the preflight (a
// build job) or check-eas-build.mjs (a submit job); a gate in the job's own hooks counts too, except
// after_submit.
// The reader is an indentation reader for the shapes the Workflows syntax uses (block and flow maps
// and lists of plain or quoted scalars), not a YAML parser: anchors, aliases and merge keys are not
// followed, and a profile written as an expression (${{ inputs.profile }}) is a name it cannot judge.

const YAML_KEY = /^(\s*)([A-Za-z0-9_.-]+|"[^"]*"|'[^']*')\s*:(?:\s+(.*?)|\s*)$/;

function yamlLines(text) {
  return text.split('\n').map((raw, index) => ({ raw, index, indent: raw.length - raw.trimStart().length, blank: raw.trim() === '' || raw.trimStart().startsWith('#') }));
}

/** A plain, 'single' or "double" quoted YAML scalar, comment stripped. */
function yamlScalar(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text.slice(0, text.lastIndexOf('"') + 1));
    } catch {
      return text.slice(1, text.lastIndexOf('"') > 0 ? text.lastIndexOf('"') : undefined);
    }
  }
  if (text.startsWith("'")) return text.slice(1, text.lastIndexOf("'") > 0 ? text.lastIndexOf("'") : undefined).replaceAll("''", "'");
  return text.replace(/(?:^|\s+)#.*$/, '').trim();
}

/** Direct child keys of lines[start, end): [{ key, value, line, start, end }], start/end bounding each child's own block. */
function yamlChildren(lines, start, end) {
  const out = [];
  let indent = null;
  let stop = end;
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (line.blank) continue;
    indent ??= line.indent;
    if (line.indent < indent) {
      stop = i;
      break;
    }
    if (line.indent > indent) continue;
    const match = YAML_KEY.exec(line.raw);
    if (!match) continue; // a list item at the key's indent belongs to the key above it
    if (out.length > 0) out.at(-1).end = i;
    out.push({ key: yamlScalar(match[2]), value: match[3] ?? '', line: i + 1, start: i + 1, end: stop });
  }
  if (out.length > 0) out.at(-1).end = Math.min(out.at(-1).end, stop);
  return out;
}

const isEmptyValue = (value) => yamlScalar(value) === '';

/** A list value: a flow list [a, b], a single scalar, or block items (- a). */
function yamlList(lines, entry) {
  const value = entry.value.trim();
  if (value.startsWith('[')) return value.slice(1, value.includes(']') ? value.indexOf(']') : undefined).split(',').map(yamlScalar).filter(Boolean);
  if (!isEmptyValue(value)) return [yamlScalar(value)];
  return lines.slice(entry.start, entry.end).filter((line) => !line.blank).map((line) => /^\s*-\s+(.*)$/.exec(line.raw)).filter(Boolean).map((match) => yamlScalar(match[1]));
}

/** A map of scalars: a flow map { a: 1, b: 2 } or block children. */
function yamlMap(lines, entry) {
  const value = entry.value.trim();
  const out = {};
  if (value.startsWith('{')) {
    for (const pair of value.slice(1, value.includes('}') ? value.lastIndexOf('}') : undefined).split(',')) {
      const at = pair.indexOf(':');
      if (at > 0) out[yamlScalar(pair.slice(0, at))] = yamlScalar(pair.slice(at + 1));
    }
    return out;
  }
  for (const child of yamlChildren(lines, entry.start, entry.end)) out[child.key] = isEmptyValue(child.value) ? null : yamlScalar(child.value);
  return out;
}

/** The gate kinds the run steps of lines[start, end) call (after_submit hooks blanked out first). */
function gatesIn(lines, start, end, skip) {
  const text = lines.slice(start, end).map((line) => (skip.some(([from, to]) => line.index >= from && line.index < to) ? '' : line.raw)).join('\n');
  const gates = new Set();
  for (const { text: shell } of yamlRunSegments(text)) {
    for (const { words } of shellCommands(shell)) {
      const kind = gateKind(words);
      if (kind) gates.add(kind);
    }
  }
  return gates;
}

/** The pre-packaged build and submit jobs of an EAS Workflows file, as commands. */
export function easWorkflowJobs(text, rel) {
  const lines = yamlLines(text);
  const jobsEntry = yamlChildren(lines, 0, lines.length).find((entry) => entry.key === 'jobs');
  if (!jobsEntry) return [];
  const jobs = new Map();
  for (const job of yamlChildren(lines, jobsEntry.start, jobsEntry.end)) {
    const keys = new Map(yamlChildren(lines, job.start, job.end).map((entry) => [entry.key, entry]));
    const hooks = keys.has('hooks') ? yamlChildren(lines, keys.get('hooks').start, keys.get('hooks').end) : [];
    const skip = hooks.filter((hook) => hook.key === 'after_submit').map((hook) => [hook.line - 1, hook.end]);
    jobs.set(job.key, {
      id: job.key,
      line: keys.get('type')?.line ?? job.line,
      type: keys.has('type') ? yamlScalar(keys.get('type').value) : null,
      needs: keys.has('needs') ? yamlList(lines, keys.get('needs')) : [],
      params: keys.has('params') ? yamlMap(lines, keys.get('params')) : {},
      gates: gatesIn(lines, job.start, job.end, skip),
    });
  }
  const upstreamGates = (id) => {
    const gates = new Set();
    const seen = new Set();
    const visit = (name) => {
      for (const parent of jobs.get(name)?.needs ?? []) {
        if (seen.has(parent) || !jobs.has(parent)) continue;
        seen.add(parent);
        for (const kind of jobs.get(parent).gates) gates.add(kind);
        visit(parent);
      }
    };
    visit(id);
    return gates;
  };
  const out = [];
  for (const job of jobs.values()) {
    if (job.type !== 'build' && job.type !== 'submit') continue;
    const gates = new Set([...job.gates, ...upstreamGates(job.id)]);
    const profile = typeof job.params.profile === 'string' && job.params.profile !== '' ? job.params.profile : null;
    const platform = job.type === 'build' && typeof job.params.platform === 'string' && job.params.platform !== '' ? job.params.platform : null;
    const shown = [profile ? `profile ${profile}` : null, platform ? `platform ${platform}` : null].filter(Boolean).join(', ');
    out.push({
      file: rel,
      line: job.line,
      sub: job.type,
      args: `(EAS Workflows job "${job.id}"${shown ? `: ${shown}` : ''})`,
      flags: { profile, platform, autoSubmit: false, autoSubmitProfile: null, latest: false, nonInteractive: true, local: false, freezeCredentials: null, id: job.params.build_id ?? null },
      ci: true,
      before: job.type === 'submit' ? gates.has('record') : gates.has('verify'),
      viaNpx: false,
      job: job.id,
    });
  }
  return out;
}

/** Every eas build / eas submit command in package.json scripts, shell scripts and CI workflows. */
export function easCommands(root, appRel, pkg) {
  const out = [];
  const pkgRel = posix.join(appRel, 'package.json');
  for (const [name, script] of Object.entries(pkg?.scripts ?? {})) {
    if (typeof script !== 'string') continue;
    for (const hit of scanSegments([wholeText(script)], pkgRel, false)) out.push({ ...hit, line: 0, script: name });
  }
  const files = walkRepo(root, { include: ['*.sh', '*.yml', '*.yaml'] }).filter(
    (rel) => rel.endsWith('.sh') || rel.startsWith('.github/workflows/') || rel.startsWith('.eas/workflows/'),
  );
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    const ci = rel.startsWith('.github/workflows/') || rel.startsWith('.eas/workflows/');
    const segments = rel.endsWith('.sh') ? [wholeText(text)] : yamlRunSegments(text);
    out.push(...scanSegments(segments, rel, ci));
    if (rel.startsWith('.eas/workflows/')) out.push(...easWorkflowJobs(text, rel));
  }
  return out;
}
