# Files, budgets and licences

The contract that records every Lottie and Rive file, what each field means, how the budgets are
set and proven, how to export a file that fits, and what a licence record needs. Read it when adding
or replacing an animation file, and when check-animations reports `unbudgeted-file` or
`missing-licence-record`.

## Contents

- The contract
- A record, field by field
- Budgets and their ceilings
- Frame rate
- Bounded loops
- Heavy moments
- Exporting a file that fits
- Licence and source
- Code that must agree with the record
- Config keys

## The contract

`contracts/animations.json` (template and JSON Schema in `templates/contracts/`) is the app's list of
animation files. The checker stays strict; the facts belong to the app. Start from the template's
empty list and add one record per file, in the same change that adds the file.

```json
{
  "$schema": "./animations.schema.json",
  "assetsDir": "assets",
  "wrapperFiles": ["src/ui/animation/**"],
  "budgets": { "maxBytes": 150000, "heavyFromBytes": 60000, "maxFps": 60, "maxPlays": 3, "maxSeconds": 6 },
  "animations": [
    {
      "id": "list-completed",
      "file": "assets/animations/list-completed.json",
      "runtime": "lottie",
      "job": "one-shot",
      "maxBytes": 40000,
      "fps": 30,
      "plays": 1,
      "heavy": true,
      "decorative": true,
      "reducedMotion": { "show": "frame", "progress": 1 },
      "licence": "Lottie Simple License (FL 9.13.21)",
      "source": "https://lottiefiles.com/... (the page it was downloaded from)",
      "author": "the designer's name"
    }
  ]
}
```

`examples/animations-contract.json` holds a complete contract with a Lottie one-shot and a Rive
state machine.

## A record, field by field

| Field | Lottie | Rive | Rule when wrong |
|---|---|---|---|
| `id` | kebab-case name | same | (schema) |
| `file` | repo path of the bundled `.json` or `.lottie` | repo path of the `.riv` | a URL: `remote-animation-source`; missing on disk: `unbudgeted-file` |
| `runtime` | `lottie` | `rive` | another value, or the wrong runtime for the extension: `unapproved-runtime` |
| `job` | `one-shot` or `loop` | `state-machine` | the other runtime's job: `unapproved-runtime` |
| `maxBytes` | byte budget, at most `budgets.maxBytes` | same | over it, or the file larger: `unbudgeted-file` |
| `fps` | the file's own `fr` | the `frameRate` the app renders at | above `budgets.maxFps`, or not the file's `fr`: `unbudgeted-file` |
| `plays` | 1 for a one-shot, 1 to `budgets.maxPlays` for a loop | (not used) | endless or out of range: `unbudgeted-file` |
| `stateMachine`, `settles` | (not used) | the state machine name; `settles: true` once confirmed | `settles` missing: `unbudgeted-file` |
| `heavy` | true for full-screen, large or costly art | same | not declared while the file is at least `heavyFromBytes`: `unbudgeted-file` |
| `decorative` | true when it carries no information | same | missing: `no-reduce-motion-fallback` |
| `reducedMotion` | `{ "show": "frame", "progress": 0..1 }` or `{ "show": "hidden" }` | `{ "show": "frame" }` (paused on its first frame) or `hidden` | missing, a frame without progress (Lottie), hidden on informative art: `no-reduce-motion-fallback` |
| `licence`, `source`, `author` | the licence, where it came from, who made it | same | `licence` or `source` empty or a placeholder (`TODO`, `unknown`): `missing-licence-record` |

## Budgets and their ceilings

`budgets` in the contract are the app's ceilings; each may be stricter than the library's, never
looser (a looser one is `unbudgeted-file` on the contract line).

| Key | Template | Library ceiling | Why |
|---|---|---|---|
| `maxBytes` | 150000 | 500000 | a Lottie file is parsed on the JS thread when required and held in memory; a large file is start-up and memory cost |
| `heavyFromBytes` | 60000 | 150000 | from this size a file is heavy by definition and plays alone |
| `maxFps` | 60 | 60 | an illustration authored at 120 fps doubles the frames rendered and gains nothing a person sees in a one-second flourish |
| `maxPlays` | 3 | 3 | a loop is a brief accent; a repeating illustration becomes noise and battery drain |
| `maxSeconds` | 6 | 10 | the whole run (length times plays); a moment is not a loading screen |

