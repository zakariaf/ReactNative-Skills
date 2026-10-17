# The feature unit

What one screen feature is made of, why each part exists, what each part may import, and how it
grows. The rules here are this skill's; where a deeper rule belongs to another skill, it is named.

## Contents

- Naming the feature
- The files and their jobs
- What each file may import
- The model's shape
- Growing: splits, components, dialogs, pure logic
- iOS and Android behaviour the scaffold already handles
- What the scaffold needs
- Pitfalls and fixes
- Verified facts

## Naming the feature

One kebab-case word or phrase names the screen, not the data: `notes` (the list of notes),
`note-detail` (one note), `note-editor` (editing one), `settings`. The name becomes:

| Where | Form | Example |
|---|---|---|
| folder | `src/features/<f>/` | `src/features/note-detail/` |
| files | `<f>-screen.tsx`, `use-<f>-model.ts`, `<f>-params.ts`, `<f>-navigation.test.tsx` | `use-note-detail-model.ts` |
| exports | `<F>Screen`, `<F>ScreenProps`, `use<F>Model`, `<F>Model`, `<F>State`, `parse<F>Params`, `<F>Route` | `NoteDetailScreen` |
| testIDs | `<f>.<element>` | `note-detail.go-home-button` |
| message keys | `<f>.<element>[.<variant>]` | `note-detail.invalid-link.body` |
| screen contract | `"id": "<f>"` | `"note-detail"` |

Why one word for all of them: a reviewer greps `note-detail` and sees the screen, its texts, its E2E
ids and its contract entry at once; translators see which screen a key belongs to; naming-conventions'
rules (kebab files, exports named after files, testIDs `<screen>.<element>`, keys with a feature first
segment) are all satisfied by construction.

