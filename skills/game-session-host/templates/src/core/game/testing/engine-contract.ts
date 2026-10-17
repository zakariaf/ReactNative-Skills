// src/core/game/testing/engine-contract.ts
// The seeded contract run every game's tests call: it plays random games from several starts and
// reports every way the engine (and, once the canvas exists, the input) breaks the game contract.
import { nextInt, seedRng } from '@/core/rng/sfc32';

import { contractIntentProblems, inputMemberProblems } from './contract-intents';
import { jsonOf, jsonShapeProblems } from './json-shape';

import type { GameEngine, Outcome } from '@/core/game/game-engine';
import type { GameInput, GameIntent } from '@/core/game/game-input';
import type { PersistenceSpec } from '@/core/game/persistence';
import type { RngState } from '@/core/rng/sfc32';

/** One start to explore: the same (seed, difficulty) pair the host passes to create. */
export type ContractStart = { readonly seed: number; readonly difficulty: number };

/** The game's levels.endless: with an endless mode, create(seed, difficulty) is never won. */
export type ContractEndless =
  { readonly kind: 'none' } | { readonly kind: 'endless'; readonly difficulty: number };

/** Everything the contract run needs; all of it comes from the game's own modules. */
export type EngineContractInput<TState, TMove, TEvent, TIntent extends GameIntent = GameIntent> = {
  readonly gameId: string;
  readonly engine: GameEngine<TState, TMove, TEvent>;
  readonly persistence: Pick<PersistenceSpec<TState, TMove>, 'parseState' | 'parseMove'>;
  readonly starts: readonly ContractStart[];
  /** Moves per explored game; a game that is still playing after this many just stops. */
  readonly maxMoves: number;
  /** The module's input members; leave out in the rules-only test, before the canvas exists. */
  readonly input?: GameInput<TState, TMove, TIntent>;
  /**
   * Intents to try in a state (tap every cell, every swipe, every drag): each move they yield must
   * be legal. Taps outside the select regions are also tried with every tapped target inside them
   * as the selection.
   */
  readonly intents?: (state: TState) => readonly TIntent[];
  /** levels.endless of a game with an endless mode: seeded play from that difficulty never wins. */
  readonly endless?: ContractEndless;
};

type Walk<TState, TMove, TEvent, TIntent extends GameIntent> = {
  readonly spec: EngineContractInput<TState, TMove, TEvent, TIntent>;
  readonly problems: string[];
  /** The endless difficulty when the game has an endless mode, else null. */
  readonly endless: number | null;
};

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The salt of the contract run's own move picker, so it never replays the level's draws. */
const PICKER_SALT = 0x2545f491;

function outcomeProblem(outcome: Outcome, moveCount: number, gameId: string): string | null {
  if (outcome.kind === 'lost' && !outcome.reasonKey.startsWith(`${gameId}.`)) {
    return `lost reasonKey "${outcome.reasonKey}" is not a ${gameId}.* catalog key`;
  }
  if (outcome.kind === 'won' && !(Number.isInteger(outcome.score) && outcome.score >= 0)) {
    return `won score ${String(outcome.score)} is not a whole number >= 0`;
  }
  return moveCount > 0 === (outcome.kind === 'playing')
    ? null
    : `listMoves has ${String(moveCount)} moves while outcome is ${outcome.kind}`;
}

function intentProblems<TState, TMove, TEvent, TIntent extends GameIntent>(
  walk: Walk<TState, TMove, TEvent, TIntent>,
  state: TState,
  moves: readonly TMove[],
): readonly string[] {
  const { input, intents } = walk.spec;
  if (input === undefined || intents === undefined) return [];
  return contractIntentProblems(input, { state, moves }, intents(state));
}

/** With an endless mode, a won outcome at the endless difficulty is a contract break. */
function endlessProblem(endless: number | null, start: ContractStart, outcome: Outcome) {
  return endless === start.difficulty && outcome.kind === 'won'
    ? `the endless run was won (score ${String(outcome.score)}); an endless run only ever ends lost`
    : null;
}

