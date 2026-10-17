# Layer order: which layer is tested first

Each layer is tested before anything depends on it. This page owns the order of layers inside a
feature and the first failing test of each layer. The order in which a whole app is set up (bootstrap,
gates, the composition root, the startup and route skeleton, then features) is the index's
(react-native-conventions-index); app-startup-and-bootstrap and navigation-and-routing own the
startup and route skeleton a new screen plugs into.

## Contents

- The layer order
- Adding a feature, slice by slice
- Per layer: what the first failing test usually is
- When a lower layer is missing
- Appendix: React Navigation 7 (static API)
- Appendix: the games plugin

## The layer order

```text
pure domain logic (examples + properties + a pinned value)       src/core/, src/features/<f>/*.ts
  -> persistence: schema, migrations, repositories (node:sqlite)   src/data/, test/sqlite/
    -> services behind ports, tested over fakes                     src/services/<concern>/
      -> stores and the feature model hook                          src/stores/, use-<f>-model.ts
        -> components and the screen (component tests)              src/features/<f>/**/*.tsx
          -> the route file and its route test                      src/app/ + <f>-navigation.test.tsx
            -> end-to-end flows (iOS simulator and Android emulator) .maestro/
              -> screenshot matrix (light/dark, LTR/RTL, both platforms)
```

Why: a screen test that fails because a rule is wrong wastes the slice, and a rule proven by properties
never needs debugging through the UI. The model hook is the only code that reads stores, services and
navigation, so once it is tested the screen stays a pure view whose tests pass plain props.

## Adding a feature, slice by slice

A feature such as "reminders for a task" lands as a sequence of slices, each one commit, each starting
with its own red test:

1. **The pure rule** (`src/features/reminders/next-reminder.ts`): when the next reminder fires for a
   due date and a lead time, every limit at exactly its value. Examples, properties (never before
   now, monotonic in the lead time), one pinned value.
2. **Persistence** (when the feature stores data): a migration with its frozen fixture, the repository
   on `node:sqlite` under `test/sqlite/` (persistence-and-migrations).
3. **The service and its port** (`src/services/reminders/`): the port, the fake with a call log, the
   service tested over fakes (one test per requirement rule); the adapter over the native SDK is tested
   against its root mock, or carries the device-only marker naming the device check.
4. **The store slice and the model hook**: the reducer cases first (pure), then
   `use-reminders-model.ts` tested through the render helper with seeded stores.
5. **The components and the screen**: by role and accessible name, one interaction per test, the
   accessibility audit line last. Android-only behaviour (hardware back, predictive back, a permission
   result) in `<unit>.android.test.tsx`.
6. **The route**: the thin file in `src/app/` renders the screen from `src/features/`; the route test
   (`reminders-navigation.test.tsx`) proves the link, the deep link and back.
7. **The flow**: one Maestro flow reaching the screen by testID, run on a named iOS simulator and a named
   Android emulator (e2e-maestro).
8. **The screenshots** of each changed screen: light and dark, the source locale and an RTL locale when
   the app ships one, on both platforms, compared with the approved design baseline
   (design-visual-parity).

## Per layer: what the first failing test usually is

| Layer | First test |
|---|---|
| Pure logic | an example for the simplest case, then the determinism property |
| Persistence | the migration from the frozen previous-version fixture, then the repository round trip |
| Services | the port's behaviour over its fake, one test per requirement rule (every limit at exactly its value) |
| Stores | one reducer case per action; the selector for one seeded state |
| Model hook | the hook's returned value for one seeded store state, then one action through it |
| Components and screens | the main element by role and name, then one interaction |
| Route | the route renders its screen; a link or deep link lands on it; back returns |
| End-to-end | a smoke flow that reaches the screen by testID on both platforms |
| Screenshot matrix | the screen captured still (fixed clock, seed, status bar) in light and dark, LTR and RTL |

## When a lower layer is missing

If the slice needs a lower layer that is untested (a screen that needs a rule nobody wrote, a service
whose port has no fake), build that slice first and say so in the plan. Never test the missing rule
through the screen "for now": the screen test then carries two behaviours, and the rule never gets its
properties.

## Appendix: React Navigation 7 (static API)

An app on React Navigation instead of Expo Router keeps the same order; only the route layer differs.
The navigator is a static config object (`createNativeStackNavigator({ screens: { … } })`) rendered
through `createStaticNavigation`, and the route test renders that navigation component inside the
app's providers (unit-and-component-tests, appendix "when the app uses React Navigation 7") instead of the
Expo Router helper. Screens still live in `src/features/<feature>/`, and there is no routes folder, so
the test-in-routes rule finds nothing to check.

## Appendix: the games plugin

A game (public-domain mechanics, for example Lights Out as `lights-out`) inserts its own layers below
the persistence layer, under `src/games/<game-id>/`:

```text
rules (examples + properties: determinism, invariants after any legal move sequence)
  -> bot and simulations (*.sim.test.ts under test/sims/<game-id>/: winnability, termination)
    -> level generator, solver and par (data goldens, "every generated level is solvable")
      -> persistence of the game state, the board (pixel goldens), the session host
```

game-rules-engine, game-balance-and-bots and level-generation-and-solvers own those layers; this
skill's loop and checkers apply unchanged (`*.sim.test.ts` counts as a test file).
