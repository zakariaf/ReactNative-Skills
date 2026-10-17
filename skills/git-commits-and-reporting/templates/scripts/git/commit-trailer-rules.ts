// scripts/git/commit-trailer-rules.ts
// The trailer half of the commit-message rules (commit-message-rules.ts holds the header and body
// half): trailers sit in the last paragraph, Gate-Change and Spec-Change give a real reason,
// Spec-Change names the requirement that changed, and Gate-Change appears exactly when a changed
// file matches quality-gates.json "gatedPaths" (the matcher belongs to quality-gates).
import { gatedFilesIn } from '../quality/gated-paths.ts';

export type CommitProblem = {
  readonly rule: string;
  readonly line: number;
  readonly message: string;
  readonly fix: string;
};

/** How a commit names the requirement it serves (contracts/commits.json "requirementRef"). */
export type RequirementRule = {
  /** A requirement reference: a spec ID, an issue number, a ticket key. */
  readonly pattern: RegExp;
  /** True: a feat or fix body outside exemptScopes must name one (rule spec-ref-missing). */
  readonly required: boolean;
  readonly exemptScopes: readonly string[];
};

/** The fix printed for each rule id (check-commits.mjs prints the same ids). */
const FIXES: Readonly<Record<string, string>> = {
  'header-format': 'Write "<type>(<scope>): <imperative subject>".',
  'header-type': 'Use feat, fix, perf, refactor, test, docs, build, ci, chore, style or revert.',
  'scope-missing': 'Name where the change lives: a feature folder, a src/ layer or a fixed scope.',
  'header-scope': 'Use a scope from the list, or add the folder to contracts/commits.json.',
  'header-length': 'Shorten the subject; the header holds at most 72 characters.',
  'subject-case': 'Start the subject in lowercase.',
  'subject-period': 'Drop the trailing period.',
  'subject-mood': 'Use the imperative, as in a command: "add", "fix", "keep".',
  'subject-vague': 'Say what changes for the user or the code.',
  'blank-line': 'Leave one blank line between the header and the body.',
  'body-missing': 'Add a body that says why the change was made.',
  'spec-ref-missing': 'Name the requirement the change serves (contracts/commits.json pattern).',
  'trailer-placement': 'Move every trailer into one final paragraph after a blank line.',
  'trailer-empty': 'Say why in a few words (at least 10 characters).',
  'spec-change-format': 'Write "Spec-Change: <requirement reference> <what changed>".',
  'gate-change-missing': 'Add a final paragraph "Gate-Change: <why the gate had to change>".',
  'gate-change-unneeded': 'Remove the trailer; gate changes are listed by it, so it must be exact.',
  'placeholder-left': 'Replace every placeholder of the template with real text.',
};

export const problem = (rule: string, line: number, message: string): CommitProblem => ({
  rule,
  line,
  message,
  fix: FIXES[rule] ?? '',
});

type Entry = { readonly text: string; readonly line: number };

const KNOWN_TRAILER = /^(Gate-Change|Spec-Change|Co-Authored-By|Signed-off-by|Refs):\s*(.*)$/iu;
const ANY_TRAILER = /^[A-Za-z-]+:\s/u;
const MOVABLE_TRAILER = /^(Gate-Change|Spec-Change|Co-Authored-By):/iu;
const MIN_REASON_LENGTH = 10;

/** True for a line that reads as a trailer ("Key: value"). */
export const isTrailerText = (text: string): boolean => KNOWN_TRAILER.test(text);

function paragraphs(lines: readonly string[]): readonly (readonly Entry[])[] {
  const out: Entry[][] = [[]];
  lines.forEach((text, index) => {
    if (text.trim() === '') {
      out.push([]);
    } else {
      out.at(-1)?.push({ text, line: index + 1 });
    }
  });
  return out.filter((paragraph) => paragraph.length > 0);
}

const isTrailerLine = (entry: Entry): boolean =>
  KNOWN_TRAILER.test(entry.text) || ANY_TRAILER.test(entry.text);

/** [the trailer paragraph (empty when the last paragraph is prose), the misplaced trailers]. */
function splitTrailers(lines: readonly string[]): readonly (readonly Entry[])[] {
  const paras = paragraphs(lines);
  const last = paras.length > 1 ? (paras.at(-1) ?? []) : [];
  const isTrailers = last.length > 0 && last.every(isTrailerLine);
  const middle = paras.slice(1, isTrailers ? -1 : undefined).flat();
  return [isTrailers ? last : [], middle.filter((entry) => MOVABLE_TRAILER.test(entry.text))];
}

const named = (trailers: readonly Entry[], key: string): readonly Entry[] =>
  trailers.filter((entry) => entry.text.toLowerCase().startsWith(`${key.toLowerCase()}:`));

const reasonOf = (entry: Entry): string => entry.text.replace(/^[^:]+:\s*/u, '').trim();

function reasonProblems(
  trailers: readonly Entry[],
  requirement: RequirementRule,
): readonly CommitProblem[] {
  const vague = [...named(trailers, 'Gate-Change'), ...named(trailers, 'Spec-Change')]
    .filter((entry) => reasonOf(entry).length < MIN_REASON_LENGTH)
    .map((entry) => problem('trailer-empty', entry.line, `"${entry.text}" gives no real reason`));
  const unanchored = named(trailers, 'Spec-Change')
    .filter((entry) => !requirement.pattern.test(reasonOf(entry)))
    .map((entry) =>
      problem('spec-change-format', entry.line, `"${entry.text}" names no requirement`),
    );
  return [...vague, ...unanchored];
}

function gateProblems(
  trailers: readonly Entry[],
  files: readonly string[],
  gated: readonly string[],
): readonly CommitProblem[] {
  const [first] = named(trailers, 'Gate-Change');
  const gatedFiles = gatedFilesIn(files, gated);
  if (gatedFiles.length > 0 && first === undefined) {
    const list = gatedFiles.slice(0, 4).join(', ');
    return [problem('gate-change-missing', 1, `gated files changed without Gate-Change: ${list}`)];
  }
  if (gatedFiles.length === 0 && first !== undefined) {
    return [problem('gate-change-unneeded', first.line, 'a Gate-Change trailer but no gated file')];
  }
  return [];
}

export type TrailerInput = {
  readonly lines: readonly string[];
  /** The files the commit changes; null when unknown (the Gate-Change file rules are skipped). */
  readonly files: readonly string[] | null;
  readonly gatedPatterns: readonly string[];
  readonly requirement: RequirementRule;
};

/** Trailer placement, reasons, Spec-Change format, and (when the files are known) the gate rule. */
export function checkTrailers(input: TrailerInput): readonly CommitProblem[] {
  const [trailers = [], misplaced = []] = splitTrailers(input.lines);
  return [
    ...misplaced.map((entry) =>
      problem('trailer-placement', entry.line, `"${entry.text}" is not in the last paragraph`),
    ),
    ...reasonProblems(trailers, input.requirement),
    ...(input.files === null ? [] : gateProblems(trailers, input.files, input.gatedPatterns)),
  ];
}