function roundTripProblems<TState, TMove, TEvent, TIntent extends GameIntent>(
  walk: Walk<TState, TMove, TEvent, TIntent>,
  state: TState,
  move: TMove,
): string[] {
  const { parseState, parseMove } = walk.spec.persistence;
  const problems = [...jsonShapeProblems(state), ...jsonShapeProblems(move, 'move')];
  if (jsonOf(parseState(JSON.parse(jsonOf(state)))) !== jsonOf(state)) {
    problems.push('parseState does not return a saved state unchanged');
  }
  if (jsonOf(parseMove(JSON.parse(jsonOf(move)))) !== jsonOf(move)) {
    problems.push(`parseMove does not return ${jsonOf(move)} unchanged`);
  }
  return problems;
}

type Damaged = { readonly copy: unknown; readonly what: string };

function jsonKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}

/**
 * Saved data a parser must refuse: JSON of another kind than `value` and, for an object, an empty
 * object and `value` with one top-level field of the wrong type. A cast (`json as State`) accepts
 * them all; a parser that builds the value field by field returns null.
 */
function damagedCopies(value: unknown): Damaged[] {
  const others = [null, {}, [], 'damaged', 42, true]
    .filter((item) => jsonKind(item) !== jsonKind(value))
    .map((copy) => ({ copy, what: jsonOf(copy) }));
  if (jsonKind(value) !== 'object') return others;
  const record = value as Readonly<Record<string, unknown>>;
  const fields = Object.keys(record).map((key) => {
    const wrong = typeof record[key] === 'string' ? 12_345 : 'damaged';
    return { copy: { ...record, [key]: wrong }, what: `"${key}" set to ${jsonOf(wrong)}` };
  });
  return Object.keys(record).length > 0 ? [...others, { copy: {}, what: '{}' }, ...fields] : others;
}

/** parseState and parseMove return null for damaged data (rule: never cast saved JSON). */
function damagedParseProblems<TState, TMove>(
  persistence: Pick<PersistenceSpec<TState, TMove>, 'parseState' | 'parseMove'>,
  state: TState,
  move: TMove | undefined,
): string[] {
  const accepts = (parse: (json: unknown) => unknown, value: unknown): string | undefined =>
    damagedCopies(JSON.parse(jsonOf(value))).find((item) => parse(item.copy) !== null)?.what;
  const problems: string[] = [];
  const badState = accepts(persistence.parseState, state);
  if (badState !== undefined)
    problems.push(`parseState accepts damaged data (${badState}); it must return null`);
  const badMove = move === undefined ? undefined : accepts(persistence.parseMove, move);
  if (badMove !== undefined)
    problems.push(`parseMove accepts damaged data (${badMove}); it must return null`);
  return problems;
}

/** Applies one move and checks purity, events and the JSON round trip. */
function stepProblems<TState, TMove, TEvent, TIntent extends GameIntent>(
  walk: Walk<TState, TMove, TEvent, TIntent>,
  state: TState,
  move: TMove,
): { readonly next: TState; readonly problems: string[] } {
  const before = jsonOf(state);
  const result = walk.spec.engine.applyMove(state, move);
  const problems = roundTripProblems(walk, result.state, move);
  if (jsonOf(state) !== before) problems.push('applyMove changed its input state (must be pure)');
  for (const event of result.events) {
    const kind: unknown =
      typeof event === 'object' && event !== null ? Reflect.get(event, 'kind') : undefined;
    if (typeof kind !== 'string' || !KEBAB.test(kind))
      problems.push(`event ${jsonOf(event)} has no kebab-case kind`);
  }
  return { next: result.state, problems };
}

/** Checks one reached state (outcome, endless rule, intents) and returns its legal moves. */
function checkState<TState, TMove, TEvent, TIntent extends GameIntent>(
  walk: Walk<TState, TMove, TEvent, TIntent>,
  start: ContractStart,
  state: TState,
): readonly TMove[] {
  const { engine, gameId } = walk.spec;
  const moves = engine.listMoves(state);
  const outcome = engine.outcome(state);
  const problem =
    outcomeProblem(outcome, moves.length, gameId) ?? endlessProblem(walk.endless, start, outcome);
  if (problem !== null) walk.problems.push(problem);
  walk.problems.push(...intentProblems(walk, state, moves));
  return moves;
}

