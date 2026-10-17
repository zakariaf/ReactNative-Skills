// scripts/audit/network-baseline.ts
// The reasoned baseline (contracts/network-baseline.json, a Gate-Change path: the reviewer approves
// every change). Every entry carries its categories and why the app cannot reach that code; a
// package the app uses to go online is a declared SDK in contracts/privacy.json instead, and its
// findings are covered by that declaration. Any other finding the baseline does not cover fails; a
// stale entry is reported without failing.
export type BaselineEntry = { readonly categories: readonly string[]; readonly reason: string };
export type Baseline = Readonly<Record<string, BaselineEntry>>;
export type NetworkBaseline = { readonly js: Baseline; readonly native: Baseline };
export type Findings = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * NEW lines (failures) and STALE lines (notes) of findings against one baseline section; packages in
 * `declaredSdks` (the sdks of contracts/privacy.json) are covered whatever they can do.
 */
export function compareToBaseline(
  findings: Findings,
  baseline: Baseline,
  declaredSdks: ReadonlySet<string> = new Set(),
): { readonly failures: string[]; readonly notes: string[] } {
  const failures: string[] = [];
  for (const [owner, categories] of findings) {
    if (declaredSdks.has(owner)) {
      continue;
    }
    const allowed = new Set(baseline[owner]?.categories ?? []);
    const extra = [...categories].filter((category) => !allowed.has(category));
    if (extra.length > 0) {
      failures.push(`NEW ${owner}: ${extra.join(', ')} (not in the baseline)`);
    }
  }
  const notes = Object.keys(baseline)
    .filter((owner) => !findings.has(owner))
    .map((owner) => `STALE ${owner}: in the baseline but not found`);
  return { failures, notes };
}

export function addFinding(
  findings: Map<string, Set<string>>,
  owner: string,
  category: string,
): void {
  const set = findings.get(owner) ?? new Set<string>();
  set.add(category);
  findings.set(owner, set);
}
