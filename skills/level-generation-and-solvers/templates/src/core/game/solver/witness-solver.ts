// src/core/game/solver/witness-solver.ts
// Winnability for games that draw their future from the RNG during play (dice rolls, a refilled
// tray, spawns), where no exact search fits. The game's reasonable player (its greedy bot on its own
// evaluation) plays the level from a fixed bot seed; a win is the proof, and its line is replayed
// through the real engine by levelsContractProblems. par is only that line's length: a filter for
// too-short levels, never shown to the player. Stars come from a score rule instead.
import { seedRng } from '@/core/rng/sfc32';

import type { SolvableEngine } from './search-problem';
import type { Solver } from '@/core/game/levels';
import type { BotPolicy } from '@/core/game/testing/play-bot';

/** The rules the witness plays, its player and that player's fixed RNG seed. */
export type WitnessSetup<TState, TMove, TEvent> = {
  readonly rules: SolvableEngine<TState, TMove, TEvent>;
  /** The game's greedy bot (testing.bot): its evaluation lives in rules/<id>-evaluate.ts. */
  readonly policy: BotPolicy<TState, TMove>;
  /** Seeds the bot's tie-breaks. Fixed forever: a new seed or evaluation regenerates the packs. */
  readonly botSeed: number;
};

/**
 * levels.solver for score-rated levels with random draws. solve(start, maxNodes) plays the policy
 * until the run ends; maxNodes caps the legal moves the policy is shown in total. A win returns
 * { kind: 'solved', par: line.length, line, final }; a loss or the cap returns budget-exceeded,
 * never unsolvable (a lost witness proves nothing about the level).
 */
export function createWitnessSolver<TState, TMove, TEvent>(
  setup: WitnessSetup<TState, TMove, TEvent>,
): Solver<TState, TMove> {
  const { rules, policy, botSeed } = setup;
  return {
    solve: (start, maxNodes) => {
      const line: TMove[] = [];
      let state = start;
      let rng = seedRng(botSeed);
      let nodes = 0;
      for (;;) {
        const result = rules.outcome(state);
        if (result.kind === 'won') return { kind: 'solved', par: line.length, line, final: state };
        if (result.kind === 'lost') return { kind: 'budget-exceeded' };
        const moves = rules.listMoves(state);
        nodes += moves.length;
        if (nodes > maxNodes) return { kind: 'budget-exceeded' };
        const choice = policy(state, moves, rng);
        rng = choice.rng;
        line.push(choice.move);
        state = rules.applyMove(state, choice.move).state;
      }
    },
  };
}
