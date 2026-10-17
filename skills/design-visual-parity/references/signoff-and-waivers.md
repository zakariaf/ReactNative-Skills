# The look pass, the sign-off ledger and waivers

The gates prove geometry, strings, colours, type and shape. What they cannot see (icons, pictures,
shadow feel, optical alignment, wrapping, mirroring, the design's character) is checked by looking at
the sheets and recorded in a ledger that `check-signoff.mjs` verifies. This page is the procedure, the
two file formats and what the report says.

## Contents

- Reading the sheets
- The done set
- The sign-off ledger
- Waivers
- Known platform causes
- Intended reference changes are not waivers
- Committing waivers and references
- The summary and the report

## Reading the sheets

`make-sheet.mjs` (run by `run-parity.mjs`) writes into each run folder:

| File | What it shows | How to read it |
|---|---|---|
| `sheet.png` | design, app and pixel difference side by side at 1 px per pt; failing elements outlined in magenta; masks hatched grey. A tall frame's capture shows the design window that capture should show (fixed header, scrolled body, pinned parts), then the full-height design with that window between cyan lines | Read first. Compare the two screens as wholes: same blocks, same order, same weight. In the difference panel, red = the app is different or lighter, blue = darker; specks on text edges are anti-aliasing |
| `zoom-1.png` ... | design and app in bands of 220 pt at 2x | Read every band: icons, shadows, radii, line breaks and alignment show here |
| `crops/<testID>.png` | design, app and difference of each failing element at the capture scale with 4 pt of context | Read before changing code for a failing element: it shows what is actually different |
| `eye-1.png` ... | every icon, logo and picture (`checks` include `crop`) as design and app pairs | Read every page; the testIDs are listed top to bottom in `sheets.json` (`eyePages`) and in the output |

Answer the seven eye checks (what-exact-means.md): `icons`, `pictures`, `shadows`, `alignment`,
`wrapping`, `direction`, `feel`. Anything visibly different is a difference to fix, even when every gate
passed: the gates have tolerances, the reviewer's eye does not.

## The done set

A frame is signed off on every device of the contract, in every theme and every language (an RTL one
included when the app has one), at every scroll offset `run-parity.mjs` plans for a tall frame, against
the reference the app's facts pick. That is `check-signoff.mjs`'s default. `--devices`, `--themes` and
`--langs` narrow a check while fixing one variant, but a narrowed check is never a sign-off: it prints
`narrowed: not a sign-off` and exits 1. A ledger with only light English and dark RTL entries is not
done; dark mode and right to left are where screens break, and one passing variant proves little.

## The sign-off ledger

`design/parity/signoff.json` (the contract's `signoff`), committed: one entry per run (frame x device x
theme x language x scroll offset). `check-signoff.mjs . --draft <run-dir>` prints the skeleton after
`make-sheet.mjs` ran:

```json
{
 "frame": "tasks-default",
 "device": "iphone-16-pro",
 "theme": "dark",
 "lang": "ar",
 "scrollY": 0,
 "sheetSha256": "<the sha256 of this run's sheet.png, filled in by --draft>",
 "date": "2026-10-14",
 "looked": ["sheet.png", "zoom-1.png", "zoom-2.png", "zoom-3.png", "zoom-4.png", "eye-1.png"],
 "eyeChecks": { "icons": "match", "pictures": "n/a", "shadows": "match", "alignment": "match", "wrapping": "match", "direction": "match", "feel": "match" },
 "differences": [{ "what": "add icon drawn 2 pt too small", "status": "fixed" }]
}
```

- `date` is the local calendar day of the look: `--draft` fills it from the machine's local time (at
  01:17 in Berlin on 1 October it writes 2026-10-01, never the UTC day 2026-09-30); `--date YYYY-MM-DD`
  sets it when the look was on another day.
- `looked` lists every image of the run except the crops (`not-looked` when one is missing). List only
  what was actually read.
- Each eye check is `match`, `n/a` (`direction` on a screen with nothing directional) or
  `waived: <a reason of 20+ characters>` for a platform limit the reviewer was told about; anything else
  fails `eye-check-open`.
- `differences`: `fixed` once fixed and checked again, `waived` with a waiver, `open` blocks the
  sign-off (`difference-open`).
- `sheetSha256` ties the entry to one sheet: a new capture or a new reference makes a new sheet, and the
  old entry no longer counts (`looked-at-old-sheet`). Look again, then update the entry.
- **After a rebuild**, `--draft <run-dir> --from-ledger` copies the previous entry's differences for the
  same run (every eye check opens again: the new sheet must be looked at). It refuses sheets older than
  the latest check (`stale-sheet`) and a broken ledger (`ledger-invalid`).
- `check-signoff.mjs` also refuses runs that are not real captures (`not-a-capture`: not written by
  capture-app.mjs, or the reference copied in as `app.png`), stale reports (`stale-report`), stale or
  edited sheets (`stale-sheet`), failing runs (`not-passing`), missing runs (`not-captured`), runs against
  another reference (`reference-variant`), reports that relied on a waiver since removed (`waiver-gone`)
  and tall frames with elements never fully on screen (`coverage`).

## Waivers

