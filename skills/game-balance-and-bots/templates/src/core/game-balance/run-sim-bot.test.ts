// src/core/game-balance/run-sim-bot.test.ts
import { nextInt } from '@/core/rng/sfc32';

import { runSimBot } from './run-sim-bot';

import type { CommandPolicy, SimBotGame } from './run-sim-bot';

/** A one-dimensional runner: command 1 moves right, 2 moves left; reach 30 to win, fall below -5 to lose. */
type Runner = { readonly body: Int32Array; readonly events: number[] };
const X = 0;
const TICK = 1;
const EVENT_CHECKPOINT = 1;
const STEP_BY_COMMAND = [0, 1, -1];

const RUNNER: SimBotGame<Runner> = {
  create: (_seed, difficulty) => ({ body: Int32Array.of(difficulty, 0), events: [] }),
  step: (sim, command) => {
    const body = sim.body; // typed arrays are mutated in place, like a real sim
    const before = body[X] ?? 0;
    const after = before + (STEP_BY_COMMAND[command] ?? 0);
    body[X] = after;
    if (Math.floor(after / 10) > Math.floor(before / 10))
      sim.events.push(EVENT_CHECKPOINT, after, body[TICK] ?? 0);
    body[TICK] = (body[TICK] ?? 0) + 1;
  },
  drainEvents: (sim) => sim.events.splice(0, sim.events.length),
  outcome: (sim) => {
    const x = sim.body[X] ?? 0;
    if (x >= 30) return { kind: 'won', score: x };
    return x < -5 ? { kind: 'lost', reasonKey: 'runner.fell' } : { kind: 'playing' };
  },
  scoreOf: (sim) => sim.body[X] ?? 0,
  tagEvent: (kind) => (kind === EVENT_CHECKPOINT ? ['payoff'] : []),
};

const forward: CommandPolicy<Runner> = (_sim, rng) => ({ command: 1, rng });
const wander: CommandPolicy<Runner> = (_sim, rng) => {
  const draw = nextInt(rng, 3);
  return { command: draw.value, rng: draw.state };
};

describe('runSimBot', () => {
  it('steps fixed ticks until the outcome and tags drained events', () => {
    const run = runSimBot(RUNNER, {
      seed: 1,
      difficulty: 0,
      policy: forward,
      maxTicks: 500,
      decideEveryTicks: 12,
      payoffStepTicks: 1,
    });
    expect(run.outcome).toStrictEqual({ kind: 'won', score: 30 });
    expect([run.moves, run.isCapped, run.firstAt.payoff, run.counts.payoff]).toStrictEqual([
      30,
      false,
      10,
      3,
    ]);
  });

  it('counts the first payoff in payoffStepTicks steps (seconds at 120), rounding up', () => {
    const options = {
      seed: 1,
      difficulty: 0,
      policy: forward,
      maxTicks: 500,
      decideEveryTicks: 12,
    };
    expect(runSimBot(RUNNER, { ...options, payoffStepTicks: 4 }).firstAt.payoff).toBe(3);
    expect(runSimBot(RUNNER, { ...options, payoffStepTicks: 120 }).firstAt.payoff).toBe(1);
  });

  it('gives the same trace for the same seed and policy', () => {
    const options = {
      seed: 9,
      difficulty: 0,
      policy: wander,
      maxTicks: 400,
      decideEveryTicks: 12,
      payoffStepTicks: 120,
    };
    expect(runSimBot(RUNNER, options)).toStrictEqual(runSimBot(RUNNER, options));
  });

  it('marks a run still playing at maxTicks as capped', () => {
    const idle: CommandPolicy<Runner> = (_sim, rng) => ({ command: 0, rng });
    const run = runSimBot(RUNNER, {
      seed: 1,
      difficulty: 0,
      policy: idle,
      maxTicks: 50,
      decideEveryTicks: 12,
      payoffStepTicks: 120,
    });
    expect([run.moves, run.isCapped]).toStrictEqual([50, true]);
  });
});
