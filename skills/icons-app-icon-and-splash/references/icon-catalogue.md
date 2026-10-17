# The shipped icon set

A neutral starter set of 19 icons for a Tasks-style app, drawn on the 24-unit grid in one colour. The
machine copy is `templates/design/icon-layers.json` (what `build-icon-paths.ts` reads); the generated
paths are `templates/src/ui/icons/icon-paths.ts`. Replace or extend it with the app's own icons: the
pipeline, the checks and the tests do not depend on these names (only `icon.test.tsx` uses `back`,
`check` and `plus`, and rtl-and-direction's default directional list names back, forward, chevron,
undo and redo).

How to read the layers column: `stroke w` is the path stroked at width w with round caps and joins;
`(butt)` is a butt-capped edge over a fill (it rounds the fill's corners); `fill` uses the nonzero
rule; `fill even-odd` keeps a hole (the keyhole). "Flips" means the icon points along the reading
direction and `Icon` mirrors it in right-to-left layouts.

| Icon | Flips | Used for | Layers, in draw order |
|---|---|---|---|
| `back` | yes | top-bar back, close a pushed screen | stroke 2 |
| `forward` | yes | next step in a flow | stroke 2 |
| `chevron` | yes | a row that opens a screen (trailing) | stroke 2.4 |
| `undo` | yes | undo the last change (snackbar, editor) | stroke 2, stroke 2 |
| `check` | no | done state, selected option | stroke 2.4 |
| `close` | no | dismiss a sheet, dialog or search | stroke 2.4 |
| `plus` | no | add a task or a list | stroke 2.4 |
| `search` | no | search field, search button | stroke 2, stroke 2 |
| `list` | no | lists tab, list view | stroke 2, fill, fill, fill |
| `bell` | no | reminders | stroke 2, stroke 2 |
| `calendar` | no | due date | stroke 2, stroke 2 |
| `settings` | no | settings (two sliders) | stroke 2, fill, stroke 1.4 (butt), fill, stroke 1.4 (butt) |
| `trash` | no | delete | stroke 2 |
| `edit` | no | rename, edit | stroke 2, stroke 2 |
| `info` | no | about, a help note | stroke 2, stroke 2, fill |
| `lock` | no | a Premium-only or locked item | stroke 2, fill even-odd |
| `star` | no | favourite off; a hollow rating star | stroke 2 |
| `star-fill` | no | rating fill layer (under `star-edge`) | fill, stroke 1.4 (butt) |
| `star-edge` | no | rating edge layer (over `star-fill`) | stroke 1.6 |

A filled rating star is `star-fill` and `star-edge` stacked in one box, each tinted from the theme
(icon-system.md, "Multi-colour glyphs"). Widths: 2 regular, 2.4 bold for the single-stroke marks that
must read at 16 pt, 1.4 for the soft edge of a fill.
