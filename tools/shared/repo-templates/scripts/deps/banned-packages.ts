// scripts/deps/banned-packages.ts
// Pure: the package inventory of package-lock.json and the banned packages in it. The rules come
// from contracts/dependency-policy.json (bannedRulesOf); check-deps.ts runs this in npm run verify.
import type { BannedRule } from './dependency-policy.ts';

type LockEntry = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};
export type Lockfile = { readonly packages: Readonly<Record<string, LockEntry>> };
export type PackageInventory = {
  readonly direct: readonly string[];
  readonly all: readonly string[];
};
export type BannedHit = { readonly name: string; readonly reason: string };

const NODE_MODULES = 'node_modules/';

/** Direct dependencies of every workspace, and every installed package, from package-lock.json. */
export function inventoryFromLockfile(lockfile: Lockfile): PackageInventory {
  const paths = Object.keys(lockfile.packages);
  const all = paths
    .filter((path) => path.includes(NODE_MODULES))
    .map((path) => path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length));
  const direct = paths
    .filter((path) => !path.includes(NODE_MODULES))
    .flatMap((path) => {
      const entry = lockfile.packages[path];
      return Object.keys({
        ...entry?.dependencies,
        ...entry?.devDependencies,
        ...entry?.optionalDependencies,
      });
    });
  return { direct: [...new Set(direct)].sort(), all: [...new Set(all)].sort() };
}

/** Every banned package in the inventory; a rule with scope "direct" sees direct dependencies only. */
export function findBannedPackages(
  inventory: PackageInventory,
  rules: readonly BannedRule[],
): readonly BannedHit[] {
  return rules.flatMap((rule) => {
    const names = rule.scope === 'direct' ? inventory.direct : inventory.all;
    return names
      .filter((name) => rule.pattern.test(name))
      .map((name) => ({ name, reason: rule.reason }));
  });
}
