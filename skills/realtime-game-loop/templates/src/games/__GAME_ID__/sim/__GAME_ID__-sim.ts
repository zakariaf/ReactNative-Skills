// src/games/__GAME_ID__/sim/__GAME_ID__-sim.ts
'worklet';

import { nextU32, seedRng } from '@/core/rng/sfc32';

import type { RngState } from '@/core/rng/sfc32';

/** Flat typed-array state: lives in ONE shared value and is mutated in place on the UI thread. */
export type __GAME_PASCAL__Sim = {
  /** Per entity, stride 4: x, y, vx, vy in world units. Entity 0 is the player. */
  readonly body: Float32Array;
  /** Header [tick, entityCount, lastCommand, eventCount], then event triples [kind, value, tick]. */
  readonly ints: Int32Array;
  /** The sim's own sfc32 state (4 words). */
  readonly rng: Uint32Array;
};

/** The JSON form of a sim for saved runs: plain number arrays (typed arrays are not JSON-safe). */
export type __GAME_PASCAL__SimState = {
  readonly body: readonly number[];
  readonly header: readonly number[];
  readonly rng: readonly number[];
};

export const MAX_ENTITIES = 64;
export const MAX_EVENTS = 128;
/** World size in world units; the view scales it to the canvas. */
export const ARENA = 1000;
export const EVENT_INPUT = 1;
export const EVENT_EDGE = 2;
/** A wave ends every WAVE_TICKS ticks: the game's save point. */
export const EVENT_WAVE_END = 3;
export const WAVE_TICKS = 1800;
const TICK = 0;
const COUNT = 1;
const LAST_COMMAND = 2;
const EVENT_COUNT = 3;
const EVENTS = 4;
/** World units per tick at full stick. Speeds are per tick, never per millisecond. */
const PLAYER_SPEED = 3;
/** Command k (1…16) = (cos((k-1)·22.5°), sin((k-1)·22.5°)), y down; the stick gesture uses the same table. */
const STICK = [
  1, 0, 0.9238795325112867, 0.3826834323650898, 0.7071067811865476, 0.7071067811865476,
  0.3826834323650898, 0.9238795325112867, 0, 1, -0.3826834323650898, 0.9238795325112867,
  -0.7071067811865476, 0.7071067811865476, -0.9238795325112867, 0.3826834323650898, -1, 0,
  -0.9238795325112867, -0.3826834323650898, -0.7071067811865476, -0.7071067811865476,
  -0.3826834323650898, -0.9238795325112867, 0, -1, 0.3826834323650898, -0.9238795325112867,
  0.7071067811865476, -0.7071067811865476, 0.9238795325112867, -0.3826834323650898,
];

/** Draws from the sim's own sfc32 state (occasional draws only: it allocates a little). */
function drawU32(sim: __GAME_PASCAL__Sim): number {
  const state: RngState = [sim.rng[0] ?? 0, sim.rng[1] ?? 0, sim.rng[2] ?? 0, sim.rng[3] ?? 0];
  const draw = nextU32(state);
  sim.rng.set(draw.state);
  return draw.value;
}

/** Every buffer at its maximum size, allocated once; nothing is allocated per tick. */
function emptySim(): __GAME_PASCAL__Sim {
  return {
    body: new Float32Array(MAX_ENTITIES * 4),
    ints: new Int32Array(EVENTS + MAX_EVENTS * 3),
    rng: new Uint32Array(4),
  };
}

/** A fresh run: the player in the centre and `entities` bodies placed by the seeded RNG. */
export function create__GAME_PASCAL__Sim(seed: number, entities: number): __GAME_PASCAL__Sim {
  const sim = emptySim();
  sim.rng.set(seedRng(seed));
  const count = Math.min(entities + 1, MAX_ENTITIES);
  sim.ints[COUNT] = count;
  sim.body[0] = ARENA / 2;
  sim.body[1] = ARENA / 2;
  for (let e = 1; e < count; e += 1) {
    sim.body[e * 4] = drawU32(sim) % ARENA;
    sim.body[e * 4 + 1] = drawU32(sim) % ARENA;
    sim.body[e * 4 + 2] = (drawU32(sim) % 5) - 2;
    sim.body[e * 4 + 3] = (drawU32(sim) % 5) - 2;
  }
  return sim;
}

/** JS, at save points only: the JSON state of a sim copy (the event queue is not part of it). */
export function snapshot__GAME_PASCAL__Sim(sim: __GAME_PASCAL__Sim): __GAME_PASCAL__SimState {
  return {
    body: Array.from(sim.body),
    header: Array.from(sim.ints.subarray(0, EVENT_COUNT)),
    rng: Array.from(sim.rng),
  };
}

