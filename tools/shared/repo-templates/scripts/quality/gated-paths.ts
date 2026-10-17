// scripts/quality/gated-paths.ts
// Which changed files are quality gates: a file matching a quality-gates.json "gatedPaths" pattern
// needs the developer's agreement and a "Gate-Change: <reason>" commit trailer. The commit-message
// check (git-commits-and-reporting) asks this module, so the hook and every report agree.
//
// Installed agent skills are knowledge, not gates: their templates and fixtures hold tsconfig files,
// snapshots and vectors on purpose. A pattern that starts with a wildcard never reaches into an
// agent folder; a pattern that names the folder itself still does (".claude/settings.json").
import path from 'node:path';

/** Folders that hold installed skills and agent settings (the repo scans of every skill skip them). */
export const AGENT_FOLDERS = [
  'skills/',
  '.agents/',
  '.claude/',
  '.codex/',
  '.cursor/',
  '.windsurf/',
  '.roo/',
  '.cline/',
  '.continue/',
  '.kiro/',
] as const;

/** True when a changed file (repo-relative, forward slashes) matches one gated-path pattern. */
export function isGatedFile(file: string, pattern: string): boolean {
  const folder = AGENT_FOLDERS.find((prefix) => file.startsWith(prefix));
  if (folder !== undefined && !pattern.startsWith(folder)) {
    return false;
  }
  return path.matchesGlob(file, pattern);
}

/** The changed files that are gates, in the order given. */
export function gatedFilesIn(
  files: readonly string[],
  patterns: readonly string[],
): readonly string[] {
  return files.filter((file) => patterns.some((pattern) => isGatedFile(file, pattern)));
}

/** The "gatedPaths" list of a parsed quality-gates.json, or an empty list when it has none. */
export function gatedPathsOf(gates: unknown): readonly string[] {
  if (typeof gates !== 'object' || gates === null) {
    return [];
  }
  const value = (gates as Readonly<Record<string, unknown>>)['gatedPaths'];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
