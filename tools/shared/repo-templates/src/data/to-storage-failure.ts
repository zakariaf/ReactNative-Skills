// src/data/to-storage-failure.ts: the one place that reads SQLite errors; repositories turn them into their own failures.
// expo-sqlite 57 throws an Error whose message ends in "Error code <n>: <sqlite3_errmsg>". iOS writes
// <n> as a decimal; Android appends the int to a std::string, so it arrives as one character
// (read in expo-sqlite 57.0.3's native sources, not observed on a device). node:sqlite (Jest) throws
// with a numeric `errcode`, an extended code (787 for a foreign key). All reduce to the primary code.

/** What a storage call can fail with, before a repository names it for its own domain. */
export type StorageFailure =
  | {
      readonly kind: 'constraint';
      readonly detail: 'unique' | 'not-null' | 'foreign-key' | 'check' | 'other';
    }
  | { readonly kind: 'full' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'unknown'; readonly code: number | null };

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CONSTRAINT = 19;
const SQLITE_NOTADB = 26;
const PRIMARY_MASK = 0xff;

/** "Error code 19:" (iOS, a decimal) or "Error code \u0013:" (Android, the code as one character). */
const EXPO_SQLITE_CODE = /Error code (?:(\d+)|([\s\S])):/;

/** sqlite3_errmsg texts (stable across SQLite versions) for a message that carries no code. */
const MESSAGE_CODES: readonly (readonly [text: string, code: number])[] = [
  ['constraint failed', SQLITE_CONSTRAINT],
  ['database or disk is full', SQLITE_FULL],
  ['database is locked', SQLITE_BUSY],
  ['database table is locked', SQLITE_LOCKED],
  ['database disk image is malformed', SQLITE_CORRUPT],
  ['file is not a database', SQLITE_NOTADB],
];

/** Reads a field without `instanceof Error`: node:sqlite errors come from another realm inside Jest. */
function fieldOf(thrown: unknown, name: 'errcode' | 'message'): unknown {
  return typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, name) : undefined;
}

function messageOf(thrown: unknown): string {
  const message = fieldOf(thrown, 'message');
  return typeof message === 'string' ? message : '';
}

/** The SQLite result code a thrown value carries, or null when it carries none. */
export function sqliteCodeOf(thrown: unknown): number | null {
  const errcode = fieldOf(thrown, 'errcode');
  if (typeof errcode === 'number') return errcode;
  const message = messageOf(thrown);
  const match = EXPO_SQLITE_CODE.exec(message);
  if (match?.[1] !== undefined) return Number(match[1]);
  if (match?.[2] !== undefined) return match[2].charCodeAt(0);
  return MESSAGE_CODES.find(([text]) => message.includes(text))?.[1] ?? null;
}

function constraintOf(thrown: unknown): StorageFailure {
  const message = messageOf(thrown);
  if (message.includes('UNIQUE') || message.includes('PRIMARY KEY')) {
    return { kind: 'constraint', detail: 'unique' };
  }
  if (message.includes('NOT NULL')) return { kind: 'constraint', detail: 'not-null' };
  if (message.includes('FOREIGN KEY')) return { kind: 'constraint', detail: 'foreign-key' };
  if (message.includes('CHECK')) return { kind: 'constraint', detail: 'check' };
  return { kind: 'constraint', detail: 'other' };
}

/** Maps anything a storage call threw to a StorageFailure. Total: it never throws. */
export function toStorageFailure(thrown: unknown): StorageFailure {
  const code = sqliteCodeOf(thrown);
  if (code === null) return { kind: 'unknown', code: null };
  switch (code & PRIMARY_MASK) {
    case SQLITE_CONSTRAINT:
      return constraintOf(thrown);
    case SQLITE_FULL:
      return { kind: 'full' };
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return { kind: 'busy' };
    case SQLITE_CORRUPT:
    case SQLITE_NOTADB:
      return { kind: 'corrupt' };
    default:
      return { kind: 'unknown', code };
  }
}
