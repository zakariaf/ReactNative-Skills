// scripts/git/commit-message-rules.ts
// The ONE commit-message rule set. The commit-msg hook (check-commit-message.ts) and the
// git-commits-and-reporting skill's check-commits.mjs enforce exactly these rules with these ids,
// and both test suites run commit-message-samples.json (a good message and at least one sample per
// rule), so a commit the hook accepts is a commit check-commits accepts, and the other way round.
import {
  checkTrailers,
  isTrailerText,
  problem,
  type CommitProblem,
  type RequirementRule,
} from './commit-trailer-rules.ts';

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'test',
  'docs',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
] as const;

export const MAX_HEADER_LENGTH = 72;

/** The facts the rules need about the repo (commit-config.ts reads them). */
export type CommitRules = {
  /** Every allowed scope. */
  readonly scopes: readonly string[];
  /** quality-gates.json "gatedPaths". */
  readonly gatedPatterns: readonly string[];
  readonly requirement: RequirementRule;
};

export type CommitCheckInput = {
  readonly message: string;
  /** The files the commit changes; null when unknown (the Gate-Change file rules are skipped). */
  readonly files: readonly string[] | null;
  readonly rules: CommitRules;
};

type Header = { readonly type: string; readonly scope: string };

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?!?: (?<subject>\S.*)$/u;
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/u;
const NOT_IMPERATIVE = new Set(
  (
    'added adds adding fixed fixes fixing updated updates updating changed changes changing ' +
    'removed removes removing created creates creating improved improves improving refactored ' +
    'refactors refactoring implemented implements implementing made makes making moved moves ' +
    'moving renamed renames renaming deleted deletes deleting introduced introduces introducing ' +
    'bumped bumps bumping upgraded upgrades upgrading replaced replaces replacing cleaned cleans ' +
    'cleaning wrote writes writing merged merges merging tested tests testing'
  ).split(' '),
);
const VAGUE =
  /^(wip|misc|stuff|update|updates|changes|change|fix|fixes|tweak|tweaks|cleanup|work|progress|temp|tmp)$/iu;
const SCISSORS = /^# -+ >8 -+$/mu;
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/u;

/** The message as git's editor flow stores it: no comment lines, nothing below the scissors. */
export function normalizeMessage(raw: string): string {
  const cut = SCISSORS.exec(raw);
  const kept = cut === null ? raw : raw.slice(0, cut.index);
  return kept
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace(/\s+$/u, '');
}

function scopeProblems(scope: string | undefined, allowed: readonly string[]): CommitProblem[] {
  if (scope === undefined || scope === '') {
    return [problem('scope-missing', 1, 'the header has no scope')];
  }
  return allowed.includes(scope)
    ? []
    : [problem('header-scope', 1, `scope "${scope}" is not one of ${allowed.join(', ')}`)];
}

function subjectProblems(subject: string): CommitProblem[] {
  const first = (subject.split(/\s+/u)[0] ?? '').toLowerCase();
  const checks: readonly (readonly [boolean, string, string])[] = [
    [/^[A-Z]/u.test(subject), 'subject-case', `subject "${subject}" starts with a capital letter`],
    [subject.endsWith('.'), 'subject-period', 'the subject ends with a period'],
    [NOT_IMPERATIVE.has(first), 'subject-mood', `subject starts with "${first}"`],
    [VAGUE.test(subject.trim()), 'subject-vague', `subject "${subject}" says nothing`],
  ];
  return checks.filter(([isFailed]) => isFailed).map(([, rule, text]) => problem(rule, 1, text));
}

function checkHeader(
  header: string,
  allowed: readonly string[],
): { readonly problems: readonly CommitProblem[]; readonly parsed: Header | null } {
  const groups = HEADER.exec(header)?.groups;
  if (groups === undefined) {
    const text = `header "${header}" is not "type(scope): subject"`;
    return { problems: [problem('header-format', 1, text)], parsed: null };
  }
  const { type = '', scope, subject = '' } = groups;
  const isKnownType = COMMIT_TYPES.some((known) => known === type);
  const problems = [
    ...(isKnownType ? [] : [problem('header-type', 1, `type "${type}" is unknown`)]),
    ...scopeProblems(scope, allowed),
    ...(header.length > MAX_HEADER_LENGTH
      ? [problem('header-length', 1, `header is ${String(header.length)} characters`)]
      : []),
    ...subjectProblems(subject),
  ];
  return { problems, parsed: { type, scope: scope ?? '' } };
}

/** A feat or fix says why (body-missing) and, when the repo asks, which requirement it serves. */
function featFixProblems(
  lines: readonly string[],
  parsed: Header,
  requirement: RequirementRule,
): CommitProblem[] {
  const body = lines.slice(1).join('\n').trim();
  const prose = lines
    .slice(1)
    .filter((line) => !isTrailerText(line))
    .join('\n')
    .trim();
  const problems: CommitProblem[] = [];
  if (prose === '') {
    problems.push(problem('body-missing', 1, `a ${parsed.type} commit has no body`));
  }
  const isExempt = requirement.exemptScopes.includes(parsed.scope);
  if (requirement.required && !isExempt && body !== '' && !requirement.pattern.test(body)) {
    problems.push(problem('spec-ref-missing', 1, 'the body names no requirement reference'));
  }
  return problems;
}

function checkBody(
  lines: readonly string[],
  parsed: Header | null,
  requirement: RequirementRule,
): CommitProblem[] {
  const hasBlankLine = lines.length < 2 || (lines[1] ?? '').trim() === '';
  const blank = hasBlankLine ? [] : [problem('blank-line', 2, 'the second line is not blank')];
  const isFeatOrFix = parsed?.type === 'feat' || parsed?.type === 'fix';
  return parsed !== null && isFeatOrFix
    ? [...blank, ...featFixProblems(lines, parsed, requirement)]
    : blank;
}

function checkPlaceholders(lines: readonly string[]): CommitProblem[] {
  return lines.flatMap((text, index) => {
    const found = PLACEHOLDER.exec(text);
    return found === null
      ? []
      : [problem('placeholder-left', index + 1, `placeholder ${found[0]} is left`)];
  });
}

/** Every problem with a commit message; an empty list means it may be committed. */
export function checkCommitMessage(input: CommitCheckInput): readonly CommitProblem[] {
  const lines = normalizeMessage(input.message).split('\n');
  const header = lines[0] ?? '';
  if (GIT_GENERATED.test(header)) {
    return [];
  }
  const { rules } = input;
  const { problems, parsed } = checkHeader(header, rules.scopes);
  return [
    ...problems,
    ...checkBody(lines, parsed, rules.requirement),
    ...checkTrailers({
      lines,
      files: input.files,
      gatedPatterns: rules.gatedPatterns,
      requirement: rules.requirement,
    }),
    ...checkPlaceholders(lines),
  ];
}