/** JS: rebuilds the typed arrays from a saved state; the restored run continues exactly. */
export function restore__GAME_PASCAL__Sim(state: __GAME_PASCAL__SimState): __GAME_PASCAL__Sim {
  const sim = emptySim();
  sim.body.set(state.body.slice(0, sim.body.length));
  sim.ints.set(state.header.slice(0, EVENT_COUNT));
  sim.rng.set(state.rng.slice(0, 4));
  return sim;
}

/**
 * Queue slots kept free for the events that must never drop, at most one of each per frame: the
 * input change (the replay log), the save point (a wave end) and the run end. A catch-up frame runs
 * up to 30 ticks, and a burst of edge or hit events must not crowd them out.
 */
const RESERVED_EVENTS = 3;

/** Input, save-point and run-end events use the reserved slots; add the game's run-end kind here. */
function isKeptEvent(kind: number): boolean {
  return kind === EVENT_INPUT || kind === EVENT_WAVE_END;
}

/**
 * Appends one [kind, value, tick] triple. A full queue drops the event instead of allocating; other
 * kinds (edge, hit) stop RESERVED_EVENTS slots early, so input and save-point events never drop.
 */
function pushEvent(sim: __GAME_PASCAL__Sim, kind: number, value: number): void {
  const count = sim.ints[EVENT_COUNT] ?? 0;
  if (count >= (isKeptEvent(kind) ? MAX_EVENTS : MAX_EVENTS - RESERVED_EVENTS)) return;
  const at = EVENTS + count * 3;
  sim.ints[at] = kind;
  sim.ints[at + 1] = value;
  sim.ints[at + 2] = sim.ints[TICK] ?? 0;
  sim.ints[EVENT_COUNT] = count + 1;
}

function movePlayer(sim: __GAME_PASCAL__Sim, command: number): void {
  const dx = command === 0 ? 0 : (STICK[(command - 1) * 2] ?? 0);
  const dy = command === 0 ? 0 : (STICK[(command - 1) * 2 + 1] ?? 0);
  sim.body[0] = Math.min(ARENA, Math.max(0, (sim.body[0] ?? 0) + dx * PLAYER_SPEED));
  sim.body[1] = Math.min(ARENA, Math.max(0, (sim.body[1] ?? 0) + dy * PLAYER_SPEED));
}

/** Moves one axis (0 = x, 1 = y) of entity e by its velocity, bouncing off the arena edge. */
function moveAxis(sim: __GAME_PASCAL__Sim, e: number, axis: number): boolean {
  const next = (sim.body[e * 4 + axis] ?? 0) + (sim.body[e * 4 + 2 + axis] ?? 0);
  const isOutside = next < 0 || next > ARENA;
  if (isOutside) sim.body[e * 4 + 2 + axis] = -(sim.body[e * 4 + 2 + axis] ?? 0);
  sim.body[e * 4 + axis] = Math.min(ARENA, Math.max(0, next));
  return isOutside;
}

/** Gameplay slot: replace with the game's rules (chase, collide, spawn). Integer-safe maths only. */
function moveEntity(sim: __GAME_PASCAL__Sim, e: number): void {
  const isBounceX = moveAxis(sim, e, 0);
  const isBounceY = moveAxis(sim, e, 1);
  if (isBounceX || isBounceY) pushEvent(sim, EVENT_EDGE, e);
}

/** One fixed tick. Records every command change as (tick, command) for replays. */
export function step__GAME_PASCAL__Sim(sim: __GAME_PASCAL__Sim, command: number): void {
  if (command !== sim.ints[LAST_COMMAND]) {
    pushEvent(sim, EVENT_INPUT, command);
    sim.ints[LAST_COMMAND] = command;
  }
  movePlayer(sim, command);
  for (let e = 1; e < (sim.ints[COUNT] ?? 0); e += 1) moveEntity(sim, e);
  const tick = (sim.ints[TICK] ?? 0) + 1;
  sim.ints[TICK] = tick;
  if (tick % WAVE_TICKS === 0) pushEvent(sim, EVENT_WAVE_END, tick);
}

/** Copies this frame's events out as [kind, value, tick, …] and clears the queue. */
export function drain__GAME_PASCAL__Events(sim: __GAME_PASCAL__Sim): readonly number[] {
  const count = sim.ints[EVENT_COUNT] ?? 0;
  const events = Array.from(sim.ints.subarray(EVENTS, EVENTS + count * 3));
  sim.ints[EVENT_COUNT] = 0;
  return events;
}

/** Current tick (gameplay time is ticks, never milliseconds). */
export function simTick(sim: __GAME_PASCAL__Sim): number {
  return sim.ints[TICK] ?? 0;
}

/** Number of bodies in play, the player included. */
export function bodyCount(sim: __GAME_PASCAL__Sim): number {
  return sim.ints[COUNT] ?? 0;
}
