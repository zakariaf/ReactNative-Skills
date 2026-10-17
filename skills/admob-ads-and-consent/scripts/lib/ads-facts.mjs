// ads-facts.mjs: what check-ads.mjs and check-ad-behaviour.mjs read once: assets/admob-facts.json, the
// app's contracts/ads.json, the layout paths and the scanned sources. Not an entry point.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, maskComments, parseJsonc, readWorkspaces } from '../check-lib.mjs';
import { configFiles, isTestFile, readRepoJson, readRepoText, runtimeSourceFiles } from './repo-scan.mjs';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FACTS = JSON.parse(readFileSync(join(SKILL_DIR, 'assets', 'admob-facts.json'), 'utf8'));
export const SDK = FACTS.sdk.package;
export const TRACKING = FACTS.tracking.package;
export const APP_ID = new RegExp(FACTS.idPatterns.appId);
export const UNIT_ID = new RegExp(FACTS.idPatterns.unitId);

/** Fills {servicesDir}-style placeholders from the layout. */
export const fill = (layout, path) => path.replace(/\{(\w+)\}/g, (_, key) => layout[key] ?? `{${key}}`);
export const isUnder = (rel, entry) => rel === entry || (entry.endsWith('/') && rel.startsWith(entry));

/** In a multi-package repo run without --app: stop and name the apps that use the SDKs. */
export function requireAppForWorkspaces(root, packages) {
  const users = readWorkspaces(root).filter((workspace) => packages.some((name) => workspace.manifest?.dependencies?.[name] !== undefined || workspace.manifest?.devDependencies?.[name] !== undefined));
  if (users.length > 0) fail(`this is a multi-package repo and ${users.map((workspace) => workspace.dir).join(', ')} use the ads SDKs`, `Run once per app: --app ${users[0].dir}`);
}

export function readContract(root, layout) {
  const rel = typeof layout.config.adsContract === 'string' ? layout.config.adsContract : `${layout.contractsDir}/ads.json`;
  if (!existsSync(join(root, rel))) return { rel, data: null };
  let data;
  try {
    data = parseJsonc(readFileSync(join(root, rel), 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON (${error.message})`, 'Fix the JSON; templates/contracts/ads.json is the shape.');
  }
  const problems = [];
  if (!['general', 'child-directed'].includes(data?.audience)) problems.push('"audience" must be "general" or "child-directed"');
  if (!['G', 'PG', 'T', 'MA'].includes(data?.maxAdContentRating)) problems.push('"maxAdContentRating" must be G, PG, T or MA');
  if (typeof data?.bannerSlots !== 'object' || data.bannerSlots === null || Array.isArray(data.bannerSlots)) problems.push('"bannerSlots" must map screen folders to testIDs');
  if (problems.length > 0) fail(`${rel}: ${problems.join('; ')}`, 'Fix the contract; templates/contracts/ads.schema.json documents every key.');
  return { rel, data };
}

/** Everything the rules need, read once. */
export function scanContext(root, layout) {
  const adsDir = `${layout.servicesDir}/ads`;
  const consentDir = `${layout.servicesDir}/consent`;
  const runtime = runtimeSourceFiles(root, layout);
  const config = configFiles(root, layout);
  const all = [...new Set([...runtime, ...config])];
  const sources = new Map(all.map((rel) => [rel, readRepoText(root, rel)]));
  const masked = new Map(all.map((rel) => [rel, maskComments(sources.get(rel))]));
  const architecture = readRepoJson(root, `${layout.contractsDir}/architecture.json`);
  const testOnly = [...FACTS.testOnlyDefaults.map((path) => fill(layout, path)), ...(Array.isArray(architecture?.testOnlyFolders) ? architecture.testOnlyFolders : [])];
  return {
    root, layout, adsDir, consentDir, runtime, config, sources, masked,
    adapters: Object.fromEntries(Object.entries(FACTS.adapters).map(([path, names]) => [fill(layout, path), names])),
    fill: (path) => fill(layout, path),
    consentAdapter: fill(layout, FACTS.consentAdapter),
    debugAdapter: fill(layout, FACTS.debugAdapter),
    trackingAdapter: fill(layout, FACTS.tracking.adapter),
    isTestOnly: (rel) => testOnly.some((entry) => isUnder(rel, entry)) || /(^|\/)test-only(-entry|-api)?\.tsx?$/.test(rel),
    isAppCode: (rel) => runtime.includes(rel) && !isTestFile(rel),
  };
}

