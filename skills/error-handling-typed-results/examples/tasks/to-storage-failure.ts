// src/data/to-storage-failure.ts (example: a shape to imitate, never copied)
// The one place that understands SQLite errors. expo-sqlite 57 throws an Error with code
// ERR_INTERNAL_SQLITE_ERROR whose message ends in "Error code <n>: <sqlite3_errmsg>", and the two
// platforms write <n> differently (read from expo-sqlite 57.0.3 source, not observed on a device):
//   iOS      SQLiteModule.swift:479 formats the decimal: "Error code 19: UNIQUE constraint failed: tasks.title"
//   Android  NativeDatabaseBinding.cpp:198 does `result += code;` on an int, which std::string takes as
//            one char, so the code arrives as a control character: "Error code \u0013: UNIQUE ..."
// Both forms are read; when neither is present, SQLite's own message text (sqlite3_errmsg, stable
// across versions) names the code. node:sqlite in Jest throws code ERR_SQLITE_ERROR with a numeric
// errcode (an extended code: 1555 for a primary-key clash). All reduce to the primary result code
// (code & 0xff). A constraint failure also carries the columns SQLite names ("UNIQUE constraint
// failed: tasks.title"; a primary-key clash reads "UNIQUE constraint failed: tasks.id"), so a
// repository can tell the user's duplicate title from a reused id, which is a bug. The mapper is
// total: it never throws, whatever it is given.

/** What a storage call can fail with, before a repository names it for its own domain. */
export type StorageFailure =
  | {
      readonly kind: 'constraint';
      readonly detail: 'unique' | 'not-null' | 'foreign-key' | 'other';
      /** The constrained columns as SQLite names them ('tasks.title'); empty when it names none. */
      readonly columns: readonly string[];
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

/** sqlite3_errmsg texts of the primary codes this mapper names, for a message that carries no code. */
const MESSAGE_CODES: readonly (readonly [text: string, code: number])[] = [
  ['constraint failed', SQLITE_CONSTRAINT],
  ['database or disk is full', SQLITE_FULL],
  ['database is locked', SQLITE_BUSY],
  ['database table is locked', SQLITE_LOCKED],
  ['database disk image is malformed', SQLITE_CORRUPT],
  ['file is not a database', SQLITE_NOTADB],
];

/**
 * A property of a thrown value, read without `instanceof Error`: errors from another realm (node:sqlite
 * inside Jest's sandbox, a native module) fail that test although they are real errors.
 */
function fieldOf(thrown: unknown, name: 'errcode' | 'message'): unknown {
  return typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, name) : undefined;
}

/** The SQLite result code carried by a thrown value, or null when it carries none. */
export function sqliteCodeOf(thrown: unknown): number | null {
  const errcode = fieldOf(thrown, 'errcode');
  if (typeof errcode === 'number') return errcode;
  const message = fieldOf(thrown, 'message');
  if (typeof message !== 'string') return null;
  const match = EXPO_SQLITE_CODE.exec(message);
  if (match?.[1] !== undefined) return Number(match[1]);
  if (match?.[2] !== undefined) return match[2].charCodeAt(0);
  return MESSAGE_CODES.find(([text]) => message.includes(text))?.[1] ?? null;
}

/**
 * "UNIQUE constraint failed: tasks.list_id, tasks.pos" -> ['tasks.list_id', 'tasks.pos']. A foreign
 * key names nothing and a CHECK names its expression, so both give [].
 */
function constrainedColumns(message: string): readonly string[] {
  const named = /constraint failed: (.+)$/.exec(message)?.[1];
  if (named === undefined) return [];
  const columns = named.split(', ');
  return columns.every((column) => /^\w+\.\w+$/.test(column)) ? columns : [];
}

function constraintDetail(thrown: unknown): StorageFailure {
  const field = fieldOf(thrown, 'message');
  const message = typeof field === 'string' ? field : '';
  const columns = constrainedColumns(message);
  if (message.includes('UNIQUE') || message.includes('PRIMARY KEY')) {
    return { kind: 'constraint', detail: 'unique', columns };
  }
  if (message.includes('NOT NULL')) return { kind: 'constraint', detail: 'not-null', columns };
  if (message.includes('FOREIGN KEY')) {
    return { kind: 'constraint', detail: 'foreign-key', columns };
  }
  return { kind: 'constraint', detail: 'other', columns };
}

/** Maps anything a storage call threw to a StorageFailure. Total: never throws. */
export function toStorageFailure(thrown: unknown): StorageFailure {
  const code = sqliteCodeOf(thrown);
  if (code === null) return { kind: 'unknown', code: null };
  switch (code & PRIMARY_MASK) {
    case SQLITE_CONSTRAINT:
      return constraintDetail(thrown);
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
