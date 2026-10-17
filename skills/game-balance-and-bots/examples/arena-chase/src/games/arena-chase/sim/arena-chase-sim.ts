// src/games/arena-chase/sim/arena-chase-sim.ts
// Arena Chase, reduced to what balance needs: steer with the one-thumb stick, collect sparks, dodge
// the chasers. Every few sparks a pulse throws nearby chasers back to the edge (the
// twist). Fixed ticks of 1/120 s, typed arrays mutated in place, no allocation per tick.
'worklet';

import { nextU32, seedRng } from '@/core/rng/sfc32';

import { knobsFor, TUNING } from './arena-chase-tuning';

import type { Outcome } from '@/core/game/game-engine';
import type { RngState } from '@/core/rng/sfc32';

/** One plain object of typed arrays: ONE shared value on device, mutated in place by step. */
export type ArenaChaseSim = {
  /** Positions, stride 2: the player, the spark, then each chaser. */
  readonly body: Float32Array;
  /** [tick, hearts, sparks, goal, chasers, chaserSpeed x100, charge, lastCommand, eventCount, events…]. */
  readonly ints: Int32Array;
  /** The sim's own sfc32 state (4 words). */
  readonly rng: Uint32Array;
};

export const ARENA = 1000;
export const MAX_CHASERS = 8;
/** Event kinds, drained as [kind, value, tick] triples. */
export const EVENT_INPUT = 1;
export const EVENT_SPARK = 2;
export const EVENT_HIT = 3;
export const EVENT_PULSE = 4;
/** 16 compass directions of the stick, [dx, dy] per command 1…16 (0 = idle), unit length. */
export const STICK = [
  1, 0, 0.92388, 0.38268, 0.70711, 0.70711, 0.38268, 0.92388, 0, 1, -0.38268, 0.92388, -0.70711,
  0.70711, -0.92388, 0.38268, -1, 0, -0.92388, -0.38268, -0.70711, -0.70711, -0.38268, -0.92388, 0,
  -1, 0.38268, -0.92388, 0.70711, -0.70711, 0.92388, -0.38268,
];

const TICK = 0;
const HEARTS = 1;
const SPARKS = 2;
const GOAL = 3;
const CHASERS = 4;
const CHASER_SPEED = 5;
const CHARGE = 6;
const LAST_COMMAND = 7;
const EVENT_COUNT = 8;
const EVENTS = 9;
const MAX_EVENTS = 64;
/** Where each body starts in `body` (x at the index, y after it); bots read them, never write. */
export const PLAYER = 0;
export const SPARK = 2;
export const FIRST_CHASER = 4;
const HUNDRED = 100;
const EDGE_MARGIN = 60;
const SIDES = 4;
const LOSE_HEARTS = 'arena-chase.lose.out-of-hearts';
const LOSE_TIME = 'arena-chase.lose.time-up';

function drawU32(sim: ArenaChaseSim): number {
  const state: RngState = [sim.rng[0] ?? 0, sim.rng[1] ?? 0, sim.rng[2] ?? 0, sim.rng[3] ?? 0];
  const draw = nextU32(state);
  sim.rng.set(draw.state);
  return draw.value;
}

function pushEvent(sim: ArenaChaseSim, kind: number, value: number): void {
  const count = sim.ints[EVENT_COUNT] ?? 0;
  if (count >= MAX_EVENTS) return; // a full queue drops events; the sim never grows
  const at = EVENTS + count * 3;
  sim.ints[at] = kind;
  sim.ints[at + 1] = value;
  sim.ints[at + 2] = sim.ints[TICK] ?? 0;
  sim.ints[EVENT_COUNT] = count + 1;
}

/** Puts chaser `index` at a random point of a random edge (left, right, top or bottom). */
function spawnAtEdge(sim: ArenaChaseSim, index: number): void {
  const at = FIRST_CHASER + index * 2;
  const side = drawU32(sim) % SIDES;
  const along = drawU32(sim) % ARENA;
  const isSideWall = side < 2;
  const wall = side % 2 === 0 ? 0 : ARENA;
  sim.body[at] = isSideWall ? wall : along;
  sim.body[at + 1] = isSideWall ? along : wall;
}

/** Puts the spark at a random point away from the walls. */
function placeSpark(sim: ArenaChaseSim): void {
  const span = ARENA - EDGE_MARGIN * 2;
  sim.body[SPARK] = EDGE_MARGIN + (drawU32(sim) % span);
  sim.body[SPARK + 1] = EDGE_MARGIN + (drawU32(sim) % span);
}

export function createArenaChaseSim(seed: number, difficulty: number): ArenaChaseSim {
  const knobs = knobsFor(difficulty);
  const sim: ArenaChaseSim = {
    body: new Float32Array(FIRST_CHASER + MAX_CHASERS * 2),
    ints: new Int32Array(EVENTS + MAX_EVENTS * 3),
    rng: Uint32Array.from(seedRng(seed)),
  };
  const chasers = Math.min(knobs.chasers, MAX_CHASERS);
  sim.ints[HEARTS] = TUNING.hearts;
  sim.ints[GOAL] = knobs.sparkGoal;
  sim.ints[CHASERS] = chasers;
  sim.ints[CHASER_SPEED] = knobs.chaserSpeed;
  sim.body[PLAYER] = ARENA / 2;
  sim.body[PLAYER + 1] = ARENA / 2;
  // The opening is built for an early payoff: the first spark waits just right of the start.
  sim.body[SPARK] = ARENA / 2 + TUNING.firstSparkOffset;
  sim.body[SPARK + 1] = ARENA / 2;
  for (let index = 0; index < chasers; index += 1) spawnAtEdge(sim, index);
  return sim;
}

