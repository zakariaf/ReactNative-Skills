// analytics-repo.mjs: what both analytics checkers read from the app repo: the facts table
// (assets/analytics-facts.json), the layout paths, package.json, the contract and the scanned
// sources. Not an entry point.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveLayout, toPosix, walkRepo } from '../check-lib.mjs';
import { findImports, isTestFile, maskCode } from './source-scan.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The facts table, read once. */
export const FACTS = JSON.parse(readFileSync(join(SKILL_DIR, 'assets', 'analytics-facts.json'), 'utf8'));

/** Replaces {servicesDir}-style tokens with the layout's folders. */
export function layoutPath(template, layout) {
  return toPosix(template.replace(/\{(\w+)\}/g, (_, key) => layout[key] ?? `{${key}}`));
}

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Every dependency name in package.json (all dependency fields). */
function dependencyNames(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return new Set();
  const { value } = readJson(path);
  const names = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(value?.[field] ?? {})) names.add(name);
  }
  return names;
}

/** A source file the checkers read: original text, masked code (comments and strings blanked), imports. */
function sourceOf(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  const masked = maskCode(text);
  return { rel, text, masked, imports: findImports(text, masked), isTest: isTestFile(rel) };
}

/** The text an auto-start entry prints: a string, or { why, gatedBy }. */
export function autoStartWhy(entry) {
  return typeof entry === 'string' ? entry : entry.why;
}

function isGated(entry, sources) {
  if (typeof entry === 'string' || !entry.gatedBy) return false;
  const gate = new RegExp(entry.gatedBy);
  // masked code: comments and strings blanked, so a commented-out gate does not count.
  return sources.some((source) => !source.isTest && gate.test(source.masked));
}

/**
 * Everything the checks need. `present` is false when the app has no analytics at all (no analytics
 * folder, no contract, no known SDK, no auto-start SDK): the checkers then print NOT APPLICABLE.
 */
export function loadAnalyticsRepo(root, overrides = {}) {
  const layout = resolveLayout(root, overrides);
  const paths = Object.fromEntries(Object.entries(FACTS.paths).map(([key, value]) => [key, layoutPath(value, layout)]));
  const deps = dependencyNames(root);
  const knownSdks = Object.keys(FACTS.sdks).filter((name) => deps.has(name));
  const installedAutoStart = Object.keys(FACTS.autoStartSdks).filter((name) => deps.has(name));
  const hasDir = existsSync(join(root, paths.analyticsDir));
  const contractPath = join(root, paths.contract);
  const contract = existsSync(contractPath) ? readJson(contractPath) : null;
  const sources = hasDir || contract !== null || knownSdks.length > 0 || installedAutoStart.length > 0
    ? walkRepo(root, { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs'], ignore: ['**/*.d.ts'] })
        .filter((rel) => rel.startsWith(`${layout.srcDir}/`) || /^app\.config\.[jt]s$/.test(rel) || rel.startsWith(`${layout.testDir}/`))
        .map((rel) => sourceOf(root, rel))
    : [];
  // An auto-start SDK whose facts name a gate (expo-observe: dispatchingEnabled: false written in
  // the app's code) is held by that gate; another skill owns its consent decision.
  const autoStart = installedAutoStart.filter((name) => !isGated(FACTS.autoStartSdks[name], sources));
  const ownAnalytics = hasDir || contract !== null || knownSdks.length > 0;
  const present = ownAnalytics || autoStart.length > 0;
  return { root, layout, paths, deps, knownSdks, autoStart, hasDir, contract, present, onlyAutoStart: present && !ownAnalytics, sources };
}

/** True for <analyticsDir>/<vendor>-analytics-adapter.ts(x) and its platform variants (not tests). */
export function isVendorAdapter(rel, repo) {
  const dir = repo.paths.analyticsDir;
  return new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-z0-9-]+-analytics-adapter(\\.(ios|android|native|web))?\\.tsx?$`).test(rel);
}

/** True for a vendor adapter's own test. */
export function isVendorAdapterTest(rel, repo) {
  return isVendorAdapter(rel.replace(/\.(test|spec)(\.[jt]sx?)$/, '$2'), repo) && /\.(test|spec)\.[jt]sx?$/.test(rel);
}

/** 1-based line of `index` in `text`. */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * The SDK packages the import rule guards: every known analytics SDK, the contract's, and the
 * auto-start ones that are analytics (a gated telemetry SDK such as expo-observe belongs to
 * another skill's port and is imported there).
 */
export function guardedPackages(repo) {
  const analyticsAutoStart = Object.entries(FACTS.autoStartSdks).filter(([, entry]) => typeof entry === 'string').map(([name]) => name);
  const names = new Set([...Object.keys(FACTS.sdks), ...analyticsAutoStart]);
  const sdk = repo.contract?.value?.sdk;
  if (typeof sdk === 'string' && sdk !== 'none') names.add(sdk);
  return names;
}

/** True when an import specifier is `pkg` or a subpath of it. */
export function importsPackage(spec, pkg) {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}
