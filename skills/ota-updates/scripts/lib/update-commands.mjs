// update-commands.mjs: every EAS Update command an app repo runs (a helper, not an entry point):
// `eas update`, `eas update:<sub>` and `eas channel:<sub>` in package.json scripts, shell scripts,
// CI workflows (.github/workflows, .eas/workflows) and string literals of Node scripts under the
// scripts folder (tests and comments excluded), plus EAS Workflows `type: update` jobs.
//
//   updateCommands(root, { appRel, scriptsDir })   [{ file, line, sub, flags, ci, gated, job? }]
//   isLiteral(value)                              false for $VAR, ${{ expr }} and empty values
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { maskComments, walkRepo } from '../check-lib.mjs';

const COMMAND = /(?:^|[\s;&|(=])(?:npx\s+(?:(?:--yes|-y)\s+)?)?(?:eas-cli(?:@\S+)?|eas)\s+(update(?::[\w-]+)?|channel:[\w-]+)(?![\w:-])/g;
const GATE = /\bnpm\s+run\s+(?:-s\s+|--silent\s+)?verify\b|update-preflight\.ts\b|run-verify\.ts\b/;
const VALUE_FLAGS = ['--channel', '--branch', '--environment', '--message', '-m', '--rollout-percentage', '--destination-channel', '--destination-branch', '--platform', '-p', '--group'];

export const isLiteral = (value) => typeof value === 'string' && value !== '' && !/[$`]|\{\{/.test(value);

/** Shell words after a command, up to the end of the command (newline, ;, |, &). */
function readWords(text, start) {
  const words = [];
  let word = '';
  let started = false;
  let quote = null;
  const flush = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\n') break;
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === '\\' && text[i + 1] === '\n') { i += 1; continue; }
    if (text.startsWith('${{', i)) {
      const end = text.indexOf('}}', i);
      word += text.slice(i, end < 0 ? text.length : end + 2);
      started = true;
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === ')') break;
    if (ch === '#' && !started) break;
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { flush(); continue; }
    word += ch;
    started = true;
  }
  flush();
  return words;
}

function flagsOf(words) {
  const flags = { present: new Set() };
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word.startsWith('-')) continue;
    const [name, inline] = word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    flags.present.add(name);
    if (!VALUE_FLAGS.includes(name)) continue;
    const value = inline ?? (i + 1 < words.length && !words[i + 1].startsWith('--') ? words[i + 1] : '');
    if (inline === undefined && value !== '') i += 1;
    flags[name === '-m' ? '--message' : name === '-p' ? '--platform' : name] = value;
  }
  return flags;
}

function scanShell(text, { file, ci, lineBase = null, lineOffset = 0 }) {
  const found = [];
  for (const match of text.matchAll(COMMAND)) {
    const at = match.index + (/^[\s;&|(=]/.test(match[0]) ? 1 : 0);
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    if (/(^|\s)#/.test(text.slice(lineStart, at))) continue;
    const flags = flagsOf(readWords(text, match.index + match[0].length));
    const line = lineBase ?? lineOffset + text.slice(0, at).split('\n').length;
    found.push({ file, line, sub: match[1], flags, ci, gated: GATE.test(text.slice(0, at)) });
  }
  return found;
}

const STRING = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function scanCode(text, file) {
  const code = maskComments(text);
  const found = [];
  for (const literal of code.matchAll(STRING)) {
    const body = literal[0].slice(1, -1);
    const lineOffset = code.slice(0, literal.index).split('\n').length - 1;
    const gated = GATE.test(code.slice(0, literal.index));
    for (const hit of scanShell(body, { file, ci: false, lineOffset })) found.push({ ...hit, gated: hit.gated || gated });
  }
  return found;
}

const indentOf = (line) => line.length - line.trimStart().length;

/** YAML folded scalars (key: > or >-) are one shell line: join them, keeping the line count. */
function unfoldYaml(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/:\s*>[-+]?\s*$/.test(lines[i])) continue;
    const indent = indentOf(lines[i]);
    let end = i + 1;
    while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > indent)) end += 1;
    const body = lines.slice(i + 1, end).map((line) => line.trim()).filter(Boolean).join(' ');
    lines[i] = lines[i].replace(/>[-+]?\s*$/, body);
    for (let k = i + 1; k < end; k += 1) lines[k] = '';
    i = end - 1;
  }
  return lines.join('\n');
}
const valueOf = (line) => line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');

/** The jobs of an EAS Workflows file: id, its lines, type, needs and if (read by indentation). */
function easJobsOf(lines) {
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const jobs = new Map();
  if (jobsAt < 0) return jobs;
  let idIndent = null;
  let current = null;
  for (let i = jobsAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) break;
    idIndent ??= indent;
    const id = indent === idIndent ? /^\s*([\w-]+):\s*$/.exec(line)?.[1] : undefined;
    if (id) {
      current = { id, start: i, end: i, type: '', needs: [], ifText: '' };
      jobs.set(id, current);
      continue;
    }
    if (!current) continue;
    current.end = i;
    const bodyKey = (name) => indentOf(line) === idIndent + 2 && new RegExp(`^\\s*${name}:`).test(line);
    if (bodyKey('type')) current.type = valueOf(line);
    if (bodyKey('if')) current.ifText = line.slice(line.indexOf(':') + 1);
    if (bodyKey('needs')) {
      const inline = /\[([^\]]*)\]/.exec(line)?.[1] ?? valueOf(line);
      current.needs.push(...inline.split(',').map((need) => need.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
      for (let k = i + 1; k < lines.length && /^\s*-\s*/.test(lines[k]) && indentOf(lines[k]) > indentOf(line) - 1; k += 1) {
        current.needs.push(lines[k].replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''));
      }
    }
  }
  return jobs;
}

/** Every job `id` needs, directly or through other jobs. */
function neededJobs(jobs, id, seen = new Set()) {
  for (const need of jobs.get(id)?.needs ?? []) {
    if (seen.has(need) || !jobs.has(need)) continue;
    seen.add(need);
    neededJobs(jobs, need, seen);
  }
  return seen;
}

/**
 * An update job is gated when a job it needs runs the gates (npm run verify, run-verify.ts or the
 * update preflight), or when it follows Expo's pattern: it needs a `type: fingerprint` job and a
 * `type: get-build` job, and its `if:` reads that get-build job's outputs (a finished build with
 * this fingerprint exists, so the runtime is live).
 */
function isEasJobGated(lines, jobs, id) {
  const needed = [...neededJobs(jobs, id)].map((need) => jobs.get(need));
  const textOf = (job) => lines.slice(job.start + 1, job.end + 1).join('\n');
  if (needed.some((job) => GATE.test(textOf(job)))) return true;
  const getBuilds = needed.filter((job) => job.type === 'get-build');
  const ifText = jobs.get(id)?.ifText ?? '';
  return needed.some((job) => job.type === 'fingerprint') && getBuilds.some((job) => ifText.includes(`needs.${job.id}.outputs`));
}

/** EAS Workflows jobs of `type: update`, read by indentation (no YAML parser needed). */
function scanEasJobs(text, file) {
  const lines = text.split('\n');
  const jobs = easJobsOf(lines);
  const found = [];
  lines.forEach((line, index) => {
    if (!/^\s*type:\s*["']?update["']?\s*$/.test(line)) return;
    const indent = indentOf(line);
    let first = index;
    while (first > 0 && (lines[first - 1].trim() === '' || indentOf(lines[first - 1]) >= indent)) first -= 1;
    let last = index;
    while (last + 1 < lines.length && (lines[last + 1].trim() === '' || indentOf(lines[last + 1]) >= indent)) last += 1;
    const block = lines.slice(first, last + 1);
    const key = (name, atIndent) => block.find((text) => new RegExp(`^\\s*${name}:`).test(text) && (atIndent === null || indentOf(text) === atIndent));
    const flags = { present: new Set() };
    const environment = key('environment', indent);
    if (environment) { flags.present.add('--environment'); flags['--environment'] = valueOf(environment); }
    for (const [yamlKey, flag] of [['channel', '--channel'], ['branch', '--branch'], ['message', '--message'], ['rollout_percentage', '--rollout-percentage']]) {
      const hit = key(yamlKey, null);
      if (hit && indentOf(hit) > indent) { flags.present.add(flag); flags[flag] = valueOf(hit); }
    }
    flags.present.add('--message');
    const id = [...jobs.values()].find((job) => job.start < index && index <= job.end)?.id;
    const gated = id !== undefined && isEasJobGated(lines, jobs, id);
    found.push({ file, line: index + 1, sub: 'update', flags, ci: true, gated, job: true });
  });
  return found;
}

export function updateCommands(root, { appRel = '.', scriptsDir = 'scripts', pkg = null } = {}) {
  const out = [];
  const pkgRel = posix.join(appRel, 'package.json');
  const pkgText = pkg ? readFileSync(join(root, pkgRel), 'utf8') : '';
  for (const [name, script] of Object.entries(pkg?.scripts ?? {})) {
    if (typeof script !== 'string') continue;
    const index = pkgText.indexOf(`"${name}"`);
    const lineBase = index < 0 ? 1 : pkgText.slice(0, index).split('\n').length;
    out.push(...scanShell(script, { file: pkgRel, ci: false, lineBase }));
  }
  const files = walkRepo(root, { include: ['*.sh', '*.bash', '*.yml', '*.yaml', '*.ts', '*.mts', '*.js', '*.mjs', '*.cjs'] });
  for (const rel of files) {
    const isWorkflow = rel.startsWith('.github/workflows/') || rel.startsWith('.eas/workflows/');
    const isShell = /\.(sh|bash)$/.test(rel);
    const isScript = /\.(m?ts|[cm]?js)$/.test(rel) && (rel.startsWith(`${scriptsDir}/`) || rel.startsWith(posix.join(appRel, scriptsDir) + '/')) && !/\.test\.|\.spec\./.test(rel);
    if (!isWorkflow && !isShell && !isScript) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    if (isScript) out.push(...scanCode(text, rel));
    else out.push(...scanShell(isWorkflow ? unfoldYaml(text) : text, { file: rel, ci: isWorkflow }));
    if (rel.startsWith('.eas/workflows/')) out.push(...scanEasJobs(text, rel));
  }
  return out;
}
