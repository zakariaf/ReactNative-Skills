// motion-catalog.mjs: loads and judges the app's moment catalog (src/ui/motion/motion-moments.ts)
// and its motion tokens (src/theme/motion.ts) for check-motion.mjs (a helper, not an entry point).
// The tables below are this skill's own copy of the rules: the app may edit its catalog, never the
// rules that judge it.

import { errorText } from './app-modules.mjs';

export const MOMENT_KINDS = Object.freeze(['feedback', 'state', 'transition', 'attention', 'celebration', 'functional']);
export const REDUCED_ALTERNATIVES = Object.freeze(['instant', 'fade', 'static', 'none', 'unchanged']);
export const REDUCED_BY_KIND = Object.freeze({
  feedback: ['instant', 'fade', 'none'],
  state: ['instant', 'fade'],
  transition: ['fade', 'instant', 'none'],
  attention: ['static', 'none'],
  celebration: ['static', 'fade', 'none'],
  functional: ['unchanged'],
});
/** Library ceilings: an app's CELEBRATION_LIMITS may be stricter, never looser. */
export const CELEBRATION_CEILINGS = Object.freeze({ maxMs: 2000, maxPieces: 40 });

const MOMENT_KEYS = new Set(['kind', 'trigger', 'timing', 'reduced', 'pieces', 'repeat', 'cue', 'files']);
const TIMED_KEYS = new Set(['duration', 'easing', 'delay', 'stagger']);
const SPRUNG_KEYS = new Set(['spring', 'delay']);
const NAVIGATOR_KEYS = new Set(['navigator']);
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

/** Loads the motion tokens: { tokens: { MOTION_MS, EASING, SPRINGS } } or { error }. */
export async function loadMotionTokens(app, rel) {
  try {
    const module = await app.load(rel);
    const tokens = { MOTION_MS: module.MOTION_MS, EASING: module.EASING, SPRINGS: module.SPRINGS };
    const missing = Object.entries(tokens).filter(([, value]) => !isObject(value)).map(([name]) => name);
    if (missing.length > 0) return { error: `${rel} does not export ${missing.join(', ')}` };
    return { tokens };
  } catch (error) {
    return { error: `${rel} does not load: ${errorText(error)}` };
  }
}

/** Loads the catalog: { moments, limits } or { error }. */
export async function loadCatalog(app, rel) {
  try {
    const module = await app.load(rel);
    if (!isObject(module.MOTION_MOMENTS)) return { error: `${rel} does not export MOTION_MOMENTS (an object of moments)` };
    return { moments: module.MOTION_MOMENTS, limits: module.CELEBRATION_LIMITS };
  } catch (error) {
    return { error: `${rel} does not load with Node alone: ${errorText(error)} (keep it plain data with type-only imports)` };
  }
}

/** 1-based line of a moment id's key in the catalog source, else 1. */
export function lineOfMoment(source, id) {
  const match = new RegExp(`^\\s*['"]?${id.replace(/[$]/g, '\\$')}['"]?\\s*:`, 'm').exec(source ?? '');
  return match ? source.slice(0, match.index).split('\n').length : 1;
}

function tokenProblem(add, kind, value, table, what) {
  if (!Object.hasOwn(table, value)) add('moment-tokens', `${what} "${value}" is not a ${kind} token`, `Use one of: ${Object.keys(table).join(', ')} (src/theme/motion.ts); add a token there first when none fits (design-system-structure).`);
}

function timingProblems(id, moment, tokens, add) {
  const { timing } = moment;
  if (!isObject(timing)) return add('moment-catalog', `${id}.timing is not an object`, 'Write { duration, easing }, { spring } or { navigator: "stack" }.');
  const keys = Object.keys(timing);
  const shape = 'duration' in timing ? TIMED_KEYS : 'spring' in timing ? SPRUNG_KEYS : 'navigator' in timing ? NAVIGATOR_KEYS : null;
  if (shape === null) return add('moment-catalog', `${id}.timing names no duration, spring or navigator`, 'Write { duration, easing }, { spring } or { navigator: "stack" }.');
  const extra = keys.filter((key) => !shape.has(key));
  if (extra.length > 0) add('moment-catalog', `${id}.timing has ${extra.join(', ')}, which its kind of timing does not take`, `A ${[...shape][0]} timing takes ${[...shape].join(', ')}.`);
  const { MOTION_MS, EASING, SPRINGS } = tokens;
  if ('duration' in timing) {
    tokenProblem(add, 'MOTION_MS', timing.duration, MOTION_MS, `${id}.timing.duration`);
    if (timing.easing === undefined) add('moment-catalog', `${id}.timing has a duration but no easing`, 'Name an EASING token, or "linear" for a functional timer or a loop.');
    else if (timing.easing !== 'linear') tokenProblem(add, 'EASING', timing.easing, EASING, `${id}.timing.easing`);
    if (timing.stagger !== undefined) tokenProblem(add, 'MOTION_MS', timing.stagger, MOTION_MS, `${id}.timing.stagger`);
  }
  if ('spring' in timing) tokenProblem(add, 'SPRINGS', timing.spring, SPRINGS, `${id}.timing.spring`);
  if (timing.delay !== undefined) tokenProblem(add, 'MOTION_MS', timing.delay, MOTION_MS, `${id}.timing.delay`);
  if ('navigator' in timing && (timing.navigator !== 'stack' || moment.kind !== 'transition')) {
    add('moment-catalog', `${id}.timing.navigator is only for a transition moment, and its value is "stack"`, 'Declare a screen change as { kind: "transition", timing: { navigator: "stack" } }.');
  }
  return undefined;
}

