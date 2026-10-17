// src/features/parity/parity-request.ts
// The parity launch request and its strict parser. capture-app.mjs launches a development or preview
// build straight into a design frame with frame=<key>&theme=..&lang=..&date=..&motion=still&nonce=..
// (plus scrollY for a tall frame, probe=<region> for a probe launch): on iOS as the launch argument
// -parity "<query>", on Android as the link <scheme>://debug/parity?<query>. An unknown, repeated,
// missing or bad parameter refuses the whole launch, and the app then shows only the error screen: a
// silent fallback to the home screen would be compared with the wrong reference. Pure TypeScript.
import { err, ok } from '@/core/result';
import { isLanguage } from '@/i18n/languages';

import { PARITY_PLANS } from './parity-plans';

import type { ParityPlan, ParityPlanTable } from './parity-plans';
import type { Result } from '@/core/result';
import type { Language } from '@/i18n/languages';

export type ParityRequest = {
  /** The frame key: a key of the plan table. */
  readonly frame: string;
  readonly plan: ParityPlan;
  readonly theme: 'light' | 'dark';
  readonly language: Language;
  /** The design's fixture day the simulated clock answers, or null. */
  readonly date: string | null;
  readonly scrollY: number | undefined;
  /** A probe launch: the region to report, no frame state. */
  readonly probe: string | null;
  readonly nonce: string;
};

export type ParityRequestError =
  | { readonly kind: 'parity-unknown-param'; readonly param: string }
  | { readonly kind: 'parity-repeated-param'; readonly param: string }
  | { readonly kind: 'parity-missing-param'; readonly param: string }
  | { readonly kind: 'parity-bad-value'; readonly param: string; readonly value: string };

/** Search params as Expo Router hands them over: a repeated key arrives as an array. */
export type ParityLaunchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const PARAMS = ['frame', 'theme', 'lang', 'date', 'motion', 'scrollY', 'probe', 'nonce'] as const;
type ParityParam = (typeof PARAMS)[number];
const REQUIRED: readonly ParityParam[] = ['frame', 'theme', 'lang', 'motion', 'nonce'];

const BAD_VALUE = 'parity-bad-value';

const isParam = (name: string): name is ParityParam => (PARAMS as readonly string[]).includes(name);

const VALID: Readonly<Record<ParityParam, (value: string) => boolean>> = {
  frame: (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value),
  theme: (value) => value === 'light' || value === 'dark',
  lang: isLanguage,
  date: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  motion: (value) => value === 'still',
  scrollY: (value) => /^(0|[1-9]\d{0,5})$/.test(value),
  probe: (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value),
  nonce: (value) => /^[a-z0-9]{6,32}$/.test(value),
};

/** Every parameter once, each one valid; the first bad one refuses the launch. */
function readValues(
  params: ParityLaunchParams,
): Result<Partial<Record<ParityParam, string>>, ParityRequestError> {
  const values: Partial<Record<ParityParam, string>> = {};
  for (const [param, raw] of Object.entries(params)) {
    if (raw === undefined) continue;
    if (!isParam(param)) return err({ kind: 'parity-unknown-param', param });
    if (typeof raw !== 'string') return err({ kind: 'parity-repeated-param', param });
    if (!VALID[param](raw)) return err({ kind: BAD_VALUE, param, value: raw });
    values[param] = raw;
  }
  const missing = REQUIRED.find((param) => values[param] === undefined);
  return missing === undefined ? ok(values) : err({ kind: 'parity-missing-param', param: missing });
}

/** The checks that need the frame's plan: the fixture day, the probe region, a scroll offset. */
function planProblem(
  values: Partial<Record<ParityParam, string>>,
  plan: ParityPlan,
  fixtureDay: string | null,
): ParityRequestError | null {
  const { date, probe, scrollY } = values;
  if (date !== undefined && fixtureDay !== null && date !== fixtureDay)
    return { kind: BAD_VALUE, param: 'date', value: date };
  if (probe !== undefined && probe !== plan.probe)
    return { kind: BAD_VALUE, param: 'probe', value: probe };
  if (scrollY !== undefined && !plan.tall && scrollY !== '0')
    return { kind: BAD_VALUE, param: 'scrollY', value: scrollY };
  return null;
}

/**
 * Parses one parity launch. `fixtureDay` is the day the design's fixture draws: a launch for another
 * day is refused (the screen would show other dates than the reference). `plans` is the app's
 * PARITY_PLANS; a test passes a table of its own.
 */
export function parseParityRequest(
  params: ParityLaunchParams,
  fixtureDay: string | null,
  plans: ParityPlanTable = PARITY_PLANS,
): Result<ParityRequest, ParityRequestError> {
  const read = readValues(params);
  if (!read.ok) return read;
  const values = read.value;
  const frame = values.frame ?? '';
  const lang = values.lang ?? '';
  const plan = Object.hasOwn(plans, frame) ? plans[frame] : undefined;
  if (plan === undefined) return err({ kind: BAD_VALUE, param: 'frame', value: frame });
  if (!isLanguage(lang)) return err({ kind: BAD_VALUE, param: 'lang', value: lang });
  const problem = planProblem(values, plan, fixtureDay);
  if (problem !== null) return err(problem);
  return ok(requestOf({ frame, plan, language: lang }, values));
}

/** The request from values every check accepted. */
function requestOf(
  known: { readonly frame: string; readonly plan: ParityPlan; readonly language: Language },
  values: Partial<Record<ParityParam, string>>,
): ParityRequest {
  const { theme, date, scrollY, probe, nonce } = values;
  return {
    ...known,
    theme: theme === 'dark' ? 'dark' : 'light',
    date: date ?? null,
    scrollY: scrollY === undefined ? undefined : Number(scrollY),
    probe: probe ?? null,
    nonce: nonce ?? '',
  };
}

/** A failure as one line for the error screen and the error log. */
export function describeParityError(error: {
  readonly kind: string;
  readonly param: string;
  readonly value?: string;
}): string {
  return error.value === undefined
    ? `${error.kind} ${error.param}`
    : `${error.kind} ${error.param}=${error.value}`;
}
