// scripts/audit/audit-licenses.ts
// `npm run audit:licenses`: every npm package that ends up in a release JavaScript bundle carries a
// licence the policy allows ("licenses" in the dependency policy, found like the dependency-management
// skill's checkers find it; a missing policy fails the audit). Input: the source maps of a release
// export, written first with `npm run export:audit`, which runs (as the production variant)
//   expo export --platform ios --platform android --source-maps --output-dir dist-audit
// or map files passed as arguments. Build tools in the lockfile never reach the bundle, so only
// shipped JavaScript is audited. Native SDKs that native modules pull through CocoaPods and Gradle
// are not in the source maps: read ios/Podfile.lock and the Gradle dependency report for those.
// A package the maps list that is not found on disk (wrong working folder, node_modules missing)
// fails the audit, and so do maps with no node_modules sources at all: nothing checked is not a pass.
import { existsSync, globSync, readFileSync } from 'node:fs';

import { licenseProblems, packageJsonCandidates, packageRootOf } from './license-policy.ts';
import {
  licensePolicyOf,
  readDependencyPolicy,
  type LicensePolicy,
} from '../deps/dependency-policy.ts';

const DEFAULT_MAPS = 'dist-audit/**/_expo/static/js/*/*.map';
const EXPORT_COMMAND =
  'npm run export:audit (expo export --platform ios --platform android --source-maps --output-dir dist-audit)';

type SourceMap = { readonly sources: readonly string[] };
type PackageJson = { readonly name?: string; readonly license?: unknown };

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

type Shipped = {
  /** Package name to its licence field (null when absent or not a string). */
  readonly licenses: ReadonlyMap<string, string | null>;
  /** node_modules package roots the maps list but no package.json on disk matches. */
  readonly unresolved: readonly string[];
};

function shippedLicenses(mapFiles: readonly string[]): Shipped {
  const licenses = new Map<string, string | null>();
  const unresolved = new Set<string>();
  for (const mapFile of mapFiles) {
    const map = readJson(mapFile) as SourceMap;
    const roots = new Set(map.sources.flatMap((source) => packageRootOf(source) ?? []));
    for (const root of roots) {
      const file = packageJsonCandidates(root, process.cwd()).find((candidate) =>
        existsSync(candidate),
      );
      if (file === undefined) {
        unresolved.add(root);
        continue;
      }
      const pkg = readJson(file) as PackageJson;
      licenses.set(pkg.name ?? file, typeof pkg.license === 'string' ? pkg.license : null);
    }
  }
  return { licenses, unresolved: [...unresolved].sort() };
}

/** Why the maps could not be audited (nothing checked is not a pass), or an empty list. */
function coverageProblems(shipped: Shipped): readonly string[] {
  const missing = shipped.unresolved.map(
    (root) =>
      `${root}: listed in the source maps, but no package.json found under ${process.cwd()} or a parent folder; run the audit from the folder the export ran in, after npm ci`,
  );
  if (shipped.licenses.size === 0 && missing.length === 0) {
    return [
      'the source maps list no node_modules sources, so nothing was checked; pass the maps of a release export',
    ];
  }
  return missing;
}

/** The licence policy, or null after printing why the policy cannot be read (never a default). */
function loadLicensePolicy(): LicensePolicy | null {
  try {
    const read = readDependencyPolicy();
    return licensePolicyOf(read.policy, read.file);
  } catch (error) {
    console.error(`audit:licenses: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function main(argv: readonly string[]): number {
  const mapFiles = argv.length > 0 ? argv : globSync(DEFAULT_MAPS);
  if (mapFiles.length === 0) {
    console.error(`audit:licenses: no source maps at ${DEFAULT_MAPS}; run ${EXPORT_COMMAND} first`);
    return 1;
  }
  const policy = loadLicensePolicy();
  if (policy === null) {
    return 1;
  }
  const shipped = shippedLicenses(mapFiles);
  const problems = [...coverageProblems(shipped), ...licenseProblems(shipped.licenses, policy)];
  for (const problem of problems) {
    console.error(`audit:licenses: ${problem}`);
  }
  console.log(`audit:licenses: ${String(shipped.licenses.size)} shipped packages checked`);
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
