// src/games/arena-chase/testing/arena-chase-bot.test.ts
import { runSimBot } from '@/core/game-balance/run-sim-bot';
import { seedRng } from '@/core/rng/sfc32';
import {
  createArenaChaseSim,
  EVENT_HIT,
  EVENT_PULSE,
  EVENT_SPARK,
  FIRST_CHASER,
  PLAYER,
  SPARK,
} from '@/games/arena-chase/sim/arena-chase-sim';

import {
  commandToward,
  dodgePolicy,
  ARENA_CHASE_SIM,
  idlePolicy,
  tagArenaChaseEvent,
  wanderPolicy,
} from './arena-chase-bot';

import type { CommandPolicy } from '@/core/game-balance/run-sim-bot';
import type { ArenaChaseSim } from '@/games/arena-chase/sim/arena-chase-sim';

const RNG = seedRng(7);
const EAST = 1;
const SOUTH = 5;
const WEST = 9;

function run(policy: CommandPolicy<ArenaChaseSim>, seed: number, difficulty: number) {
  return runSimBot(ARENA_CHASE_SIM, {
    seed,
    difficulty,
    policy,
    maxTicks: 12_000,
    decideEveryTicks: 12,
    payoffStepTicks: 120,
  });
}

describe('tagArenaChaseEvent', () => {
  it('tags a spark as the payoff and a pulse that throws a chaser as the twist', () => {
    expect(tagArenaChaseEvent(EVENT_SPARK, 1)).toStrictEqual(['payoff']);
    expect(tagArenaChaseEvent(EVENT_PULSE, 2)).toStrictEqual(['twist']);
    expect(tagArenaChaseEvent(EVENT_PULSE, 0)).toStrictEqual([]);
    expect(tagArenaChaseEvent(EVENT_HIT, 0)).toStrictEqual([]);
  });
});

describe('commandToward', () => {
  it('picks the stick direction closest to a vector, without angles', () => {
    expect([commandToward(1, 0), commandToward(0, 1), commandToward(-1, 0.1)]).toStrictEqual([
      EAST,
      SOUTH,
      WEST,
    ]);
  });
});

describe('the command policies', () => {
  it('keeps idle still and lets wander pick one of the 16 directions from its own RNG', () => {
    const sim = createArenaChaseSim(1, 0);
    expect(idlePolicy(sim, RNG).command).toBe(0);
    const { command, rng } = wanderPolicy(sim, RNG);
    expect(command >= 1 && command <= 16).toBe(true);
    expect(rng).not.toStrictEqual(RNG);
  });

  it('sends dodge towards the spark when no chaser is close', () => {
    const sim = createArenaChaseSim(1, 0);
    sim.body.fill(0, FIRST_CHASER);
    sim.body.set([500, 500], PLAYER);
    sim.body.set([800, 500], SPARK);
    expect(dodgePolicy(sim, RNG).command).toBe(EAST);
  });

  it('turns dodge away from a close chaser, even one between it and the spark', () => {
    const sim = createArenaChaseSim(1, 0);
    sim.body.fill(0, FIRST_CHASER);
    sim.body.set([500, 500], PLAYER);
    sim.body.set([800, 500], SPARK);
    sim.body.set([540, 500], FIRST_CHASER);
    expect(dodgePolicy(sim, RNG).command).toBe(WEST);
  });

  it('orders the players: standing still loses fast, the dodger wins the first round', () => {
    const idle = run(idlePolicy, 3, 34);
    expect(idle.outcome).toStrictEqual({
      kind: 'lost',
      reasonKey: 'arena-chase.lose.out-of-hearts',
    });
    expect(idle.moves).toBeLessThan(600);
    const dodge = run(dodgePolicy, 3, 0);
    expect(dodge.outcome.kind).toBe('won');
    expect(dodge.firstAt.payoff).toBe(1);
  });
});
