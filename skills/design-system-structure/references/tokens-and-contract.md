# Tokens, the token file and the contract

How values are named, stored and mapped into the theme modules, and the repo-owned contract the
checkers read. This skill teaches how a design system is structured; the values themselves belong to
the app's design (the templates ship neutral demo values for a Tasks app).

## Contents

- Two tiers, and why the naming matters
- The token file format (plain JSON, or DTCG spellings)
- The semantic colour roles
- From the token file to the theme modules (layout and shape tokens: layout-and-shape-tokens.md)
- contracts/design-system.json, key by key
- Adopting the create-expo-app theme
- Layout keys (rn-skills.config.json)
- White-label flavours: more than one palette
- The decision log: Chosen, Derived, Mock only
- When multi-package

## Two tiers, and why the naming matters

**Tier 1, primitives,** are raw values named by a measured fact: the demo names colours by their
OKLCH lightness x 100 (`neutral.97` is `#F5F6F8`, `blue.49` is `#2156C8`). A measured name stays
true in both schemes and leaves room to insert a value later. Names by rank (`grey700`), appearance
(`darkGrey`, which is the lightest neutral in dark mode) or brand (`brandPrimary`) rot.

**Tier 2, semantic roles,** name what a colour is for (`background`, `textMuted`, `border`,
`danger`). Light and dark are two tier-2 sets built from the same primitives.

Tier 1 never reaches app code: `write-palette.mjs` resolves the aliases and writes tier 2 only, so a
component cannot import a primitive even by accident. The generated `palette.ts` keeps the primitive
name as a comment (`background: '#F5F6F8', // neutral.97`) for the reviewer.

## The token file format

