// src/games/pig/rules/pig-persistence.ts
import type { PigMove, PigState } from './pig-types';
import type { PersistenceSpec } from '@/core/game/persistence';
import type { RngState } from '@/core/rng/sfc32';

export const PIG_STATE_VERSION = 1;

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(json: unknown): json is JsonRecord {
  return typeof json === 'object' && json !== null && !Array.isArray(json);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isWord(value: unknown): value is number {
  return isCount(value) && value <= 0xffffffff;
}

/** The four unsigned 32-bit words of an sfc32 state, or null. */
function parseRng(json: unknown): RngState | null {
  if (!Array.isArray(json) || json.length !== 4) return null;
  const words: readonly unknown[] = json;
  const [a, b, c, d] = words;
  return isWord(a) && isWord(b) && isWord(c) && isWord(d) ? [a, b, c, d] : null;
}

function parseScore(
  json: JsonRecord,
): Pick<PigState, 'difficulty' | 'target' | 'banked' | 'turnTotal'> | null {
  const { difficulty, target, banked, turnTotal } = json;
  if (!isCount(difficulty) || !isCount(target) || !isCount(banked) || !isCount(turnTotal))
    return null;
  return { difficulty, target, banked, turnTotal };
}

function parseTurns(
  json: JsonRecord,
): Pick<PigState, 'turn' | 'maxTurns' | 'busts' | 'maxBusts'> | null {
  const { turn, maxTurns, busts, maxBusts } = json;
  if (!isCount(turn) || !isCount(maxTurns) || !isCount(busts) || !isCount(maxBusts)) return null;
  return { turn, maxTurns, busts, maxBusts };
}

/** JSON from storage -> a fresh, typed state (the stream included), or null. */
export function parseState(json: unknown): PigState | null {
  if (!isRecord(json)) return null;
  const score = parseScore(json);
  const turns = parseTurns(json);
  const rng = parseRng(json['rng']);
  return score === null || turns === null || rng === null ? null : { ...score, ...turns, rng };
}

export function parseMove(json: unknown): PigMove | null {
  if (!isRecord(json)) return null;
  if (json['kind'] === 'roll') return { kind: 'roll' };
  return json['kind'] === 'hold' ? { kind: 'hold' } : null;
}

export const PIG_PERSISTENCE: PersistenceSpec<PigState, PigMove> = {
  stateVersion: PIG_STATE_VERSION,
  parseState,
  parseMove,
  migrateState: () => null,
  savePolicy: { kind: 'after-every-move' },
};