/**
 * Plays one seeded random game and returns the moves it made. Every reached state is checked,
 * the one the last allowed move produced included.
 */
function playOnce<TState, TMove, TEvent, TIntent extends GameIntent>(
  walk: Walk<TState, TMove, TEvent, TIntent>,
  start: ContractStart,
): TMove[] {
  const { engine, maxMoves } = walk.spec;
  let state = engine.create(start.seed, start.difficulty);
  let rng: RngState = seedRng(start.seed ^ PICKER_SALT);
  const line: TMove[] = [];
  walk.problems.push(...jsonShapeProblems(state));
  while (line.length < maxMoves && walk.problems.length === 0) {
    const moves = checkState(walk, start, state);
    const pick = nextInt(rng, Math.max(moves.length, 1));
    const move = moves[pick.value];
    if (move === undefined) return line;
    rng = pick.state;
    const step = stepProblems(walk, state, move);
    walk.problems.push(...step.problems);
    state = step.next;
    line.push(move);
  }
  if (walk.problems.length === 0) checkState(walk, start, state);
  return line;
}

function replayProblem<TState, TMove, TEvent>(
  engine: GameEngine<TState, TMove, TEvent>,
  start: ContractStart,
  line: readonly TMove[],
): string | null {
  const replay = (): string =>
    jsonOf(
      line.reduce(
        (state, move) => engine.applyMove(state, move).state,
        engine.create(start.seed, start.difficulty),
      ),
    );
  return replay() === replay()
    ? null
    : 'replaying the same moves from the same seed gives a different state';
}

/** The starts to walk: the given ones plus, with an endless mode, each seed at its difficulty. */
function startsOf(starts: readonly ContractStart[], endless: number | null): ContractStart[] {
  if (endless === null) return [...starts];
  const seeds = [...new Set(starts.map((start) => start.seed))];
  const extra = seeds
    .filter((seed) => !starts.some((start) => start.seed === seed && start.difficulty === endless))
    .map((seed) => ({ seed, difficulty: endless }));
  return [...starts, ...extra];
}

/**
 * Every way the game breaks its contract, or []: a create that starts in play and is
 * deterministic, deterministic replays, JSON-safe states and moves that parseState/parseMove
 * return unchanged (and damaged saved data they refuse with null), a pure applyMove, kebab-case event kinds, listMoves empty exactly when the
 * game is over, catalog lose reasons, whole win scores and, with an endless mode, seeded play from
 * the endless difficulty never reaching won. Given `input` (and `intents`): a valid panMode and
 * selectRegions, intentToMove never producing a move listMoves does not list (taps with a
 * selection included), never acting on a tap inside a select region, and never accepting an
 * intent the surface's panMode never sends.
 */
export function engineContractProblems<TState, TMove, TEvent, TIntent extends GameIntent>(
  spec: EngineContractInput<TState, TMove, TEvent, TIntent>,
): readonly string[] {
  const endless = spec.endless?.kind === 'endless' ? spec.endless.difficulty : null;
  const members = spec.input === undefined ? [] : inputMemberProblems(spec.input);
  return startsOf(spec.starts, endless).flatMap((start) => {
    const label = `seed ${String(start.seed)} difficulty ${String(start.difficulty)}`;
    const created = [0, 1].map(() => jsonOf(spec.engine.create(start.seed, start.difficulty)));
    const walk: Walk<TState, TMove, TEvent, TIntent> = { spec, problems: [...members], endless };
    if (created[0] !== created[1]) walk.problems.push('create gives two different states');
    const opening = spec.engine.outcome(spec.engine.create(start.seed, start.difficulty)).kind;
    if (opening !== 'playing')
      walk.problems.push(`create starts a game that is already ${opening}`);
    const line = playOnce(walk, start);
    const replay = replayProblem(spec.engine, start, line);
    if (replay !== null) walk.problems.push(replay);
    const [first] = line;
    const fresh = spec.engine.create(start.seed, start.difficulty);
    const played = first === undefined ? fresh : spec.engine.applyMove(fresh, first).state;
    walk.problems.push(...damagedParseProblems(spec.persistence, played, first));
    return [...new Set(walk.problems)].map((problem) => `${label}: ${problem}`);
  });
}
