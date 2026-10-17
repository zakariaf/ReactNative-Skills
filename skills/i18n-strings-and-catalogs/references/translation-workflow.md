# Translation workflow, approved copy and the review queue

How new text is written in every language, how approved copy from design or marketing reaches the
catalogs without retyping, and how drafted translations get a fluent reader without blocking work.

## Contents

- Writing a new message
- Glossary
- Tone per language
- Approved copy: contracts/copy-source.json and sync-copy.mjs
- The review queue (never blocking)
- Questions for the reviewer
- Store listings and other texts outside the app

## Writing a new message

1. **Look for an existing key first** (the source catalog, `common.*`, or
   `node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs keys . --prefix <area>.` when the app has a copy
   source). Reuse `common.*` texts that mean the same thing.
2. **Name the key** by place and role (`<area>.<element>[.<variant>]`), 2-5 kebab segments.
3. **Write the source language first** as one whole sentence with named placeholders: numbers typed,
   counted nouns as plurals, free text ending in `Name`/`Text`.
4. **Write every other language** with the same placeholders. Give each plural that language's CLDR
   categories (print them with the command in the catalogs reference), and copy any `=N` branch into
   every language.
5. **Add the key to every catalog**, keep them sorted, and use it in code as a literal (`t('area.element')`,
   `<T id="area.element" />`) or through a typed table.
6. **Run** `check-catalogs.mjs` and `check-i18n-code.mjs` until both print `RESULT: PASS`, then the
   Jest tests (a `t()` assertion per language whose grammar differs).
7. **Queue the drafts for review**: every drafted text goes on the review sheet and into the report
   as review pending; nothing waits for it.

## Glossary