function shapeProblems(id, moment, add) {
  const extra = Object.keys(moment).filter((key) => !MOMENT_KEYS.has(key));
  if (extra.length > 0) add('moment-catalog', `${id} has unknown keys: ${extra.join(', ')}`, `A moment takes ${[...MOMENT_KEYS].join(', ')}.`);
  if (!MOMENT_KINDS.includes(moment.kind)) add('moment-catalog', `${id}.kind is ${JSON.stringify(moment.kind)}`, `Use one of: ${MOMENT_KINDS.join(', ')}.`);
  if (typeof moment.trigger !== 'string' || moment.trigger.trim() === '') add('moment-catalog', `${id} has no trigger`, 'Say what starts it, in words a reviewer can find in the running app ("A task is marked done").');
  if (moment.cue !== undefined && (typeof moment.cue !== 'string' || moment.cue.trim() === '')) add('moment-catalog', `${id}.cue is not a cue id`, 'Name the cue the commit plays (the app\'s cue table), or leave cue out.');
  if (moment.files !== undefined && (!Array.isArray(moment.files) || moment.files.some((file) => typeof file !== 'string'))) add('moment-catalog', `${id}.files is not a list of paths`, 'List app-relative paths: ["src/ui/pressable-surface.tsx"].');
  if (moment.repeat !== undefined && (moment.kind !== 'feedback' || !isPositiveInteger(moment.repeat))) add('moment-catalog', `${id}.repeat is ${JSON.stringify(moment.repeat)} on a ${moment.kind} moment`, 'Only feedback moments repeat, a whole number of times (a shake); a loop is an attention moment played through useMotionLoop.');
  if (moment.pieces !== undefined && moment.kind !== 'celebration') add('moment-catalog', `${id}.pieces is set on a ${moment.kind} moment`, 'Only celebrations count pieces.');
  if (moment.kind === 'attention' && !(isObject(moment.timing) && 'duration' in moment.timing)) add('moment-catalog', `${id} is a loop without a duration`, 'Give an attention moment { duration, easing }: one swing of the loop.');
}

function reducedProblems(id, moment, tokens, add) {
  if (!REDUCED_ALTERNATIVES.includes(moment.reduced)) {
    add('moment-reduced', `${id}.reduced is ${JSON.stringify(moment.reduced)}`, `Declare what reduced motion shows: ${REDUCED_ALTERNATIVES.join(', ')}.`);
    return;
  }
  const allowed = REDUCED_BY_KIND[moment.kind];
  if (allowed && !allowed.includes(moment.reduced)) {
    add('moment-reduced', `${id} is a ${moment.kind} moment, which may not declare reduced "${moment.reduced}"`, `A ${moment.kind} moment declares one of: ${allowed.join(', ')}.`);
  }
  if (moment.reduced === 'fade' && !Object.hasOwn(tokens.MOTION_MS, 'reducedFade')) {
    add('moment-tokens', `${id} fades when motion is reduced, but MOTION_MS has no reducedFade`, 'Add MOTION_MS.reducedFade to the token file and src/theme/motion.ts (design-system-structure).');
  }
}

/** The celebration timeline from the tokens, or null when the moment is not timing-based. */
export function planOf(moment, tokens) {
  const { timing } = moment;
  if (!isObject(timing) || !('duration' in timing)) return null;
  const ms = (token) => (token === undefined ? 0 : tokens.MOTION_MS[token]);
  const pieces = moment.pieces ?? 1;
  const [delayMs, durationMs, staggerMs] = [ms(timing.delay), ms(timing.duration), ms(timing.stagger)];
  if (![delayMs, durationMs, staggerMs].every(Number.isFinite)) return null;
  return { delayMs, durationMs, staggerMs, pieces, totalMs: delayMs + durationMs + staggerMs * (pieces - 1) };
}