A list and its detail are two features, not one folder with two screens: each has its own model, its
own states and its own route. Shared pure logic between them (a formatter, a sort) moves down to
`src/core` or `src/ui` when the second feature needs it; features never import each other
(architecture-and-boundaries' `feature-to-feature`).

## The files and their jobs

```
src/app/(app)/notes/[noteId].tsx                 the route: calls the model hook, renders the view
src/features/note-detail/
  note-detail-screen.tsx                         the pure view: one layout per state
  use-note-detail-model.ts                       the only reader: params, copy, stores, services, navigation
  note-detail-params.ts                          (dynamic route) the valibot params parser
  components/note-detail-invalid-link.tsx        presentational parts of the view
  note-detail-screen.test.tsx                    view test: one block per state, the pressable audit
  use-note-detail-model.test.tsx                 model test: inside a real router, real catalogs
  note-detail-params.test.ts                     parser test: accepted and rejected shapes
  note-detail-navigation.test.tsx                route test: the route file opened at its URL
```

- **The route file** exists because Expo Router needs a default export at that path. It is a leaf:
  `const model = use<F>Model();`, `<Stack.Screen options={{ title: model.title }} />`,
  `<F>Screen model={model} />`. Passing the model whole or spreading its fields are both fine
  (react-components-and-hooks); the scaffold passes it whole so the view's props type is one line.
- **The view** renders the model. It sets the testIDs, picks the layout for `model.state.kind`, and
  composes `src/ui` primitives (`AppText`, `PressableSurface`, or the app's library components). It
  never decides which state shows.
- **The model hook** reads everything the screen needs and returns one object of plain values and
  handlers: texts already translated, numbers already formatted, `isReducedMotion` from the
  accessibility hook, handlers that dispatch store actions or navigate.
- **The params parser** turns the raw URL params into a typed value or a failure the model maps to the
  invalid-link state ([routes-and-params.md](routes-and-params.md)).
- **The tests**: four kinds, one per file ([test-recipes.md](test-recipes.md)).

## What each file may import

| File | May import | Never |
|---|---|---|
| route | `expo-router` (`Stack`), the feature's view and model hook | stores, services, data, api, other hooks, `t()` |
| view, `components/` | `react-native`, `@/ui/*`, `@/theme/*`, sibling components, `import type` of the model | `expo-router`, `@react-navigation/*`, stores, services, `src/data`, `src/api`, `zustand`, TanStack Query, `react-intl`, `useT`, the model hook as a value |
| model hook | `expo-router` hooks, `useT`, stores through selectors, `useServices()`, the data context, query hooks, the feature's pure logic and parser | another feature, an adapter, a fake |
| params parser, pure logic | `valibot`, `@/core/*` | React, React Native, Expo |

`check-feature.mjs` enforces the view row (`view-pure`) and the params rows (`params-in-model`);
architecture-and-boundaries enforces layer direction, route thinness and adapters.

## The model's shape

```ts
export type NoteDetailModel = {
  readonly title: string;                 // the navigation title, translated
  readonly state: NoteDetailState;        // which layout: a discriminated union on kind
  readonly body: string;                  // texts, translated
  readonly invalidLinkText: string;
  readonly goHomeLabel: string;
  readonly onGoHome: () => void;          // handlers, ready to call
  readonly isReducedMotion: boolean;      // from the reduce-motion hook, for PressableSurface
};
```

- Every field `readonly`; arrays `readonly T[]`. A view cannot mutate what it is given.
- `state` is a union on `kind` (`'ready' | 'invalid-link'`, later `'loading' | 'empty' | 'error'`), and
  data that exists only in one state lives inside that state's member (`{ kind: 'ready'; noteId }`),
  so the view cannot read a note in the invalid-link layout.
- Texts that depend on data are built in the model with `t('<key>', { count })`; the view never
  concatenates.
- The model's tests assert the whole object (`toStrictEqual`) for the static screen: a field added
  without a test fails the test.

## Growing: splits, components, dialogs, pure logic

- **Past about 40 lines** (typescript-and-lint-rules' function limit is 40 in `.ts`), split the hook:
  `use-<f>-actions.ts` returns the handlers, a pure `<f>-model-of.ts` builds the model from plain
  values (test it without rendering), and `use-<f>-model.ts` joins them. Each part is a hook file or a
  pure function with its own test.
- **The state chooser** is a pure function (`<f>-state.ts`, `listDetailStateOf(result)`) once more
  than one input decides the state; screen-contracts requires the decision to be pure and tested.
- **Components** go in `components/`, one per file, named after the file, props `readonly`, texts and
  testIDs passed in (the scaffold's invalid-link component takes `textTestID` and `buttonTestID` from
  the view). A component a second feature needs moves to `src/ui` (ui-component-library).
- **A dialog with its own model** (a confirmation that reads the store) gets a subfolder
  `src/features/<f>/<dialog>/` with its view and test; the screen's model owns opening it through the
  handler a person's press uses (screen-contracts).
- **A hook only this feature uses** stays in the feature root as `use-<f>-<part>.ts`; it moves to
  `src/hooks` when a second feature needs it (react-components-and-hooks).

## iOS and Android behaviour the scaffold already handles

- **Header title.** `<Stack.Screen options={{ title }} />` inside the route sets the native header:
  `UINavigationBar` on iOS (large titles only when the layout asks), the Material top bar on Android.
  The title comes from the model, so it is translated and follows the layout direction.
- **Back.** The native stack gives the iOS edge swipe and the Android back button and predictive back
  gesture; a scaffolded screen holds no unsaved work, so nothing blocks them. A screen that later edits
  data adds navigation-and-routing's discard guard.
- **Cold-start links.** A deep link or a notification often opens a detail route alone, with nothing
  below it. The invalid-link state's way out is `router.dismissTo('/')`: with the home screen below it
  returns there; alone it replaces the dead link with the home screen, so Back (iOS swipe, Android
  back) cannot return to it. The route test proves the cold-start case (`router.canGoBack()` is false).
- **Edge to edge.** Android 15+ draws behind the system bars and iOS has the notch and home indicator.
  Under the Stack header only the side and bottom insets matter. When the app has
  react-components-and-hooks' `src/ui/screen-frame.tsx`, the generator writes the view's root as
  `<ScreenFrame testID="<f>.screen" edges={BELOW_HEADER_EDGES}>` (the frame brings the ground colour,
  the insets and the centred column, so the view drops its own) and the screen entry's root
  `component` as `ScreenFrame`; the plan's first line says which root it wrote. Without it the root
  is a plain `View` with a centred column (`CONTENT_MAX_WIDTH`) and nothing scrolls yet: once the app
  adds ScreenFrame, swap the root of each such screen by hand (the templates keep the plain root
  because they must compile in an app without ScreenFrame; verified both ways on 2026-10-14). A body
  that scrolls under the home indicator later moves to `BELOW_HEADER_SCROLLING_EDGES`
  (react-components-and-hooks).
- **Right to left.** Styles use logical keys only (`paddingInline`, `paddingBlock`); text runs
  through `AppText`; nothing in the scaffold mirrors by hand (rtl-and-direction).
- **Large text and wide windows.** The column caps at `CONTENT_MAX_WIDTH` and centres on tablets and
  foldables; `AppText` caps font scaling (design-system-structure).

## What the scaffold needs

The generated files import these; each is created by the skill named. In an app adopted
incrementally, create them first.

**The bootstrap starter.** An app fresh from expo-project-bootstrap ships `src/app/index.tsx`
rendering `<HomeScreen />` from `src/features/home/` (a view and its test, no model). Both files say
in their header that the first real feature (this skill) replaces them. They hold no work, so:

1. delete `src/app/index.tsx` and `src/features/home/`;
2. generate the first feature at the root URL: `--route index` (or `"(app)/index"` once the app has
   an `(app)` group), with the feature name the screen really is (`--feature tasks`, or `home`).

The generator never overwrites them: it names the starter files in one `starter` problem and writes
nothing, and while another feature is generated beside the starter it prints a note.
`check-feature.mjs` reports a starter left in place as one `starter-screen` line instead of four
unrelated failures. Both recognise the starter by the header phrase
`(scaffold-feature-screen) replaces` in its first lines.

| Import | From | Creator |
|---|---|---|
| `@/theme/make-styles`, `@/theme/tokens` (`SPACING`, `RADII`, `CONTENT_MAX_WIDTH`) | the theme | design-system-structure |
| `@/ui/app-text`, `@/ui/pressable-surface` | text and press primitives | design-system-structure |
| `@/ui/screen-frame` (`ScreenFrame`, `BELOW_HEADER_EDGES`), only when present | the view's root | react-components-and-hooks |
| `@/ui/a11y/use-reduce-motion` | the reduce-motion hook | accessibility-as-code |
| `@/i18n/t-context` (`useT`), `@/i18n/i18n-provider` | translation | i18n-strings-and-catalogs |
| `@/core/result` (`ok`, `err`, `Result`) | typed results | error-handling-typed-results |
| `valibot` | the parser schema | navigation-and-routing (stack) |
| `@test/render-with-providers`, `@test/render-router-with-providers` | render helpers | unit-and-component-tests |
| `@test/a11y/find-inaccessible-pressables` | the pressable audit | accessibility-as-code |
| `expo-router` with `experiments.typedRoutes` | the router | navigation-and-routing |

## Pitfalls and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@/app/(app)/notes'` in the route test | the route file was moved or renamed | regenerate, or fix the import to the route id |
| route test passes, the device shows "Unmatched route" | the route file sits outside `src/app` (`app/` folder too) | one routes folder; `rn-skills.config.json` `routesDir` when it is not `src/app` |
| `useT must be used inside I18nProvider` in the model test | the test renders without the app's provider | the template's `i18nWrapper()` (test-recipes) |
| every link opens the invalid-link state | the parser key differs from the bracket name | `params-parser` names it; rename one of them |
| `tsc`: `Argument of type '"notes.empty"' is not assignable` | the app's `t()` takes only source-catalog keys (`MessageKey`) and the key is not in `en.json` yet | add it to every catalog first (verified in the reference app) |
| Arabic screen shows the key name | a key added to `en.json` only (`tsc` passes: it reads the source catalog) | the generator merges into every catalog; `message-key-missing` |
| `tsc` fails on `router.dismissTo('/notes/7')` | typed routes do not know a route yet | run the app once (or `npx expo customize tsconfig.json`) so `.expo/types` regenerates |
| `prettier --check` fails after a hand edit of a generated file | line lengths changed | `npx prettier --write` the file; the generator already formats what it writes |

## Verified facts

Verified on 2026-10-14 with Expo SDK 57 (expo-router 57.0.24, React Native 0.86.3, React 19.2.3,
TypeScript 6.0.3, Jest 29.7 with jest-expo 57 and RNTL 14.0.1) in the reference app: both template
groups generated by `scaffold-feature.mjs`, then `tsc` (both programs), ESLint `--max-warnings 0`,
Prettier, 20 Jest tests, and the checkers of navigation-and-routing, screen-contracts,
i18n-strings-and-catalogs, architecture-and-boundaries, react-components-and-hooks,
unit-and-component-tests, naming-conventions, accessibility-as-code, rtl-and-direction,
design-system-structure and ui-states-and-feedback all passed. Behaviour of the native header and
back gestures is from Expo's Stack documentation (SDK 57), not re-measured on a device here.
Re-verify after an SDK upgrade: `npm view expo-router@latest version`, then rerun
`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs` and the scaffolded features' Jest tests.
