// scripts/ads/refresh-skadnetwork.ts
// Usage: node scripts/ads/refresh-skadnetwork.ts [--check]
// Rewrites src/config/skadnetwork-ids.ts from Google's AdMob iOS quick-start page; --check exits 1
// when the committed list is stale (run it before every release). Developer tooling may use the
// network; the app itself calls only through its ApiClient. After a refresh: npx expo prebuild
// --clean (or the next EAS build), and commit the generated file with the release.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  assertGoogleList,
  diffSkadnetworkIds,
  extractSkadnetworkIds,
  skadnetworkModuleSource,
  SKADNETWORK_SOURCE,
  SKADNETWORK_TARGET,
} from './skadnetwork-list.ts';

async function fetchIds(): Promise<string[]> {
  const response = await fetch(SKADNETWORK_SOURCE);
  if (!response.ok) throw new Error(`${SKADNETWORK_SOURCE}: HTTP ${String(response.status)}`);
  const ids = extractSkadnetworkIds(await response.text());
  assertGoogleList(ids);
  return ids;
}

async function main(isCheck: boolean): Promise<void> {
  const fresh = await fetchIds();
  const committed = existsSync(SKADNETWORK_TARGET)
    ? extractSkadnetworkIds(readFileSync(SKADNETWORK_TARGET, 'utf8'))
    : [];
  const { added, removed } = diffSkadnetworkIds(committed, fresh);
  console.error(
    `skadnetwork: ${String(fresh.length)} ids, +${String(added.length)} -${String(removed.length)}`,
  );
  if (isCheck) {
    process.exitCode = added.length + removed.length === 0 ? 0 : 1;
    return;
  }
  writeFileSync(SKADNETWORK_TARGET, skadnetworkModuleSource(fresh));
}

await main(process.argv.includes('--check'));
