# Non-negotiables

These rules hold for every screen, feature and release. If a task, a design or a library would break
one, stop and ask before writing code; never trade one away for convenience. Each entry says what it
means in practice and what enforces it.

## NN-1 · Tasks work offline

Adding, editing, completing and reading tasks never waits for the network. Anything that needs a
connection (a future sync, a purchase) says so on its own screen and never blocks the task list.

- In practice: repositories write to the local database first; no spinner waits on a request before
  the list renders.
- Enforced by: an offline end-to-end flow on the iOS simulator and the Android emulator, and the
  repository tests.

## NN-2 · Saved tasks survive every app update

An update never loses or corrupts a task, a list or a setting.

- In practice: every schema change is a forward-only migration with a test that upgrades a database
  saved by the previous version.
- Enforced by: the migration tests and the frozen database fixtures.

## NN-3 · Every screen works with a screen reader and large text

Every control has a role and a name, and every screen stays usable with VoiceOver, TalkBack and the
largest system text size.

- In practice: no information carried by colour alone; text wraps instead of clipping.
- Enforced by: the accessibility checks in the component tests and a VoiceOver and TalkBack spot
  check before each release.

## NN-4 · Layout says start and end, never left and right

The app mirrors correctly in right-to-left locales.

- In practice: logical style keys only (`marginStart`, `paddingEnd`); directional icons flip.
- Enforced by: the lint rules and the right-to-left screenshots.