Tighten them after the first device report (performance-budgets measures frame time on Release
builds). Raising a record's `maxBytes` is fine within `budgets.maxBytes`; raising a budget needs the
reviewer.

## Frame rate

For Lottie, the checker reads `fr` (frames per second), `ip` and `op` (first and last frame) from the
`.json` header: `fr` must equal the record's `fps` and stay at or under `maxFps`, and
`(op - ip) / fr × plays` must stay at or under `maxSeconds`. A `.lottie` archive is not unzipped; its
record's `fps` is the designer's word, checked against `maxFps`. For Rive, the file has no fixed
rate: `fps` is what `<RiveMoment frameRate>` passes to `RiveView`'s `frameRate`, which caps the
render loop (otherwise a 120 Hz screen draws 120 frames a second of an idle mascot).

## Bounded loops

- Lottie: never the `loop` prop (it is endless and on by default in the library). `LottieMoment`
  plays `plays` times, then rests on the end frame and calls `onFinish`. A one-shot has `plays: 1`.
- Rive: a state machine runs while its states animate; one that settles stops drawing on its own.
  Before recording `settles: true`, ask the designer (or open the file in the Rive editor) whether
  every idle state has a timeline that ends. An endless idle loop is redesigned, not budgeted.
- Both: the moment holds still while the screen is not focused (`isActive` from the model hook) and
  while the app is in the background (`useIsAppActive`).

## Heavy moments

At most one heavy animation plays on screen at a time. The record says `heavy`, the code passes
`weight="heavy"` (the checker compares the two), and `AnimationStageProvider` (mounted once above the
screens, or around one screen) queues heavy moments: the first plays, the others hold their still
frame until it is done or unmounts. Light moments never wait. A full-screen celebration, a large
mascot and anything at or above `heavyFromBytes` are heavy.

## Exporting a file that fits

- Lottie (After Effects with Bodymovin, or LottieFiles): 30 fps unless the designer has a reason;
  shape layers, not embedded raster images (an embedded PNG is base64 inside the JSON); no
  expressions; trim unused layers and keyframes; text converted to shapes (fonts are not bundled
  with a Lottie file). A `.lottie` archive (zip) is smaller on disk and needs the Metro kit.
- Rive: export the `.riv` with fonts and images embedded (referenced assets load from Rive's CDN or
  need `referencedAssets`); one artboard and one state machine per moment; confirm every state settles.
- Pick the still frame with the designer: the frame that tells the story when nothing moves (the
  ticked box, the mascot at rest). `progress` 1 is the end frame.

## Licence and source

Every file needs a licence and a source in its record, because a store review, a takedown request or
a rebrand asks "where did this come from and may we ship it", and nobody remembers a year later.

- LottieFiles free animations are under the Lottie Simple License (FL 9.13.21): commercial use is
  allowed, attribution is not required but encouraged, and redistribution keeps the same terms (read
  on lottiefiles.com/page/license on 2026-10-21; re-check the file's own page, some are marked differently).
- Rive community files carry the licence shown on their marketplace page; record exactly that.
- Commissioned or in-house art: record who made it and that the rights are assigned to the app.
- When the licence is not known, stop and ask the developer; never write `unknown` to pass the check.

## Code that must agree with the record

For every `<LottieMoment>` and `<RiveMoment>` whose `source` is a literal `require('...')`, the
checker finds the record and compares: the tag fits the runtime (`unapproved-runtime`), `weight`
matches `heavy` and `plays` (Lottie) or `frameRate` (Rive) matches the budget (`unbudgeted-file`),
and `still` matches `reducedMotion` (`no-reduce-motion-fallback`). A `require()` or import of a
`.riv`, `.lottie` or Lottie `.json` that has no record is `unbudgeted-file` wherever it appears. A
source passed in a variable is not compared; keep the literal `require()` in the tag.

## Config keys

| Key | Where | Default | Meaning |
|---|---|---|---|
| `assetsDir` | contract | `assets` | folder scanned for Lottie `.json` files (the source folder is scanned too; `.riv` and `.lottie` are found anywhere) |
| `wrapperFiles` | contract | `src/ui/animation/**` (the layout's ui folder) | the only files that may import a runtime |
| `--contract <file>` | command line | `contracts/animations.json` (the layout's contracts folder) | another contract path |
| `--src-dir <dir>` | command line | the layout's `srcDir` | the app source folder |

When multi-package: run the checker once per app workspace (`node <skill>/scripts/check-animations.mjs apps/<app>`),
each with its own contract.
