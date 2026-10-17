// src/core/game/game-module.ts
// Everything a game hands the app, as one value. The session host (game-session-host) adds what
// only the app can type (the Surface component, sounds, a tutorial) by intersection:
//   type HostedGame = GameModule<State, Move, Event, CanvasIntent> & { readonly Surface: ... }
// A real-time game adds `realtime: RealtimeSpec` (realtime-game-loop) the same way; a turn-based
// game has no realtime member at all.
import type { GameEngine } from '@/core/game/game-engine';
import type { GameInput, GameIntent } from '@/core/game/game-input';
import type { GameRules } from '@/core/game/game-rules';
import type { LevelsSpec } from '@/core/game/levels';
import type { MessageId } from '@/core/game/messages';
import type { PersistenceSpec } from '@/core/game/persistence';
import type { StatsSpec } from '@/core/game/stats';
import type { TestingSpec } from '@/core/game/testing';

export type GameIdentity = {
  /** kebab-case; equals the folder src/games/<id> and the id stored with every saved run. */
  readonly id: string;
  /** Catalog key of the game's name ('<id>.name'). */
  readonly nameId: MessageId;
};

export type GameModule<TState, TMove, TEvent, TIntent extends GameIntent> = {
  readonly identity: GameIdentity;
  /** create, listMoves, applyMove, outcome: pure, in src/games/<id>/rules/. */
  readonly engine: GameEngine<TState, TMove, TEvent>;
  /** panMode, selectRegions, intentToMove: from src/games/<id>/canvas/. */
  readonly input: GameInput<TState, TMove, TIntent>;
  readonly rules: GameRules<TState, TMove, TEvent>;
  readonly persistence: PersistenceSpec<TState, TMove>;
  readonly stats: StatsSpec<TEvent>;
  readonly testing: TestingSpec<TState, TMove>;
  /**
   * null until the game has levels (level-generation-and-solvers); the host opens no run without
   * them. A daily- or endless-only game has a LevelsSpec with packs: [] and table: [].
   */
  readonly levels: LevelsSpec<TState, TMove> | null;
};
