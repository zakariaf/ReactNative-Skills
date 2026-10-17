# CSV and the other export formats: two escapes, canonical values, one encoder

How a CSV export stays correct in every spreadsheet and safe for the person who opens it, why machine
formats hold canonical values only, and where a human report belongs.

## Contents

1. Choosing a format
2. CSV: two independent escapes
3. Encoding: UTF-8, the BOM, line endings
4. Canonical values in machine formats
5. One encoder for the whole app
6. Human reports
7. Pitfalls with fixes

## 1. Choosing a format

| Need | Format | Restorable |
|---|---|---|
| everything, back into this app later | the backup envelope (envelope-and-ladder.md) | yes, the only one |
| rows for a spreadsheet or another tool | CSV through `toCsv` (src/core/portable/csv.ts), e.g. `tasks-csv.ts` | no |
| something a person reads, prints or files | a report (PDF, share text) built from the same rows, fully localized | no |

## 2. CSV: two independent escapes

`encodeCsvField` applies both, in this order:

1. **Formula neutralization (safety).** A spreadsheet runs a cell that starts with `=`, `+`, `-`, `@`,
   tab or carriage return as a formula: `=HYPERLINK("http://…","click")`, `=cmd|' /C calc'!A0`, `@SUM(…)`
   (OWASP: CSV Injection). A text cell that starts with one of `CSV_FORMULA_LEADERS` gets a leading
   apostrophe (`'=1+2`), which spreadsheets show as text. Numbers and booleans come from code, not users,
   and are written canonically without the apostrophe: `-5` stays a number.
2. **RFC 4180 quoting (correctness).** A field that holds a comma, a double quote, CR or LF is quoted,
   and each embedded quote is doubled (`a,b"c` → `"a,b""c"`). Everything else is written verbatim,
   including leading and trailing spaces (a trimming writer silently edits user data) and newlines inside
   a quoted field.

Neutralize first, then quote, so the apostrophe sits inside the quotes. Either escape alone fails:
quoting alone leaves an executable cell, neutralizing alone breaks the row on a comma. `null` is an empty
field and `''` is `""`, so a reader can tell "no value" from "empty text". `toCsv` throws a RangeError
on a row whose length differs from the header's: a shifted column is silent data loss.

The apostrophe changes what a re-imported cell contains (`'=1+2`); that is acceptable because a CSV is
never restored. A tool that must read the exact text back needs the backup, not the CSV.

## 3. Encoding: UTF-8, the BOM, line endings

- **UTF-8 always.** Never UTF-16 or a platform default.
- **A BOM by default** (`toCsv(header, rows, { bom: true })` is the default): the audience of a CSV export
  is a spreadsheet app, and Excel on Windows is widely reported to read a BOM-less UTF-8 CSV in a legacy
  code page, turning Arabic, accents and emoji into mojibake; Numbers, Google Sheets and LibreOffice read
  the BOM fine. A strict parser that treats the BOM as data in the first header cell is the trade-off;
  pass `{ bom: false }` for an export aimed at such a tool. (Behaviour from vendor reports, not tested
  here: open the file in the tools your users use, step 2 of the drill in platform-behaviour.md.)
- **CRLF between records, CRLF at the end** (RFC 4180). `test/portable/parse-csv.ts` is a strict reader
  that refuses a bare LF, so a writer that drifts to `\n` fails its test.
- **Bidi text is kept byte for byte.** A title with U+200F marks round-trips exactly; never strip or add
  presentation marks in a file (rtl-and-direction owns how text is shown, on screen).
- **Comma, not semicolon.** Spreadsheets in some locales (German, French) expect `;` when a file is
  double-clicked; the RFC and every import dialog accept `,`. Keep `,` and, if users complain, offer the
  import-dialog route in the help text rather than a locale-dependent delimiter (a file whose format
  depends on the writer's locale is not canonical).

## 4. Canonical values in machine formats

A file that a program will parse (the backup, a CSV) holds canonical values only:

| Value | Canonical | Never |
|---|---|---|
| a number | digits with `.` (`12.5`) | `12,5`, `١٢٫٥`, `1 234` |
| money | decimal text (`19.99`) or integer minor units, always with its currency code in its own column (value-objects-money-and-units) | a JSON float, `$19.99`, `19,99 €` |
| an instant | ISO-8601 UTC with `Z` (`2026-09-21T14:15:20.000Z`), or epoch milliseconds in the backup | `21/09/2026 16:15`, a local time without zone |
| a calendar day | `YYYY-MM-DD` date key (dates-streaks-and-statistics) | a formatted date |
| a flag | `true`/`false` in CSV, `0`/`1` as stored in the backup | `Yes`, `Ja`, `نعم` |
| an enum | its code (`done`, `in-progress`) | its translated label |
| a column name | a code (`created_at`) | a translated header |

A formatted column may be added for people (`total_display`), but it never replaces the canonical one,
and an import reads only the canonical columns.

`١٢٫٥`, `12,5` and `12.5` are one quantity and three parses: a file written on one phone must read the
same on every other. Localization happens on screen only (i18n-strings-and-catalogs: formatters at the
edge). check-backup's `canonical-values` rule reports `toLocaleString`, `toLocaleDateString`, `Intl.*`,
`format*()` calls, `useIntl` and imports from react-intl or `@/i18n/` in backup code and the CSV encoder.

## 5. One encoder for the whole app

Every CSV goes through `toCsv`/`encodeCsvField`. A second, hand-rolled writer (`rows.map((row) =>
row.join(','))`) breaks on the first comma or newline and reopens formula injection. check-backup:
`csv-guard` (the encoder neutralizes all six leaders and doubles quotes) and `csv-hand-rolled` (a file
that writes `text/csv` or a `.csv` name joins cells itself, or the app has no guarded encoder).

## 6. Human reports

A report is a presentation: localized numbers, dates, the app's calendar, translated labels and
headings. It is allowed to be lossy because nothing parses it back. Build it from the same rows as the
backup (the repository's `readAll`), not from the CSV, so the two cannot drift. Share a report through
the same `ShareSheetPort` (a PDF from a print library, or plain text). The confirmation of any export
says plainly that the file is not encrypted.

## 7. Pitfalls with fixes

| Pitfall | Fix |
|---|---|
| A title `=SUM(A1:A9)` runs in the recipient's spreadsheet | neutralize every text cell through `encodeCsvField` |
| A note with a newline splits into two rows | quote fields holding CR or LF (the encoder does) |
| `"` inside a title ends the field early | double embedded quotes (the encoder does) |
| Arabic shows as `Ø´Ø±Ø§Ø¡` in Excel | keep the BOM default for spreadsheet exports |
| Dates written as `9/21/26` on one phone and `21.09.26` on another | ISO-8601 UTC instants or date keys only |
| A CSV picked for restore "half works" | restore accepts the envelope only; a CSV fails rung 1 as `not-a-backup` |
| Trimmed values ("  padded  " becomes "padded") | never trim in a writer; the parser test keeps spaces |
| Negative numbers shown as `'-5` | pass numbers as numbers (`CsvCell` number), not as text |
