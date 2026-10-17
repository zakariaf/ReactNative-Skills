// scripts/deps/engines-floor.ts
// Pure: the root package.json "engines" keep out every npm before 11.17.0 and every Node before
// 22.18. That is what makes engine-strict=true in .npmrc mean anything: npm checks a project's
// engines only when they are declared. The npm of the default EAS images has none of the policy
// settings; min-release-age arrived in npm 11.10, allowScripts and strict-allow-scripts in 11.16,
// and min-release-age-exclude (the dated blocks) in 11.17.0, so 11.17.0 is the floor. Node 22.18
// runs these gate scripts by type stripping.
type Tool = 'npm' | 'node';
export const ENGINE_FLOORS: Readonly<Record<Tool, string>> = { npm: '11.17.0', node: '22.18.0' };
const ENGINE_RANGES: Readonly<Record<Tool, string>> = { npm: '>=11.17.0', node: '>=22.18' };
const COMPARATOR =
  /^(>=|>|<=|<|\^|~|=)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?$/u;
const WILDCARD = /^[xX*]$/u;

type Bound = { readonly version: string; readonly isExclusive: boolean };
type Version = readonly [number, number, number, string];
export type EnginesManifest = { readonly engines?: Readonly<Record<string, string>> };

function parseVersion(text: string): Version {
  const [core = '', pre = ''] = text.replace(/^[=v]+/u, '').split('-');
  const parts = core.split('.').map((part) => (/^\d+$/u.test(part) ? Number(part) : 0));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, pre];
}

/** Compares two versions; a prerelease sorts before its release. */
function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  const core = [0, 1, 2] as const;
  const index = core.find((at) => x[at] !== y[at]);
  if (index !== undefined) {
    return x[index] - y[index];
  }
  if (x[3] === y[3]) {
    return 0;
  }
  if (x[3] === '' || y[3] === '') {
    return x[3] === '' ? 1 : -1;
  }
  return x[3] < y[3] ? -1 : 1;
}

/** The lower bound one comparator sets ("^11.17", ">=22.18", "11.x"), or null when it sets none. */
function comparatorBound(part: string): Bound | null {
  const match = COMPARATOR.exec(part);
  if (match === null) {
    return null;
  }
  const [, operator = '', major = 'x', minor = '0', patch = '0', pre = ''] = match;
  if (operator.startsWith('<') || WILDCARD.test(major)) {
    return null;
  }
  const pieces = [major, minor, patch].map((piece) => (WILDCARD.test(piece) ? '0' : piece));
  return { version: `${pieces.join('.')}${pre}`, isExclusive: operator === '>' };
}

function isHigher(candidate: Bound, current: Bound | null): boolean {
  if (current === null) {
    return true;
  }
  const order = compareVersions(candidate.version, current.version);
  return order > 0 || (order === 0 && candidate.isExclusive);
}

/** A comparator set admits the highest of its lower bounds ("a - b" starts at a). */
function setBound(alternative: string): Bound | null {
  const normalized = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/gu, '$1');
  const hyphen = /^(\S+)\s+-\s+\S+$/u.exec(normalized);
  const parts = hyphen === null ? normalized.split(/\s+/u) : [hyphen[1] ?? ''];
  let bound: Bound | null = null;
  for (const part of parts) {
    const candidate = comparatorBound(part);
    if (candidate !== null && isHigher(candidate, bound)) {
      bound = candidate;
    }
  }
  return bound;
}

/** True when a range admits some version below the floor; a missing or unbounded range does. */
export function admitsBelow(range: string | undefined, floor: string): boolean {
  if (range === undefined || range.trim() === '') {
    return true;
  }
  const bounds = range.split('||').map(setBound);
  return bounds.some((bound) => {
    if (bound === null) {
      return true;
    }
    const order = compareVersions(bound.version, floor);
    return order < 0;
  });
}

/** One problem per engine the root package.json leaves open below its floor. */
export function enginesProblems(manifest: EnginesManifest): readonly string[] {
  const tools: readonly Tool[] = ['npm', 'node'];
  return tools.flatMap((tool) => {
    const range = manifest.engines?.[tool];
    const floor = ENGINE_FLOORS[tool];
    if (!admitsBelow(range, floor)) {
      return [];
    }
    const found =
      range === undefined ? 'is missing' : `is "${range}", which admits ${tool} below ${floor}`;
    return [`package.json "engines.${tool}" ${found}: set it to "${ENGINE_RANGES[tool]}"`];
  });
}