/** Problems with CELEBRATION_LIMITS itself (absent, or looser than the library ceilings). */
export function limitProblems(limits, add) {
  if (!isObject(limits) || !Number.isFinite(limits.maxMs) || !Number.isFinite(limits.maxPieces)) {
    add('celebration-budget', 'the catalog exports no CELEBRATION_LIMITS { maxMs, maxPieces }', `Export const CELEBRATION_LIMITS = { maxMs: 1600, maxPieces: 24 } as const (at most ${CELEBRATION_CEILINGS.maxMs} ms and ${CELEBRATION_CEILINGS.maxPieces} pieces).`);
    return { ...CELEBRATION_CEILINGS };
  }
  for (const key of ['maxMs', 'maxPieces']) {
    if (limits[key] > CELEBRATION_CEILINGS[key]) add('celebration-budget', `CELEBRATION_LIMITS.${key} is ${limits[key]}, above the library ceiling ${CELEBRATION_CEILINGS[key]}`, `Keep ${key} at or below ${CELEBRATION_CEILINGS[key]}: a celebration is a flourish, never a wait.`);
  }
  return { maxMs: Math.min(limits.maxMs, CELEBRATION_CEILINGS.maxMs), maxPieces: Math.min(limits.maxPieces, CELEBRATION_CEILINGS.maxPieces) };
}

function celebrationProblems(id, moment, tokens, limits, add) {
  if (moment.kind !== 'celebration') return;
  if (!isPositiveInteger(moment.pieces)) add('celebration-budget', `${id} does not say how many pieces move`, `Set pieces to a whole number from 1 to ${limits.maxPieces} (1 for a single sticker or title).`);
  const plan = planOf(moment, tokens);
  if (plan === null) {
    add('celebration-budget', `${id} has no timing budget (a spring has no fixed end)`, 'Give a celebration { duration, easing, delay?, stagger? } so its end is known.');
    return;
  }
  if (isPositiveInteger(moment.pieces) && moment.pieces > limits.maxPieces) add('celebration-budget', `${id} moves ${moment.pieces} pieces, more than ${limits.maxPieces}`, 'Move fewer pieces; the result itself carries the message.');
  if (plan.totalMs > limits.maxMs) add('celebration-budget', `${id} lasts ${plan.totalMs} ms (delay ${plan.delayMs} + duration ${plan.durationMs} + stagger ${plan.staggerMs} x ${plan.pieces - 1}), more than ${limits.maxMs} ms`, 'Shorten the delay or stagger token, or move fewer pieces.');
}

/** Every catalog problem: [{ id, rule, message, fix }] (id null for the whole catalog). */
export function catalogProblems({ moments, limits, tokens }) {
  const problems = [];
  const effective = limitProblems(limits, (rule, message, fix) => problems.push({ id: null, rule, message, fix }));
  for (const [id, moment] of Object.entries(moments)) {
    const add = (rule, message, fix) => problems.push({ id, rule, message, fix });
    if (!isObject(moment)) {
      add('moment-catalog', `${id} is not an object`, 'Write { kind, trigger, timing, reduced }.');
      continue;
    }
    shapeProblems(id, moment, add);
    timingProblems(id, moment, tokens, add);
    reducedProblems(id, moment, tokens, add);
    celebrationProblems(id, moment, tokens, effective, add);
  }
  return problems;
}

/** A files entry that still holds a template placeholder. */
export function isPlaceholder(path) {
  return PLACEHOLDER.test(path);
}

function timingText(moment, tokens) {
  const { timing } = moment;
  if (!isObject(timing)) return '?';
  if ('navigator' in timing) return 'native stack';
  if ('spring' in timing) return `spring ${timing.spring}`;
  const ms = (token) => `${token} ${tokens.MOTION_MS[token] ?? '?'} ms`;
  const parts = [ms(timing.duration), timing.easing];
  if (timing.delay) parts.push(`delay ${ms(timing.delay)}`);
  if (timing.stagger) parts.push(`stagger ${ms(timing.stagger)}`);
  return parts.join(', ');
}

/** The catalog as a Markdown table, for the reviewer (--table). */
export function catalogTable(moments, tokens) {
  const lines = ['| Moment | Kind | Trigger | Timing | Reduced | Lives in |', '|---|---|---|---|---|---|'];
  for (const [id, moment] of Object.entries(moments)) {
    const plan = moment.kind === 'celebration' ? planOf(moment, tokens) : null;
    const timing = `${timingText(moment, tokens)}${plan ? ` (total ${plan.totalMs} ms, ${plan.pieces} pieces)` : ''}`;
    lines.push(`| ${id} | ${moment.kind} | ${moment.trigger} | ${timing} | ${moment.reduced} | ${(moment.files ?? []).join(', ') || 'MOTION_MOMENTS.' + id} |`);
  }
  return lines;
}
