// sql-columns.mjs: finds column definitions in SQL held by string literals (a helper, not an entry
// point). Migrations keep literal SQL (CREATE TABLE ..., ALTER TABLE ... ADD COLUMN ...); this reads
// each column's name and declared type with its offset in the string, so a checker can judge money
// and instant columns. A heuristic, not a SQL parser: table constraints (PRIMARY KEY (...), CHECK,
// FOREIGN KEY) are skipped because they start with a keyword, not a column name and a type.

const TYPES = 'INTEGER|INT|BIGINT|REAL|FLOAT|DOUBLE PRECISION|DOUBLE|NUMERIC|DECIMAL|TEXT|VARCHAR|BLOB|ANY|DATETIME|TIMESTAMP|DATE|BOOLEAN';
const KEYWORDS = new Set(['primary', 'foreign', 'unique', 'check', 'constraint', 'create', 'table', 'index', 'on', 'if', 'not', 'exists']);
const COLUMN = new RegExp(`(?:\\(|,|ADD\\s+COLUMN)\\s*["\`]?([A-Za-z_][A-Za-z0-9_]*)["\`]?\\s+(${TYPES})\\b`, 'gi');

/** True when a string holds DDL worth reading. */
export function holdsDdl(text) {
  return /\b(CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(text);
}

/** [{ name, type, offset }] for each column definition in `sql` (type upper-cased, offset of the name). */
export function columnsOf(sql) {
  const columns = [];
  for (const match of sql.matchAll(COLUMN)) {
    const name = match[1];
    if (KEYWORDS.has(name.toLowerCase())) continue;
    columns.push({ name, type: match[2].toUpperCase().replace(/\s+/g, ' '), offset: match.index + match[0].indexOf(name) });
  }
  return columns;
}

/** True for the SQLite types that hold a whole number. */
export function isIntegerType(type) {
  return type === 'INTEGER' || type === 'INT' || type === 'BIGINT';
}
