// src/games/__GAME_ID__/rules/__GAME_ID__-persistence.ts
import type { Cell, __GAME_PASCAL__Move, __GAME_PASCAL__State } from './__GAME_ID__-types';
import type { PersistenceSpec } from '@/core/game/persistence';

/** Bump when the shape of the state or the move changes, and add a migrateState step. */
export const __GAME_CONST___STATE_VERSION = 1;

function isRecord(json: unknown): json is Readonly<Record<string, unknown>> {
  return typeof json === 'object' && json !== null && !Array.isArray(json);
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function parseCells(json: unknown, size: number): Cell[] | null {
  if (!Array.isArray(json) || json.length !== size) return null;
  const items: readonly unknown[] = json;
  const cells = items.filter((item): item is Cell => item === 0 || item === 1);
  return cells.length === size ? cells : null;
}

/** JSON from storage -> a fresh, typed state, or null (the host then drops only the run). */
export function parseState(json: unknown): __GAME_PASCAL__State | null {
  if (!isRecord(json)) return null;
  const { cols, rows, moves, maxMoves } = json;
  if (!isCount(cols, 1) || !isCount(rows, 1) || !isCount(moves, 0) || !isCount(maxMoves, 1)) {
    return null;
  }
  const cells = parseCells(json['cells'], cols * rows);
  return cells === null ? null : { cols, rows, cells, moves, maxMoves };
}

/** One logged move -> a typed move, or null (the host then drops only the undo history). */
export function parseMove(json: unknown): __GAME_PASCAL__Move | null {
  if (!isRecord(json) || json['kind'] !== 'toggle') return null;
  const { col, row } = json;
  return isCount(col, 0) && isCount(row, 0) ? { kind: 'toggle', col, row } : null;
}

export const __GAME_CONST___PERSISTENCE: PersistenceSpec<
  __GAME_PASCAL__State,
  __GAME_PASCAL__Move
> = {
  stateVersion: __GAME_CONST___STATE_VERSION,
  parseState,
  parseMove,
  // Version 1 has no older shape to upgrade from.
  migrateState: () => null,
  savePolicy: { kind: 'after-every-move' },
};