function distanceToPlayer(sim: ArenaChaseSim, at: number): number {
  const dx = (sim.body[at] ?? 0) - (sim.body[PLAYER] ?? 0);
  const dy = (sim.body[at + 1] ?? 0) - (sim.body[PLAYER + 1] ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function movePlayer(sim: ArenaChaseSim, command: number): void {
  if (command < 1 || command > STICK.length / 2) return;
  const speed = TUNING.playerSpeed / HUNDRED;
  const x = (sim.body[PLAYER] ?? 0) + (STICK[(command - 1) * 2] ?? 0) * speed;
  const y = (sim.body[PLAYER + 1] ?? 0) + (STICK[(command - 1) * 2 + 1] ?? 0) * speed;
  sim.body[PLAYER] = Math.min(ARENA, Math.max(0, x));
  sim.body[PLAYER + 1] = Math.min(ARENA, Math.max(0, y));
}

/** One chaser steps straight at the player; a touch takes a heart and sends it back to the edge. */
function moveChaser(sim: ArenaChaseSim, index: number): void {
  const at = FIRST_CHASER + index * 2;
  const distance = distanceToPlayer(sim, at);
  if (distance < TUNING.hitRadius) {
    sim.ints[HEARTS] = (sim.ints[HEARTS] ?? 0) - 1;
    pushEvent(sim, EVENT_HIT, index);
    spawnAtEdge(sim, index);
    return;
  }
  const step = (sim.ints[CHASER_SPEED] ?? 0) / HUNDRED / distance;
  sim.body[at] = (sim.body[at] ?? 0) + ((sim.body[PLAYER] ?? 0) - (sim.body[at] ?? 0)) * step;
  sim.body[at + 1] =
    (sim.body[at + 1] ?? 0) + ((sim.body[PLAYER + 1] ?? 0) - (sim.body[at + 1] ?? 0)) * step;
}

/** The pulse: every chaser within reach goes back to the edge. */
function pulse(sim: ArenaChaseSim): void {
  let thrown = 0;
  for (let index = 0; index < (sim.ints[CHASERS] ?? 0); index += 1) {
    if (distanceToPlayer(sim, FIRST_CHASER + index * 2) <= TUNING.pulseRadius) {
      spawnAtEdge(sim, index);
      thrown += 1;
    }
  }
  pushEvent(sim, EVENT_PULSE, thrown);
}

function collectSpark(sim: ArenaChaseSim): void {
  if (distanceToPlayer(sim, SPARK) > TUNING.sparkRadius) return;
  const sparks = (sim.ints[SPARKS] ?? 0) + 1;
  sim.ints[SPARKS] = sparks;
  pushEvent(sim, EVENT_SPARK, sparks);
  placeSpark(sim);
  const charge = (sim.ints[CHARGE] ?? 0) + 1;
  sim.ints[CHARGE] = charge >= TUNING.sparksPerPulse ? 0 : charge;
  if (charge >= TUNING.sparksPerPulse) pulse(sim);
}

/** Won, out of hearts or out of time; a plain boolean, so a tick allocates nothing. */
function isRunOver(sim: ArenaChaseSim): boolean {
  return (
    (sim.ints[SPARKS] ?? 0) >= (sim.ints[GOAL] ?? 0) ||
    (sim.ints[HEARTS] ?? 0) <= 0 ||
    (sim.ints[TICK] ?? 0) >= TUNING.roundTicks
  );
}

/** How many chasers this run has (the bots loop over them). */
export function chaserCount(sim: ArenaChaseSim): number {
  return sim.ints[CHASERS] ?? 0;
}

export function arenaChaseOutcome(sim: ArenaChaseSim): Outcome {
  const sparks = sim.ints[SPARKS] ?? 0;
  if (sparks >= (sim.ints[GOAL] ?? 0)) return { kind: 'won', score: sparks };
  if ((sim.ints[HEARTS] ?? 0) <= 0) return { kind: 'lost', reasonKey: LOSE_HEARTS };
  if ((sim.ints[TICK] ?? 0) >= TUNING.roundTicks) return { kind: 'lost', reasonKey: LOSE_TIME };
  return { kind: 'playing' };
}

/** One fixed tick with the current stick command; records every command change for replays. */
export function stepArenaChaseSim(sim: ArenaChaseSim, command: number): void {
  if (isRunOver(sim)) return;
  if (command !== sim.ints[LAST_COMMAND]) {
    pushEvent(sim, EVENT_INPUT, command);
    sim.ints[LAST_COMMAND] = command;
  }
  movePlayer(sim, command);
  for (let index = 0; index < (sim.ints[CHASERS] ?? 0); index += 1) moveChaser(sim, index);
  collectSpark(sim);
  sim.ints[TICK] = (sim.ints[TICK] ?? 0) + 1;
}

/** Copies this frame's events out as [kind, value, tick, …] and clears the queue. */
export function drainArenaChaseEvents(sim: ArenaChaseSim): readonly number[] {
  const count = sim.ints[EVENT_COUNT] ?? 0;
  const events = Array.from(sim.ints.subarray(EVENTS, EVENTS + count * 3));
  sim.ints[EVENT_COUNT] = 0;
  return events;
}

/** The number the HUD and the report call the score: sparks collected. */
export function arenaChaseScore(sim: ArenaChaseSim): number {
  return sim.ints[SPARKS] ?? 0;
}
