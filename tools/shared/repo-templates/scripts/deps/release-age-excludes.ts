// scripts/deps/release-age-excludes.ts
// Pure: .npmrc keeps the dependency policy, and every min-release-age exclude sits in a dated,
// unexpired block that names real packages and does not outlive its release. npm keeps the LAST
// value of a key, reads "key = value" like "key=value" and a bare "key" as true, cuts a value at an
// unescaped "#" or ";" and drops one pair of quotes, so a later "min-release-age=0", a bare
// "force", "force # for now" or an exclude spelled without "[]" must not slip through. The release
// age is a floor: 7 days, or a stricter number the app chooses (min-release-age=14, or 10.5).
export const MIN_RELEASE_AGE_DAYS = 7;
const DAY_MS = 86_400_000;
const RELEASE_AGE_KEY = 'min-release-age';
/** strict-allow-scripts=true stops an install before an unreviewed install script runs. */
const POLICY: Readonly<Record<string, string>> = {
  'engine-strict': 'true',
  'save-exact': 'true',
  'strict-allow-scripts': 'true',
};
/**
 * Keys that switch a guard off: their one harmless value, or null when every value does.
 * package-lock=false makes npm install ignore and stop writing package-lock.json.
 */
const BYPASS_KEYS: Readonly<Record<string, string | null>> = {
  'legacy-peer-deps': 'false',
  force: 'false',
  'dangerously-allow-all-scripts': 'false',
  'package-lock': 'true',
  before: null,
  'allow-scripts': null,
};
const INI_LINE = /^([^=]+)(=(.*))?$/u;
const COMMENT_OR_BLANK = /^\s*(?:[;#]|$)/u;
const SECTION = /^\s*\[[^\]]*\]\s*$/u;
const EXCLUDE_KEY = /^min-release-age-exclude(\[\])?$/u;
const BLOCK_HEADER = /^# exclude-block expires=(\d{4}-\d{2}-\d{2}) reason=\S.*$/u;
/** A pattern of glob characters only matches every package (or every scoped one). */
const CATCH_ALL = /^[*?/@]+$/u;

export type ExcludeProblem =
  | 'policy-missing'
  | 'policy-overridden'
  | 'policy-bypass'
  | 'no-block'
  | 'expired'
  | 'catch-all'
  | 'outlives-release';
export type ExcludeViolation = {
  readonly line: number;
  readonly pattern: string;
  readonly problem: ExcludeProblem;
};

type Setting = { readonly key: string; readonly value: string };
type Block = { readonly expires: string | null };

/** Cuts an unquoted value at the first "#" or ";" that no backslash escapes. */
function stripInlineComment(text: string): string {
  let out = '';
  let isEscaped = false;
  for (const char of text) {
    if (isEscaped) {
      out += '\\;#'.includes(char) ? char : `\\${char}`;
      isEscaped = false;
    } else if (char === ';' || char === '#') {
      break;
    } else if (char === '\\') {
      isEscaped = true;
    } else {
      out += char;
    }
  }
  return (isEscaped ? `${out}\\` : out).trim();
}

/** A key or value as npm's ini parser reads it: one pair of quotes dropped, else the comment cut. */
function iniValue(raw: string): string {
  const text = raw.trim();
  const quote = text.charAt(0);
  if (text.length < 2 || (quote !== '"' && quote !== "'") || !text.endsWith(quote)) {
    return stripInlineComment(text);
  }
  const inner = quote === "'" ? text.slice(1, -1) : text;
  try {
    const parsed: unknown = JSON.parse(inner);
    return String(parsed);
  } catch {
    return quote === "'" ? inner : text;
  }
}

function parseSetting(rawLine: string): Setting | null {
  const text = rawLine.replace(/\r$/u, '');
  if (COMMENT_OR_BLANK.test(text) || SECTION.test(text)) {
    return null;
  }
  const match = INI_LINE.exec(text);
  const key = iniValue(match?.[1] ?? '');
  if (key === '') {
    return null;
  }
  const value = match?.[2] === undefined ? '' : iniValue(match[3] ?? '');
  return { key, value: value === '' ? 'true' : value };
}

/** True when a setting is a policy key at an acceptable value; null when it is no policy key. */
function isPolicyValue(setting: Setting): boolean | null {
  if (setting.key === RELEASE_AGE_KEY) {
    const days = Number(setting.value);
    return setting.value.trim() !== '' && Number.isFinite(days) && days >= MIN_RELEASE_AGE_DAYS;
  }
  const wanted = POLICY[setting.key];
  return wanted === undefined ? null : setting.value === wanted;
}

function isBypass(setting: Setting): boolean {
  return Object.hasOwn(BYPASS_KEYS, setting.key) && setting.value !== BYPASS_KEYS[setting.key];
}

/** YYYY-MM-DD plus a number of days. */
function addDays(dayIso: string, days: number): string {
  return new Date(Date.parse(`${dayIso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Lines that set a policy key outside the policy, or a key that switches a guard off. */
function settingViolations(lines: readonly string[]): ExcludeViolation[] {
  return lines.flatMap((text, index): ExcludeViolation[] => {
    const setting = parseSetting(text);
    if (setting === null) {
      return [];
    }
    const pattern = text.trim();
    if (isPolicyValue(setting) === false) {
      return [{ line: index + 1, pattern, problem: 'policy-overridden' }];
    }
    return isBypass(setting) ? [{ line: index + 1, pattern, problem: 'policy-bypass' }] : [];
  });
}

/** Policy keys no line sets to an acceptable value (the pattern names the key). */
function missingPolicy(lines: readonly string[]): ExcludeViolation[] {
  const settings = lines.map(parseSetting);
  return [RELEASE_AGE_KEY, ...Object.keys(POLICY)]
    .filter((key) => !settings.some((item) => item?.key === key && isPolicyValue(item) === true))
    .map((key) => ({ line: 0, pattern: key, problem: 'policy-missing' as const }));
}

/** The release age npm applies: the last acceptable min-release-age line, else the 7-day floor. */
export function releaseAgeDaysOf(npmrc: string): number {
  const values = npmrc
    .split(/\r?\n/u)
    .map(parseSetting)
    .filter((setting) => setting?.key === RELEASE_AGE_KEY && isPolicyValue(setting) === true)
    .map((setting) => Number(setting?.value));
  return values.at(-1) ?? MIN_RELEASE_AGE_DAYS;
}

/** One exclude line inside (or outside) its block; npm splits a value on commas. */
function excludeLineViolations(
  setting: Setting,
  block: Block,
  where: { readonly line: number; readonly todayIso: string },
): ExcludeViolation[] {
  const { line, todayIso } = where;
  const pattern = setting.value;
  const placement: ExcludeViolation[] = [];
  if (block.expires === null) {
    placement.push({ line, pattern, problem: 'no-block' });
  } else if (block.expires < todayIso) {
    placement.push({ line, pattern, problem: 'expired' });
  }
  const catchAll = pattern
    .split(',')
    .map((part) => part.trim())
    .filter((part) => CATCH_ALL.test(part))
    .map((part) => ({ line, pattern: part, problem: 'catch-all' as const }));
  return [...placement, ...catchAll];
}

/**
 * Every exclude sits in a dated block that has not expired, names real packages, and expires no
 * later than today plus the release age: the release it exists for was published on or before
 * today, so a later date was extended or invented.
 */
function excludeViolations(lines: readonly string[], todayIso: string): ExcludeViolation[] {
  const limitIso = addDays(todayIso, releaseAgeDaysOf(lines.join('\n')));
  const violations: ExcludeViolation[] = [];
  let block: Block = { expires: null };
  lines.forEach((text, index) => {
    const header = BLOCK_HEADER.exec(text);
    const setting = parseSetting(text);
    if (header !== null) {
      block = { expires: header[1] ?? null };
      if (block.expires !== null && block.expires > limitIso) {
        violations.push({ line: index + 1, pattern: block.expires, problem: 'outlives-release' });
      }
    } else if (text.trim() === '') {
      block = { expires: null };
    } else if (setting !== null && EXCLUDE_KEY.test(setting.key)) {
      violations.push(...excludeLineViolations(setting, block, { line: index + 1, todayIso }));
    }
  });
  return violations;
}

/** Every exclude pattern the .npmrc names, in any spelling (npm splits a value on commas). */
export function excludePatternsOf(npmrc: string): readonly string[] {
  return npmrc
    .split(/\r?\n/u)
    .map(parseSetting)
    .filter((setting) => setting !== null && EXCLUDE_KEY.test(setting.key))
    .flatMap((setting) => (setting?.value ?? '').split(','))
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** Lists a missing or switched-off policy line and every exclude outside a valid dated block. */
export function checkReleaseAgeExcludes(npmrc: string, todayIso: string): ExcludeViolation[] {
  const lines = npmrc.split(/\r?\n/u);
  return [
    ...missingPolicy(lines),
    ...settingViolations(lines),
    ...excludeViolations(lines, todayIso),
  ];
}
