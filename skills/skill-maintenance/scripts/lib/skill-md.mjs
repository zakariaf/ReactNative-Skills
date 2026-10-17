// skill-md.mjs: reads a skill folder's SKILL.md into its parts (frontmatter, sections, Files table,
// rules, related skills) and turns path arguments into skill folders, for the skill-maintenance
// checkers. Zero dependencies.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { UsageError, toPosix } from '../check-lib.mjs';

export const SECTIONS = ['Rules that must hold', 'Workflow', 'Definition of done', 'Anti-patterns', 'Files in this skill', 'Related skills'];
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parses one frontmatter value: plain, "double quoted" or 'single quoted'. */
function scalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(["\\nt])/g, (_, ch) => ({ n: '\n', t: '\t' })[ch] ?? ch);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

/** Blanks fenced code blocks (keeps line count) and returns [{ text, inFence }] per line. */
function fenceMap(lines) {
  let fence = null;
  return lines.map((line) => {
    const opener = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      if (opener && line.trim().startsWith(fence)) fence = null;
      return { text: line, inFence: true };
    }
    if (opener) {
      fence = opener[1];
      return { text: line, inFence: true };
    }
    return { text: line, inFence: false };
  });
}

/** Markdown text with fenced blocks and inline code blanked (line numbers kept; a code span may wrap onto the next line). */
export function proseOnly(text) {
  const unfenced = fenceMap(text.split('\n'))
    .map(({ text: line, inFence }) => (inFence ? '' : line))
    .join('\n');
  return unfenced.replace(/(`+)((?:(?!\n\s*\n)[\s\S])*?)\1/g, (match) => match.replace(/[^\n]/g, ' '));
}

/** List items of a section: numbered ("1. ") or dashed ("- "), with continuation lines joined. */
function listItems(section, marker) {
  const items = [];
  section.lines.forEach((line, i) => {
    const match = marker.exec(line);
    if (match) items.push({ text: line.slice(match[0].length), line: section.line + 1 + i });
    else if (items.length > 0 && /^\s{2,}\S/.test(line)) items[items.length - 1].text += ` ${line.trim()}`;
  });
  return items;
}

/** Reads skills/<name>/SKILL.md. Returns null when the folder has no SKILL.md. */
export function readSkill(dir) {
  const path = join(dir, 'SKILL.md');
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const frontmatter = {};
  let bodyStart = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
        if (match) frontmatter[match[1]] = scalar(match[2]);
      }
      bodyStart = end + 1;
    }
  }
  const mapped = fenceMap(lines);
  const heads = [];
  mapped.forEach(({ text: line, inFence }, index) => {
    if (inFence || index < bodyStart) return;
    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (match) heads.push({ level: match[1].length, title: match[2], index });
  });
  const sections = new Map();
  for (const head of heads.filter((item) => item.level === 2)) {
    const next = heads.find((item) => item.index > head.index && item.level <= 2);
    sections.set(head.title, { title: head.title, line: head.index + 1, lines: lines.slice(head.index + 1, next ? next.index : lines.length) });
  }
  const empty = { line: 0, lines: [] };
  const files = (sections.get('Files in this skill') ?? empty).lines
    .map((line, i) => ({ line, number: (sections.get('Files in this skill')?.line ?? 0) + 1 + i }))
    .filter(({ line }) => /^\s*\|/.test(line))
    .map(({ line, number }) => ({ cells: line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()), line: number }))
    .filter(({ cells }) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .slice(1)
    .map(({ cells, line }) => ({ path: cellPath(cells[0] ?? ''), what: cells[1] ?? '', when: cells[2] ?? '', cellCount: cells.length, line }));
  return {
    dir,
    text,
    lines,
    frontmatter,
    sections,
    files,
    rules: listItems(sections.get('Rules that must hold') ?? empty, /^\d+\.\s+/),
    related: listItems(sections.get('Related skills') ?? empty, /^-\s+/),
    sectionText: (title) => (sections.get(title)?.lines ?? []).join('\n'),
  };
}

/** The path named in the first cell of a Files table row. */
export function cellPath(cell) {
  const code = /`([^`]+)`/.exec(cell);
  if (code) return code[1].trim();
  const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(cell);
  if (link) return link[1].trim();
  return cell.replace(/\*\*/g, '').trim();
}

/** Skill folder names (folders with a SKILL.md) directly under a skills root; [] if none. */
export function listSkills(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  // statSync follows symlinks, so .claude/skills (links to skills/<name>) works as a root too.
  return readdirSync(root)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.') && statSync(join(root, name), { throwIfNoEntry: false })?.isDirectory() && existsSync(join(root, name, 'SKILL.md')))
    .sort();
}

/** Skill names a description hands off to: kebab tokens inside parentheses after "Not for". */
export function notForNames(description) {
  const at = description.search(/\bNot for\b/);
  if (at === -1) return [];
  const names = [];
  for (const group of description.slice(at).matchAll(/\(([^)]*)\)/g)) {
    for (const token of group[1].matchAll(/(?<![\w-])[a-z0-9]+(?:-[a-z0-9]+)+(?![\w-])/g)) names.push(token[0]);
  }
  return [...new Set(names)];
}

/** Where skills live in a repo: authored (skills/), Claude Code project skills, and the skills CLI's install folder. */
export const SKILL_FOLDERS = Object.freeze(['skills', '.claude/skills', '.agents/skills']);

/** True when a folder looks like a repo root (a package.json or a .git), so "no skills" is a repo fact. */
export function isRepoRoot(path) {
  return existsSync(join(path, 'package.json')) || existsSync(join(path, '.git'));
}

/**
 * Turns one path argument into skill folders.
 * - a folder with a SKILL.md: that one skill (kind "skill");
 * - a folder whose children hold SKILL.md files: those skills (kind "skills-folder");
 * - anything else is a repo root: the skills of its skills/, .claude/skills/ and .agents/skills/
 *   folders, one entry per real folder (a .claude/skills link to .agents/skills counts once).
 * Returns { kind, path, dirs: [absolute skill folders], roots: [absolute skills folders] }.
 * A path that does not exist is bad input (UsageError, exit 2).
 */
export function resolveSkillPath(path) {
  const abs = resolve(path);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new UsageError(`nothing to check: ${path} does not exist or is not a folder`, 'Pass a skill folder, a skills folder or the repo root.');
  if (existsSync(join(abs, 'SKILL.md'))) return { kind: 'skill', path: abs, dirs: [abs], roots: [dirname(abs)] };
  const direct = listSkills(abs);
  if (direct.length > 0) return { kind: 'skills-folder', path: abs, dirs: direct.map((name) => join(abs, name)), roots: [abs] };
  const seen = new Set();
  const dirs = [];
  const roots = [];
  for (const folder of SKILL_FOLDERS) {
    const root = join(abs, folder);
    const names = listSkills(root);
    if (names.length > 0) roots.push(root);
    for (const name of names) {
      const dir = join(root, name);
      const real = realpathSync(dir);
      if (seen.has(real)) continue;
      seen.add(real);
      dirs.push(dir);
    }
  }
  return { kind: 'repo', path: abs, dirs, roots };
}

/** True for a skills folder a developer authors (skills/), not an installer's folder (.claude/skills, .agents/skills). */
export function isAuthoredSkillsFolder(root) {
  return basename(root) === 'skills' && !basename(dirname(root)).startsWith('.');
}

/**
 * True for a skill the repo authors: a real folder (not an installer's link) outside .agents/skills,
 * where the skills CLI installs third-party skills. Installed skills are context (they share the
 * listing and can collide with authored ones), but their own problems belong to their authors.
 */
export function isAuthoredSkill(dir) {
  return !lstatSync(dir).isSymbolicLink() && !realpathSync(dir).includes(`${sep}.agents${sep}skills${sep}`);
}

/**
 * The skill folders of the repo a skills folder sits in: the nearest ancestor (up to three levels up)
 * that is a repo root contributes its skills/, .claude/skills/ and .agents/skills/. [] when none is found.
 */
export function repoSkillRoots(root) {
  let dir = resolve(root);
  for (let depth = 0; depth < 4; depth += 1) {
    if (isRepoRoot(dir)) return SKILL_FOLDERS.map((folder) => join(dir, folder)).filter((path) => listSkills(path).length > 0);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

/**
 * The skills a run judges. A repo root contributes only the skills it authors (installed third-party
 * skills belong to their authors, so a repo whose only skills are installed ones has nothing to judge:
 * see nothingToJudge). Skill folders named explicitly (a skill, or a skills folder such as
 * .agents/skills) are always judged. Returns { judged, installed }.
 */
export function judgedSkills(resolved) {
  const judged = [];
  const installed = [];
  for (const item of resolved) {
    if (item.kind !== 'repo') {
      judged.push(...item.dirs);
      continue;
    }
    const authored = item.dirs.filter((dir) => isAuthoredSkill(dir));
    judged.push(...authored);
    installed.push(...item.dirs.filter((dir) => !authored.includes(dir)));
  }
  return { judged: [...new Set(judged)], installed: [...new Set(installed)] };
}

/**
 * The NOT APPLICABLE fact when one repo-root argument leaves nothing to judge, else null: a repo
 * (package.json or .git) with no skill folders, or a repo whose only skills are installed ones.
 * The same in validate-skill, check-skill, check-skill-set and check-routing.
 */
export function nothingToJudge(resolved, judged) {
  if (judged.length > 0 || resolved.length !== 1 || resolved[0].kind !== 'repo') return null;
  const item = resolved[0];
  if (item.dirs.length === 0) return isRepoRoot(item.path) ? `no project skills: none of ${SKILL_FOLDERS.map((folder) => `${folder}/`).join(', ')} holds a folder with a SKILL.md` : null;
  const folders = [...new Set(item.dirs.map((dir) => toPosix(relative(item.path, dirname(dir)))))];
  return `only installed skills (${item.dirs.map((dir) => basename(dir)).join(', ')} under ${folders.map((folder) => `${folder}/`).join(', ')}), which their authors own: pass ${folders[0]} to check them`;
}

/**
 * The repo a skills folder sits in: the folder itself or the nearest ancestor (up to three levels up)
 * that is a repo root (package.json or .git) or holds .claude/settings(.local).json; never the home
 * folder, whose .claude/settings.json is the developer's own. null when none is found.
 */
export function findRepoRoot(start) {
  let dir = resolve(start);
  for (let depth = 0; depth < 4; depth += 1) {
    if (dir === homedir()) break;
    if (isRepoRoot(dir) || existsSync(join(dir, '.claude', 'settings.json')) || existsSync(join(dir, '.claude', 'settings.local.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Skill names under several skills folders, deduplicated. */
export function skillNamesIn(roots) {
  return [...new Set(roots.flatMap((root) => listSkills(root)))].sort();
}
