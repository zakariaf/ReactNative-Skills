// lib/repo-rules.mjs: the repo-wide rules of check-backup.mjs (they run whether or not the app has a backup
// folder): file SDKs behind adapters, share and pick only from a press, the CSV encoder and its use,
// canonical values in machine formats, atomic writes, the safety copy, and the round-trip test.
import { calls, FILE_SDKS, FORMULA_LEADERS, functionAt } from './backup-rules.mjs';
import { functionsOf, matchBracket } from './source-scan.mjs';

const EFFECTS = '\\b(?:useEffect|useLayoutEffect|useInsertionEffect|useFocusEffect|setTimeout|setInterval|AppState\\.addEventListener)';
const OUTWARD = /\.(shareFile|pickFile|pickBackup|exportBackup|exportCsv)\s*\(|\b(shareAsync|getDocumentAsync|Share\.share)\s*\(/g;
const LOCALIZED = /\.toLocale(?:String|DateString|TimeString)\s*\(|\bIntl\.[A-Z]\w*|\bformat(?:Number|Date|Time|Relative\w*|Message)\s*\(|\buseIntl\s*\(/g;

/** sdk-behind-port: expo-sharing, expo-document-picker and expo-file-system only in adapter files. */
export function checkSdkImports(ctx, src) {
  const adapter = new RegExp(`^(${ctx.layout.servicesDir}/[^/]+|${ctx.layout.dataDir}(?:/.+)?)/[^/]*-adapter(?:\\.(?:ios|android|native|web))?\\.tsx?$`);
  if (adapter.test(src.rel)) return;
  for (const entry of src.imports) {
    const sdk = FILE_SDKS.find((name) => entry.spec === name || entry.spec.startsWith(`${name}/`));
    if (sdk === undefined || entry.typeOnly) continue;
    ctx.add({ file: src.rel, line: entry.line, rule: 'sdk-behind-port', message: `imports ${entry.spec} outside an adapter`, fix: `Only ${ctx.layout.servicesDir}/<concern>/<library>-<concern>-adapter.ts imports ${sdk} (ShareSheetPort, FilePickerPort, ExportFilesPort); code takes the port from the composition root, and tests pass the fake.` });
  }
}

/** user-action-only: nothing is exported, shared or picked from an effect, a timer or an app-state listener. */
export function checkUserActionOnly(ctx, src) {
  const ranges = calls(src, EFFECTS).filter((call) => call.close !== -1);
  for (const match of src.code.matchAll(OUTWARD)) {
    const inside = ranges.find((range) => range.open < match.index && match.index < range.close);
    if (inside === undefined) continue;
    const what = (match[1] ?? match[2]).replace(/\s+/g, '');
    const where = inside.match[0].replace(/\s*\($/, '');
    ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'user-action-only', message: `${what}() runs inside ${where}, not from a user's press`, fix: 'Call it from the press handler of the Export, Share or Restore control only: data leaves the device (or is replaced) when the user asks, never on mount, focus, a timer or a background change.' });
  }
}

/** The CSV encoder module: the file that defines encodeCsvField (or exports toCsv). */
export function isCsvModule(src) {
  return /\bfunction\s+encodeCsvField\b|\bconst\s+encodeCsvField\b/.test(src.code);
}

/** csv-guard: the encoder neutralizes every formula leader and doubles quotes. */
export function checkCsvModule(ctx, src) {
  const raws = new Set(src.strings.map((entry) => src.raw.slice(entry.index + 1, entry.end - 1)));
  const missing = FORMULA_LEADERS.filter((leader) => !raws.has(leader));
  if (missing.length > 0) {
    ctx.add({ file: src.rel, line: src.lineOf(src.code.search(/\bencodeCsvField\b/)), rule: 'csv-guard', message: `the CSV encoder does not neutralize the formula leaders ${missing.join(' ')}`, fix: "CSV_FORMULA_LEADERS = ['=', '+', '-', '@', '\\t', '\\r']: a text cell starting with one gets a leading apostrophe before quoting, or the recipient's spreadsheet runs it (OWASP CSV Injection)." });
  }
  if (!raws.has('""')) {
    ctx.add({ file: src.rel, line: src.lineOf(src.code.search(/\bencodeCsvField\b/)), rule: 'csv-guard', message: 'the CSV encoder does not double embedded quotes (RFC 4180)', fix: "Quote a field holding a comma, a quote, CR or LF, and write each embedded quote as two: text.replaceAll('\"', '\"\"')." });
  }
}

/** A 'text/csv' literal that is a picker filter or an accepted type (`type: 'text/csv'`, `type: ['text/csv']`) reads CSV. */
function isCsvTypeFilter(src, entry) {
  return /\btype\s*:\s*(?:\[[^\]]*)?$/.test(src.code.slice(Math.max(0, entry.index - 80), entry.index));
}

/** The file writes CSV: a `.csv` file name, or a 'text/csv' type that is not a picker filter. */
function writesCsv(src) {
  return src.strings.some((entry) => (entry.value === 'text/csv' && !isCsvTypeFilter(src, entry)) || /\.csv$/.test(entry.parts.at(-1) ?? entry.value));
}

/** Where the file builds CSV rows itself: a `.join(',')` (or ; or tab), or a template literal that puts `,` between substitutions. */
function handBuiltRow(src) {
  const join = /\.join\s*\(\s*(['"`])\s*(?:[,;]|\\t)\s*\1\s*\)/.exec(src.raw);
  if (join !== null) return join.index;
  const row = src.strings.find((entry) => entry.quote === '`' && entry.parts.length >= 3 && entry.parts.slice(1, -1).some((part) => /[,;]|\\t/.test(part)));
  return row === undefined ? null : row.index;
}

/**
 * The files that reach the guarded encoder: the CSV module, the files that import it, and the files that
 * import one of those (tasks-csv.ts imports csv.ts; backup-service.ts imports tasks-csv.ts).
 */
export function csvEncoderUsers(sources, csvModuleRel, resolve) {
  const users = new Set(csvModuleRel === null ? [] : [csvModuleRel]);
  for (let depth = 0; depth < 2; depth += 1) {
    for (const src of sources) {
      if (src.imports.some((entry) => !entry.typeOnly && users.has(resolve(src.rel, entry.spec)))) users.add(src.rel);
    }
  }
  return users;
}

/** csv-hand-rolled: a file that writes CSV builds rows itself, without reaching the encoder (or the app has none). */
export function checkCsvUse(ctx, src, { csvModuleRel, users }) {
  if (!writesCsv(src)) return;
  const at = handBuiltRow(src);
  if (csvModuleRel !== null && (at === null || users.has(src.rel))) return;
  ctx.add({ file: src.rel, line: at === null ? 1 : src.lineOf(at), rule: 'csv-hand-rolled', message: csvModuleRel === null ? 'writes CSV, but the app has no guarded CSV encoder (encodeCsvField)' : 'builds CSV rows by hand instead of using the guarded encoder', fix: 'Build every CSV through toCsv/encodeCsvField (templates/src/core/portable/csv.ts): a hand-joined cell breaks on a comma or newline and runs as a formula in the recipient\'s spreadsheet.' });
}

/** canonical-values: machine formats never hold localized numbers, dates or messages. */
export function checkCanonicalValues(ctx, src) {
  for (const match of src.code.matchAll(LOCALIZED)) {
    ctx.add({ file: src.rel, line: src.lineOf(match.index), rule: 'canonical-values', message: `a backup or CSV value is localized (${match[0].replace(/\s*\($/, '')})`, fix: 'Write canonical values: integers, true/false, ISO-8601 UTC instants (new Date(ms).toISOString()), stable codes. "12,5", "١٢٫٥" and "12.5" are one number and three parses; localize only on screen.' });
  }
  for (const entry of src.imports.filter((item) => !item.typeOnly && (item.spec === 'react-intl' || item.spec.startsWith('@/i18n/')))) {
    ctx.add({ file: src.rel, line: entry.line, rule: 'canonical-values', message: `backup or CSV code imports ${entry.spec}`, fix: 'Keep translation out of machine formats (column codes and enum codes stay untranslated); a translated report is a separate, never-restorable export.' });
  }
}

/** The top-level, comma-separated arguments of a call's inner text (strings already blanked in `code`). */
export function topLevelArguments(inner) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args.map((arg) => arg.trim()).filter((arg) => arg !== '');
}

/** Bodies of the failure paths of a file: catch blocks and `if (!x.ok)` / `if (!x.success)` branches. */
function failureBodies(src) {
  const bodies = [];
  for (const match of src.code.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{|\bif\s*\(\s*!\s*[\w$.]+\.(?:ok|success)\s*\)\s*/g)) {
    const start = match.index + match[0].length;
    const open = match[0].endsWith('{') ? start - 1 : src.code[start] === '{' ? start : -1;
    const end = open === -1 ? src.code.indexOf(';', start) : matchBracket(src.code, open);
    if (end !== -1) bodies.push(src.code.slice(start, end));
  }
  return bodies;
}

// The object API (File.write, moveSync, delete) and the legacy one (expo-file-system/legacy:
// writeAsStringAsync, moveAsync, deleteAsync), which agents writing from memory still reach for.
const FS_WRITE = /\.write\s*\(|\bwriteAsStringAsync\s*\(/;
const FS_MOVE = /\.(moveSync|move|rename)\s*\(|\bmoveAsync\s*\(/;
const FS_DELETE = /\.delete\s*\(|\bdeleteAsync\s*\(/;

/** atomic-write: an adapter that writes export files writes a temp file, moves it, and discards it on failure. */
export function checkAtomicWrite(ctx, src) {
  if (!src.imports.some((entry) => (entry.spec === 'expo-file-system' || entry.spec === 'expo-file-system/legacy') && !entry.typeOnly)) return false;
  const write = FS_WRITE.exec(src.code);
  if (write === null) return false;
  const moves = FS_MOVE.test(src.code.slice(write.index));
  // Same-file helpers that delete (discardPartial): calling one on a failure path counts.
  const deleters = functionsOf(src.scan).filter((fn) => fn.bodyStart !== -1 && FS_DELETE.test(src.code.slice(fn.bodyStart, fn.bodyEnd))).map((fn) => fn.name);
  const discards = failureBodies(src).some((body) => FS_DELETE.test(body) || deleters.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(body)));
  if (!moves || !discards) {
    ctx.add({ file: src.rel, line: src.lineOf(write.index), rule: 'atomic-write', message: !moves ? 'writes the export straight to its published name (no temp file moved into place)' : 'a failed write leaves its temp file behind (nothing deletes it on the failure path)', fix: 'Write to a temp file in the same folder, moveSync it over the published name, and discard the temp file when a step fails (if (!moved.ok) discardPartial(temp)): a half-written file must never carry a name the share sheet or a restore would trust.' });
  }
  return true;
}

/** safety-copy-first: the function that replaces the tables writes the private safety copy first, and stops when it fails. */
export function checkSafetyCopy(ctx, src) {
  for (const call of calls(src, '\\.replaceAll').filter((each) => each.close !== -1)) {
    // String.prototype.replaceAll takes two arguments (or a string or regex first): not a restore.
    const args = topLevelArguments(src.code.slice(call.open + 1, call.close));
    if (args.length !== 1 || /^['"`/]/.test(src.raw.slice(call.open + 1, call.close).trim())) continue;
    const fn = functionAt(src, call.index);
    const body = src.raw.slice(fn?.bodyStart ?? 0, call.index);
    const copy = /\.write\s*\(\s*\{[^}]*\bfolder\s*:\s*['"]private['"]|\b\w*[sS]afety\w*\s*\(/.exec(body);
    const stops = copy !== null && /\breturn\b/.test(body.slice(copy.index));
    if (!stops) {
      ctx.add({ file: src.rel, line: src.lineOf(call.index), rule: 'safety-copy-first', message: copy === null ? 'the restore replaces the tables without writing a safety copy of the current data first' : 'the restore goes on when the safety copy fails', fix: "Encode the current rows and write them to the private folder first (files.write({ folder: 'private', name: SAFETY_COPY_NAME, text })); if that fails, return { kind: 'safety-copy-failed' } and replace nothing." });
    }
  }
}

/** The round-trip test: a test that restores (replaceAll) what it read or encoded, through the SQLite backup repository. */
export function isRoundTripTest(src) {
  return /\breplaceAll\s*\(/.test(src.code) && /\b(readBackup|encodeBackup)\s*\(/.test(src.code) && src.imports.some((entry) => /sqlite-[a-z0-9-]*backup[a-z0-9-]*-repository$/.test(entry.spec));
}