Keep one glossary for the app (a table in this style in the app's docs or in the copy source), and
reuse its terms; add a term before using it in a second message. The demo Tasks app's:

| Term | en | de | fa | ar |
|---|---|---|---|---|
| task | task | Aufgabe | کار | مهمة |
| list | list | Liste | فهرست | قائمة |
| reminder | reminder | Erinnerung | یادآوری | تذكير |
| done | done | erledigt | انجام شد | تم |
| Premium | Premium | Premium | پریمیوم | بريميوم |

Brand and product names stay as the brand writes them; decide once whether the app's own name is
translated (`app.name` in the catalogs either way, so the platform name and the in-app name agree).

## Tone per language

Decide each language's register once, write it here, and follow it everywhere:

- **English:** short, friendly, sentence case; one spelling variety (en-US or en-GB) for the whole
  app. Apostrophes are typographic (’) because ASCII `'` is ICU's escape character.
- **German:** pick `du` or `Sie` once (consumer apps mostly use `du`); keep common anglicisms the
  audience uses.
- **Arabic:** Modern Standard Arabic for a pan-Arab audience; address the person consistently (the
  masculine singular imperative is the common default, or neutral forms where they read naturally).
  Arabic punctuation (، ؛ ؟); Arabic-Indic digits come from the locale tag, never from the text.
- **Persian:** polite plural imperative (`انتخاب کنید`), ZWNJ inside words (`می‌شود`, `کارها`),
  Persian punctuation, ی and ک.

Machine- or agent-drafted text in a language nobody on the team reads fluently is the highest risk:
prefer short, plain sentences, and copy CLDR data (months, weekdays) rather than translating it.

## Approved copy: contracts/copy-source.json and sync-copy.mjs

When design or marketing owns the wording (a design file renders it, or a copywriter signs it off),
keep that copy in one repo file, `contracts/copy-source.json` (shape in `examples/copy-source.json`,
schema in `assets/copy-source.schema.json`):

```json
{
  "screens": { "tasks": ["tasks.list.title", "tasks.summary.open"] },
  "strings": { "tasks.list.title": { "en": "Tasks", "ar": "المهام" } },
  "retired": { "tasks.count-label": "replaced by tasks.summary.open (a plural)" }
}
```

- Every row has every language in `LANGUAGES` (`sync-copy.mjs` refuses an incomplete row).
- **Never retype an approved text.** Copy it with `apply`; retyping loses typographic apostrophes
  (’), en dashes (–), ZWNJ and look-alike letters.
- **A wording change goes into the copy source first**, then into the catalogs with
  `apply --overwrite`. A catalog that differs from the copy source is `copy-drift`.
- Texts the copy source lacks (a new dialog) are written with the workflow above; ask whoever owns
  the copy to add them at the next pass.

```sh
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs keys . --screen tasks --lang all     # what a screen shows
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs keys . --prefix tasks.               # look up by prefix
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs apply . --screen tasks               # write a screen's texts
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs apply . --all                        # write every text
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs check . --screen tasks               # prove the catalogs match
```

- `apply` never silently replaces a different catalog text: it reports `copy-conflict` (exit 1) and
  keeps the catalog text unless `--overwrite`.
- `check` fails on `copy-drift` (naming the first differing code point, because U+2013 and U+002D
  look alike), `copy-key-missing` (a selected key is absent), `retired-key` (a retired key is still
  in a catalog) and `untranslated-prefix` (a copy row under an `untranslatedPrefixes` entry differs
  from its source text).
- Keys with a package `keyPrefix` go to that package's catalog folder.

## The review queue (never blocking)

Agents and machine translation draft every language; a fluent reviewer reads the drafts later.
Nothing waits for the review, and nothing is forgotten either.

1. `contracts/i18n.json` names the languages that need a reviewer: `"reviewLanguages": ["ar"]`.
2. `node scripts/i18n/review-sheet.ts` (template `templates/scripts/i18n/review-sheet.ts`) writes
   `reports/i18n/review-<lang>.csv` per review language: one row per text whose SHA-256 differs from
   the last reviewed hash, with the key, the source text, the current text and where it shows (the
   copy source's screen, the key's area, or "iOS permission dialog" for `*.usage-description`).
   Untranslated keys are left out. It prints `review-sheet: <lang>: <n> of <total> texts wait for
   review` per language and one `REVIEW PENDING (not blocking): …` line when anything waits. It
   always exits 0 (2 only for bad input); a release preflight may run it with `--release`, which
   behaves the same.
3. Every report copies that line, with the reviewer questions below for the new texts. Then the work
   carries on.
4. When corrections arrive, apply them to the copy source (if any) and the catalogs together, rerun
   the checks, then record the review:
   `node scripts/i18n/review-sheet.ts --mark-reviewed ar --date YYYY-MM-DD` (add `--key <key>` for
   only the texts the reviewer read).
5. `scripts/i18n/review-state.json` holds, per language and key, the SHA-256 of the text that was read
   and the date (`{ "ar": { "<key>": { "sha256": "…", "reviewedOn": "2026-10-02" } } }`). A later
   change of that text puts it back on the sheet. Commit it; `reports/` stays git-ignored.

## Questions for the reviewer

Give the reviewer context, not just strings. For each new or changed text, one row:

| Key(s) | Current text | Question |
|---|---|---|
| `tasks.summary.open` | `مهمتان مفتوحتان` (2) / `١١ مهمة مفتوحة` (11) | Natural for each count? Is the dual form right here? |
| `permissions.camera.usage-description` | `يتيح لك هذا إضافة صورة إلى مهمة. …` | Clear as the reason under the system's camera question? |
| all `ar` texts | masculine singular imperative | Is this register right for the audience, or should we use neutral forms? |

Ask about terminology (glossary terms), register, loanwords, and anything the screen shows in a
tight space (button labels, tab titles).

## Store listings and other texts outside the app

- Store listing texts (title, subtitle, description, screenshots) live with the release tooling, not
  in the app catalogs; localize them per store language with the same glossary (Expo's
  `eas-app-stores` skill covers store metadata; ios-release-testflight and android-release-play
  cover the upload).
- The app name per language and the permission purpose strings do live in the catalogs, because the
  app config builds the native strings from them (catalogs reference, "System dialog texts").
- Notification texts scheduled on the device come from `t()` at scheduling time (local-notifications);
  remote push texts are the server's job, keyed the same way.