A waiver accepts **one named problem of one element on one frame** that the app cannot fix. It is rare,
written down and reported. `design/parity/waivers.json` (the contract's `waivers`):

| Class | When | Extra field | Rules it may cover |
|---|---|---|---|
| `platform` (default) | iOS, Android or React Native cannot draw it like the design, and no style or layout changes that | - | `missing`, `bounds`, `text`, `fill`, `border`, `text-ink`, `structure` |
| `platform-text-shaping` | the platform's text engine shapes certain glyphs or marks differently from Chrome's HarfBuzz with the same font file (the ink is narrower or wider, not moved) | `glyphs`: the characters or marks | `text-ink` only |
| `design-artefact` | the mockup's own CSS draws something the product does not mean, and the screen contract or the component is right | `designCause`: the CSS rule and what it does | every waivable rule except `missing` |

```json
{
 "version": 1,
 "waivers": [
  {
   "frame": "lists-default",
   "testID": "lists.list-row.gifts",
   "rule": "structure",
   "devices": ["android-parity"],
   "reason": "React Native on Android draws borderStyle 'dashed' with its own dash length and phase; the edge differs along the dashes only.",
   "reportedOn": "2026-10-14"
  },
  {
   "frame": "tasks-default",
   "testID": "tasks.summary",
   "rule": "bounds",
   "class": "design-artefact",
   "designCause": ".summary{display:flex;gap:6px} splits the count and the word into two flex items 6 px apart",
   "reason": "The mockup's flex gap draws a 6 px space where the catalog has one space; the app writes one string.",
   "reportedOn": "2026-10-14"
  }
 ]
}
```

- Fields: `frame`, `testID` (exact, no wildcards), `rule`, optional `class`, `glyphs`, `designCause`,
  `devices` (required for `platform` and `platform-text-shaping`: the device profiles whose runs showed
  the limit; only a `design-artefact` waiver, shared by every device because the mockup is, may omit
  it), optional `themes` / `langs`, `reason` (20+ characters naming the limit or the artefact),
  `reportedOn` (the date of the report that told the reviewer). Any other field (a tolerance, a
  threshold) makes the file invalid: a waiver never changes a number.
- **Never copy an iOS waiver to Android** (or the reverse) without its own evidence: the same element
  failing the same rule on the other platform may have a different, real cause. Measure it there, then
  add that device to `devices` (`waiver-invalid` when a platform waiver names none).
- `screen-not-reached`, `capture-size`, `duplicate-testid` and everything about the capture itself are
  never waived: they mean the comparison did not happen.
- Not a waiver: "close enough" (a fix), "later" (an open difference), "the design is wrong" without the
  CSS that proves it (a question for the reviewer: stop and ask).
- `check-parity.mjs` prints waived problems as `WAIVED` notes with their class, and an unused waiver as a
  note to delete it; `check-signoff.mjs` lists every waiver of the frames it signs off.
- A design artefact the reviewer fixes in the mockup stops being a waiver: the references are rendered
  again (an intended reference change) and the waiver is deleted.

## Known platform causes

Some differences show on every correct build for a known reason. They are never waived automatically:
check-parity.mjs names the cause in the fix text, the builder opens the crop, confirms the difference is
exactly that and nothing else, and then writes a `platform` waiver naming it:

| Rule | Element | Cause |
|---|---|---|
| `structure` | a `dashed` or `dotted` border | React Native draws its own dash length and corner phase on iOS and Android, and no style sets them; the edge differs along the dashes only. A dashed edge that is missing, too thick or in the wrong colour is still a fix |
| `text-ink` (iOS) | a text on a rotated view | iOS draws a rotated view's edge without antialiasing (React Native exposes no `allowsEdgeAntialiasing`), so Chrome's antialiased edge pixels next to the text count as ink and the app's stepped edge does not |

Two more seen in the source app and left to a waiver when measured: a multi-line text in a tall script
whose line boxes the platform snaps to the device pixel grid (a centred card 1.33 pt taller than
Chrome's), and an element frozen mid-press in the mockup (a `design-artefact`, with the question to the
reviewer whether to draw it at rest).

## Intended reference changes are not waivers

When the references themselves change on purpose (the reviewer approved a design change, or a renderer
change was understood), the change is logged in the manifest's `referenceChanges`
(mockup-and-references.md), not in the waiver file. A waiver accepts a difference between the app and a
reference; a change entry says why the reference is what it is. `check-signoff.mjs` prints the entries
of every frame it signs off, and each goes into the report.

## Committing waivers and references

The waiver file, the references, the manifest, the fixture, the mockup and the device profiles are
gated paths: they change what the parity gate accepts. A commit that changes one carries a `Gate-Change:` trailer
(git-commits-and-reporting) and names each waiver or reference change in its body, so
`git log --grep Gate-Change` finds them. Add their paths to quality-gates.json `gatedPaths` one by
one (the waivers, `design/parity/<device>/**` per device, the manifest, the fixture,
`design/parity/mockup/**`, `design/parity/devices/**`; check-harness.mjs `gated-paths`), never
`design/parity/**`, which would gate the ledger too. In the slice or release report,
every changed waiver or reference file goes under "Goldens and baselines changed on purpose" with its
Gate-Change commit. The ledger is not gated: it records looks, not tolerances.

## The summary and the report

Every `check-signoff.mjs` run writes the summary (the contract's `summary`, default
`reports/parity/summary.json`): the result, whether it was narrowed, the done set, each frame's cells
(`done`, `open`, `missing`), every waiver and every intended reference change. A report's "Design
match" line names that file (git-commits-and-reporting `report-source`):

```
- Design match: Tasks and Lists match their approved design references on iPhone and Android, light and dark, en and ar (1 waiver)   reports/parity/summary.json
```

For each screen: the reference used per frame (base or variant, with the facts that chose it), the runs
that pass, what was checked by eye, every waiver with its class and reason (each also listed under "Not
tested or not verified"), every intended reference change, and open questions (a design artefact always
comes with its question). Link the `sheet.png` of the dark RTL run (the hardest combination) so the
reviewer can see it without running anything. A screen that does not match yet is not done; it goes under
"Not tested or not verified" with the reason, never under Checks.