`design/tokens.json` (path set by the contract's `"tokens"`) is plain JSON:

```json
{
  "color": {
    "primitive": { "neutral": { "97": "#F5F6F8" }, "blue": { "49": "#2156C8" } },
    "light": { "background": "{color.primitive.neutral.97}", "primary": "{color.primitive.blue.49}" },
    "dark": { "...": "..." }
  },
  "spacing": { "sm": 8, "md": 12 },
  "type": { "roles": { "body": { "fontSize": 17, "weight": "regular", "face": "text", "lineHeight": { "base": 1.32, "tall": 1.5 } } } },
  "motion": { "spring": { "release": { "damping": 14, "stiffness": 420, "mass": 1 } } }
}
```

- An alias is a whole string `{dot.path}`; it may point at a leaf or at a whole group
  (`"colorBlind": { "light": "{color.light}" }`). A broken or circular alias is a `token-file`
  problem with its line.
- The W3C design-token (DTCG) spellings are accepted, so an export from Tokens Studio or Style
  Dictionary needs little conversion: a leaf `{ "$value": ..., "$type": ... }` resolves to its
  value, keys starting with `$` are metadata, and a px dimension `{ "value": 4, "unit": "px" }`
  becomes `4`. See `examples/tokens-dtcg-excerpt.json` in this skill.
  Composite typography tokens are not mapped: write type roles in the TypeStyle shape below.
- Values are what the theme modules hold, in the same shape: a type style is
  `{ fontSize, weight: 'regular' | 'medium' | 'semibold' | 'bold', face: 'display' | 'text' | 'brand', lineHeight: { base, tall }, letterSpacingEm?, isTabular? }`,
  and the press look is `press: { kind: 'opacity' | 'scale' | 'sink', androidRipple, opacity, scale, squash: { x, y }, disabledEdge: 'solid' | 'dashed' }`.

A token pipeline (Style Dictionary, a Figma sync) is worth it only when designers and developers are
different people editing tokens often; the checker works the same either way, because it compares the
committed theme modules with the committed token file.

## The semantic colour roles

| Role | Used for | Contrast duty |
|---|---|---|
| `background` | the screen ground | ground for text 4.5:1 |
| `surface` | cards, rows, sheets, control faces | ground for text 4.5:1 |
| `sunken` | tracks, disabled controls, pressed rows | ground for text 4.5:1 |
| `text`, `textMuted` | body and secondary text, icons | 4.5:1 on every ground they sit on |
| `primary`, `onPrimary` | the "go" fill and what sits on it | onPrimary 4.5:1 on primary; primary 3:1 off its ground or border |
| `border` | the edge of a control when it is its only boundary | 3:1 on background and surface (WCAG 1.4.11) |
| `separator` | decorative hairlines, translucent `#RRGGBBAA` | none (never a control's only boundary) |
| `shadow` | static and pressed shadows, may be translucent | none |
| `focus` | the focus indicator | 3:1 on every ground |
| `danger`, `dangerSurface` | destructive text and its tint | danger 4.5:1 on surface and dangerSurface |
| `success`, `warning` | confirmations and warnings | 4.5:1 on surface |
| `scrim` | dims the screen under dialogs, translucent | none |

`color-tokens-fields` requires the core roles `background, surface, text, textMuted, primary,
onPrimary, border, focus, danger`; add roles freely (a role per meaning, never per screen).
Destructive controls never reuse `primary`: they keep the surface fill and turn text, icon and
edge `danger`.

## From the token file to the theme modules

| Module (template) | Exports | Token path (demo contract) |
|---|---|---|
| `src/theme/tokens.ts` | `SPACING`, `RADII`, `STROKE`, `ELEVATION`, `MIN_TOUCH`, `CONTENT_MAX_WIDTH`, `TYPE_SCALE`, `PRESS` (and `LAYOUT` when the design has off-scale layout steps) | `spacing`, `radius`, `stroke`, `elevation`, `size.*`, `type.roles`, `press` (`layout`) |
| `src/theme/type-styles.ts` | `TYPE_STYLES` (+ `typeStyleOf`, `snapToGrid`, `lineHeightOf`) | `type.styles` |
| `src/theme/motion.ts` | `EASING`, `MOTION_MS`, `SPRINGS` | `motion.*` |
| `src/theme/palette.ts` | `PALETTE` (written by write-palette.mjs) | `color` (`light`, `dark`, `colorBlind?`) |

The export names are a public API: other skills' templates import them by name (adaptive-layout's
pane maths reads `CONTENT_MAX_WIDTH` and `STROKE.hair`; screen frames, dialogs, notices and form
fields read `CONTENT_MAX_WIDTH`, `SPACING`, `RADII`, `STROKE` and `MIN_TOUCH`). Change a value
freely; rename or remove an export only together with every importer (`grep -rn "STROKE\.hair"
src`), and say so in the change.

Copy or generate, never retype: `theme-mismatch` names the export, the key and both values. When the
design changes, change the token file first, then the module (or rerun write-palette.mjs), then rerun
the checker. The data modules stay pure TypeScript (type imports only, plain objects): the checker
imports them with Node's type stripping, so a module that imports React Native fails
`theme-module-load`.

## contracts/design-system.json, key by key

The template is `templates/contracts/design-system.json`; its JSON Schema,
`templates/contracts/design-system.schema.json`, gives editors completion. A malformed contract is
bad input (exit 2); a missing one is a `contract-missing` problem.

| Key | Meaning | Default |
|---|---|---|
| `tokens` | the token file | required |
| `exports` | `[{ file, name, token }]`: each export equals that token path | required (may be `[]`) |
| `palettes` | `[{ file, export, token }]`: palette modules and their `{ light, dark, colorBlind? }` path | required, at least one |
| `invariantFields` | roles identical in every palette | `[]` |
| `files` | overrides of module paths by key: `themeTypes`, `tokens`, `typeStyles`, `motion`, `fonts`, `palette`, `contrast`, `themeSet`, `themeContext`, `useTheme`, `makeStyles`, `themeProvider`, `textLocale`, `textStyle`, `shadowStyles`, `appText`, `balancedWrap`, `pressSurface`, `pressFeedback` | the template paths under `src/theme` and `src/ui` |
| `text.tabularStyles` | roles or styles that must carry `isTabular: true` | `["number"]` |
| `text.minTallLineHeight` | `{ styleName: minimum tall ratio }`, device-proven minimums | `{}` |
| `fonts` | the font decision, always declared: `"system"` for the platform's font, or `{ dir, files: [{ file, family, sha256 }], licences: { family: file }, weightBy? }` (at least one file) for bundled fonts. A missing key, `null` or an empty `files` list is bad input, because none of them says which of the two the app chose | `"system"` in the template: nothing bundled, the file, pin, licence, plugin and `no-font-weight` rules off; an object turns every one of them on |
| `lightOnly` | `{ "reason": "..." }`: the app has no dark appearance, and why (a design decision with its reason, revisited when a dark set exists). `color-scheme-config` then requires `userInterfaceStyle: 'light'` and `preference="light"` on every `AppThemeProvider` mount instead of `'automatic'`; a missing or blank reason is bad input (theme-in-react-native.md, "Light-only apps") | absent: light and dark follow the phone |
| `fonts.weightBy` | `"family"` (a file and family per weight, never `fontWeight`) or `"fontWeight"` (Expo's object syntax, text-and-fonts.md) | `"family"` |
| `rawValues.scan` | folders check-raw-values scans | `src` and the routes folder (`src/app`, or `app/` at the root) minus `src/core`, `src/data`, `src/api`, `src/stores`, `src/services`, `src/i18n`, `src/config` |
| `rawValues.allowColors` | globs where colour literals may appear | `["<themeDir>/**"]` |
| `rawValues.policy` | opt-in visual policies: `noGradients` (flat paint), `maxRadius` (no pills) | off |

The visual policies are app choices, never library rules: a brand that paints flat or forbids pill
buttons turns them on and keeps the checker's teeth. The contrast pairs are not in this contract:
they live in `contracts/contrast.json` (palettes-and-contrast.md).

## Adopting the create-expo-app theme

The SDK 57 default template (`npx create-expo-app`, `expo-template-default` 57.0.28, read on
2026-10-03; re-verify with `npm pack expo-template-default@57` and its `src/`) ships a small theme of
its own: `src/constants/theme.ts` (`Colors` light/dark, `Spacing`, `Fonts`, `BottomTabInset`,
`MaxContentWidth`), `src/hooks/use-theme.ts` (a `useTheme()` that returns `Colors[scheme]`),
`src/hooks/use-color-scheme.ts` and `.web.ts`, and `src/components/themed-text.tsx` /
`themed-view.tsx`; its root layout passes `colorScheme === 'dark' ? DarkTheme : DefaultTheme` to the
navigation `ThemeProvider`, and `app-tabs.tsx` paints `NativeTabs` from `Colors`. Kept beside
`src/theme`, the app has two `useTheme` hooks with different return shapes (`theme.text` there,
`theme.colors.text` here), colours no contrast pair ever judged, and a scheme that ignores the in-app
setting. So the template's theme is a set of values to migrate, then delete
(`second-theme-system` fails while `constants/theme.ts` or a second `useTheme` is left; check-raw-values
prints a note naming them).

1. Copy the values into `design/tokens.json` and log each as **Chosen** (the decision log):

   | Template | Token file | Notes |
   |---|---|---|
   | `Colors.*.text` | `color.<scheme>.text` | |
   | `Colors.*.background` | `color.<scheme>.background` | |
   | `Colors.*.backgroundElement` | `color.<scheme>.surface` | cards and control faces |
   | `Colors.*.backgroundSelected` | `color.<scheme>.sunken` | selected and pressed fills |
   | `Colors.*.textSecondary` | `color.<scheme>.textMuted` | |
   | the `linkPrimary` colour in `themed-text.tsx` | `color.<scheme>.primary` | the template has no other accent |
   | `Spacing` (`half` 2 ... `six` 64) | `spacing` | keep the names or rename by size step; the checker compares values |
   | `MaxContentWidth` (800) | `size.contentMaxWidth` | |
   | `BottomTabInset` | none | a navigator measurement: read insets from the device (layout-and-shape-tokens.md, "The screen frame") |
   | `Fonts` (`system-ui`, `ui-rounded`, `ui-monospace` ...) | the system font: contract `"fonts": "system"` | the template bundles no font file |
   | `ThemedText` types (`title` 48/52, `subtitle` 32/44, `default` 16/24, `small` 14/20) | `type.roles` (`display`, `title`, `body`, `caption`) | ratio = lineHeight / fontSize (24 / 16 = 1.5); add a `tall` ratio |

   The roles the template lacks (`onPrimary`, `border`, `focus`, `danger`, `dangerSurface`,
   `success`, `warning`, `separator`, `shadow`, `scrim`) keep the demo values until the design
   chooses them; write-palette then judges every pair in both schemes and names the colours to move.
2. Replace `ThemedText` with `AppText` (`type="title"` becomes `variant="display"`,
   `themeColor="textSecondary"` becomes `tone="muted"`), `ThemedView` with a `makeStyles` style
   (`backgroundColor: theme.colors.background`), and every `useTheme()` from `@/hooks/use-theme`
   with the one from `@/theme/use-theme` (`theme.text` becomes `theme.colors.text`). `app-tabs.tsx`
   reads `useTheme()` for `NativeTabs`' `backgroundColor`, `indicatorColor` and label colour instead
   of `useColorScheme()` and `Colors`.
3. Replace the root layout's navigation provider with `AppThemeProvider` around
   `NavigationThemeProvider` (theme-in-react-native.md), then delete `src/constants/theme.ts`,
   `src/hooks/use-theme.ts`, `src/hooks/use-color-scheme*.ts`, `themed-text.tsx` and `themed-view.tsx`
   (`tsc` names any reader left). Running the template's `npm run reset-project` first moves the
   example screens and all of these files to `example/` (or deletes them); delete `example/` once
   its values are in the token file.

## Layout keys

Every checker resolves folders through the canonical layout (`src/theme`, `src/ui`, `src/app`,
`src/i18n`, `contracts`), the `tsconfig.json` `paths` aliases (the Expo template's `@/*` when the repo
declares none), and an optional repo file `rn-skills.config.json`
(`{ "srcDir": "app-src", "themeDir": "app-src/design" }`). The contract's `files` entries override
single modules. One more key is read from `rn-skills.config.json`: `"contrastContract"`, the path of
the contrast contract when it is not `contracts/contrast.json`.

Two other shapes of Expo's templates work too:

- **Routes in `app/` at the repo root, next to `src/`:** found without options when `src/app` does not
  exist. The root layout there counts as a mount, and check-raw-values scans it with `src`.
- **No `src/` at all** (the pre-SDK-52 template, `@/*` -> `./*`): declare `{ "srcDir": "." }`. The
  checkers then read the whole repo minus the folders where nothing is drawn (`core`, `data`, `api`,
  `stores`, `services`, `i18n`, `config`), `test/`, `__mocks__/`, `scripts/`, the e2e and contracts
  folders, and root `*.config.ts` / `*.setup.ts` files; an `App.tsx` at the root is app code and is
  read. Point the contract's paths (`exports`, `palettes`, `rawValues.allowColors`) at `theme/...`.

## White-label flavours: more than one palette

A white-label app ships one palette per brand: add a token path per flavour, generate each module
(`write-palette.mjs . --token flavours.acme --out src/theme/acme-palette.ts --export ACME_PALETTE`),
list it in `palettes`, and name the roles every brand must keep in `invariantFields` (danger, focus,
success: users learn them, a brand must not repaint them). Build each flavour's theme set inside
`src/theme` (for example `themesFor(variant)` in `src/theme/flavours.ts`, calling `createThemeSet`),
pick it at startup from the app variant (app-variants-and-environment) and pass it to
`AppThemeProvider` (`themes` prop): a palette imported outside `src/theme` is a `no-palette-import`
problem. Give each flavour its own entry in `contracts/contrast.json`. The one exemption is Expo
Router's static web root (`src/app/+html.tsx`, `+html.web.tsx`, web-support): it runs in Node at
export time, outside every provider, and paints both schemes' ground with `prefers-color-scheme`.

## The decision log: Chosen, Derived, Mock only

Designs leave values open or contradict themselves. Keep a short log next to the token file
(`design/decisions.md`): **Chosen** marks a value picked on purpose where the design was silent,
**Derived** a computed value (a contrast ratio, an `#RRGGBBAA` twin of an `rgba()`), **Mock only** a
placeholder that is never built. A reviewer reads the log before asking why a value differs from the
mockup, and a value changes only with its entry.

## When multi-package

Run every script from the repo root, as in a single app. In a workspace repo (`package.json`
`"workspaces"`) whose root is no app, each **Expo app workspace** (a workspace with an
`app.config.*` or `app.json`; failing that, one that depends on `expo`) is checked as an app of its
own: `apps/mobile/` is the root its `contracts/design-system.json`, `contracts/contrast.json`, token
file, `src/`, `app.config.ts` and `package.json` are read from, so contract paths stay app-relative
(`"tokens": "design/tokens.json"`), and every problem names the file from the repo root
(`FAIL apps/mobile/app.config.ts:9 [color-scheme-config] ...`). The output starts with an `apps:`
line naming the apps found. Passing the app folder (`check-design-system.mjs apps/mobile`) checks that
app alone.

When the design system lives in a package instead (`packages/ui/src/theme`, consumed by the apps as
`@<org>/ui`), point the checkers at it with `rn-skills.config.json` (`themeDir`, `uiDir`) or the
contract's `files`, keep one token file and one contract per design system, and run the checkers
once per app that bundles fonts (fonts and `app.config.ts` belong to the app). Package source
imports carry their extension, as the canonical ESLint config requires in multi-package mode.
