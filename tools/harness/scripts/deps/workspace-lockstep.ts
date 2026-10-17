// scripts/deps/workspace-lockstep.ts
// Pure (when multi-package): one specifier per package across the root and every workspace. Two
// specifiers let npm install two copies, and a native module can only be compiled into a build once.

export type Manifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

function specifiersByPackage(
  manifests: ReadonlyMap<string, Manifest>,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byPackage = new Map<string, Map<string, string>>();
  for (const [workspace, manifest] of manifests) {
    const all = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    for (const [name, specifier] of Object.entries(all)) {
      const specifiers = byPackage.get(name) ?? new Map<string, string>();
      specifiers.set(workspace, specifier);
      byPackage.set(name, specifiers);
    }
  }
  return byPackage;
}

/**
 * Every package that two workspaces declare with different specifiers. Workspace links ("*") are
 * ignored. The keys of `manifests` name the workspaces ("." for the root).
 */
export function findLockstepDrift(manifests: ReadonlyMap<string, Manifest>): readonly string[] {
  return [...specifiersByPackage(manifests)].flatMap(([name, specifiers]) => {
    const distinct = new Set([...specifiers.values()].filter((specifier) => specifier !== '*'));
    if (distinct.size <= 1) {
      return [];
    }
    const detail = [...specifiers].map(([workspace, spec]) => `${workspace}=${spec}`).join(', ');
    return [`${name} differs between workspaces: ${detail}`];
  });
}
