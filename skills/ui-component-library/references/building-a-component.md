# Building a component

The recipe every template follows. Use it for a new component, a variant the design adds, or when
adapting a template to an app's design.

## Contents

1. [Where a component lives](#where-a-component-lives)
2. [File anatomy](#file-anatomy)
3. [Measurements and paint](#measurements-and-paint)
4. [Icons: the slot](#icons-the-slot)
5. [Pressing: compose the press surface](#pressing-compose-the-press-surface)
6. [Motion and reduce motion](#motion-and-reduce-motion)
7. [With motion-and-animation's moment catalogue](#with-motion-and-animations-moment-catalogue)
8. [Writing the test](#writing-the-test)
9. [Lint limits that shape the code](#lint-limits-that-shape-the-code)
10. [Adding it to the catalogue](#adding-it-to-the-catalogue)
11. [Replacing older primitives](#replacing-older-primitives)

## Where a component lives

- `src/ui/<kebab-name>.tsx`, one component per file, the named PascalCase export equals the file name
  (`stat-grid.tsx` → `StatGrid`) with `export type StatGridProps`, its test beside it
  (`stat-grid.test.tsx`). naming-conventions owns file and export names.
- A component used by one feature only stays in that feature (`src/features/tasks/components/`). It
  moves to `src/ui/` when a second feature needs it, and joins the catalogue then.
- `src/ui/` is presentational: props in, JSX out. It never imports stores, features, data or
  services (architecture-and-boundaries' `ui-presentational`) and never the translation API
  (`ui-translates`): strings arrive translated and numbers formatted by the screen model
  (`use-<feature>-model.ts`). The one injected behaviour is the press feedback, read from the
  context design-system-structure ships.
- The screen model reads the reduce-motion hook and passes `isReducedMotion` down; components never
  read the accessibility store themselves. The one exception: once the app adopts
  motion-and-animation's moment catalogue, its hooks (`useMotionLoop`, `useCelebration`) read
  reduce motion inside `src/ui` themselves, so a component that plays through them (the BusyIndicator
  swap below) keeps `isReducedMotion` only as a prop its callers still pass until they are moved.

## File anatomy

```tsx
// src/ui/chip.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const CHIP = COMPONENT_SPECS.chip;

export type ChipProps = {
  /** Translated ("Work", "Due today"). */
  readonly text: string;
  readonly testID: string;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      paddingBlock: CHIP.paddingBlock,
      paddingInline: CHIP.paddingInline,
      borderRadius: CHIP.radius,
      borderWidth: CHIP.border,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
  });
  return styles;
});

/** A small flat label; the box is one accessible text element with the testID. */
export function Chip({ text, testID }: ChipProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={styles.chip} testID={testID} accessible accessibilityRole="text" accessibilityLabel={text}>
      <AppText variant="badge">{text}</AppText>
    </View>
  );
}
```

What it shows: the path on line 1; imports grouped (packages, `@/` aliases, siblings, then types);
`readonly` props with a doc comment where the value is not obvious; a required `testID`;
`makeStyles((theme) => { const styles = StyleSheet.create({...}); return styles; })` for themed
styles and a module-level `StyleSheet.create` for the rest; every number from `COMPONENT_SPECS` or
a token; colours from semantic roles; logical keys only (`paddingInline`, `start`, `end`,
`marginStart`); the testID on the element the design measures; an explicit `ReactNode` return type.

## Measurements and paint

- Every size, padding, gap, radius, border and elevation comes from `COMPONENT_SPECS.<group>` or a
  theme token (`SPACING`, `RADII`, `STROKE`, `ELEVATION`, `MIN_TOUCH`). A bare number inside
  `StyleSheet.create` fails `measurement-literal`; a value the design leaves unnamed becomes a named
  constant at the top of the file with a comment (`const DRAG_SLOP = 8; // pt before a drag starts`).
  How the specs are made: [measurements-and-specs.md](measurements-and-specs.md).
- Colours only from `theme.colors.<role>` (design-system-structure's `no-color-literal`). A new
  colour on a new ground is a new contrast pair: declare it in `contracts/contrast.json`
  (accessibility-as-code) before shipping.
- Text only through `AppText` with a type role or style (`variant`) and a `tone`; never `fontSize`.
- Faces that hold text grow with it: `minHeight`, never `height` (`fixed-text-height`).
- Static shadows only on components marked `mayShadow`, through `shadow()`; rotation only on
  components marked `mayRotate`.

## Icons: the slot

The library draws no icons of its own (only the CheckMark and Chevron state marks), so it works
with any icon set. A component that shows an icon takes an `IconSlot`, a function the component
calls with the size and colour its state needs:

```tsx
<Button label={copy.add} icon={(look) => <Icon name="plus" {...look} />} ... />
```

The component chooses the look (a disabled button asks for `textMuted`, a primary one for
`onPrimary`), so the icon always matches the label. icons-app-icon-and-splash builds the `Icon`.

## Pressing: compose the press surface

`PressableSurface` (design-system-structure) is the only press implementation. A new pressable
component passes its label, handler, testID, radius, fill, edge, `isReducedMotion`, a `faceStyle`
for the face's layout and a `layoutStyle` for its place in the parent:

```tsx
<PressableSurface
  label={props.label}
  onPress={props.onPress}
  testID={props.testID}
  radius={SPEC.radius}
  fill={theme.colors.surface}
  isReducedMotion={props.isReducedMotion}
  faceStyle={styles.face}
  layoutStyle={styles.block}
>
  ...
</PressableSurface>
```

More: `accessibilityRole` (`switch`, `radio`, `checkbox`), `isSelected` / `isChecked`, `isDisabled`,
`isBusy`, `hint`, `isStretched` (fill a row's height), `onPressIn` / `onPressOut` and
`accessibilityActions` / `onAccessibilityAction` (a hold). An app that needs a second press host
(a gesture-driven card) lists it under `pressHosts` in the catalogue, and the host runs the press
feedback (`press-feedback`).

## Motion and reduce motion

- Every animated component takes `isReducedMotion` and has a reduced alternative: a fade instead of
  a drop, a jump instead of a slide, nothing instead of a celebration, a still row instead of a loop.
- Durations, easings and springs come from the theme's motion tokens (`MOTION_MS`, `EASING`,
  `SPRINGS`; design-system-structure's `no-raw-duration` and `no-raw-spring`).
- A functional timer (the hold) passes `ReduceMotion.Never` (`hold-reduce-motion`).
- Shared values use `.get()` / `.set()`; an effect only starts and stops an animation and returns its
  cleanup (react-components-and-hooks owns effects).

## With motion-and-animation's moment catalogue

When the app has motion-and-animation's moment catalogue (`src/ui/motion/motion-moments.ts`), its
`check-motion.mjs` requires every animating file to name a moment. The templates time themselves from
the motion tokens and cannot import the catalogue's moments by default (they must work without it),
so the app declares one moment per animated component and lists the file in that moment's `files`:

| Component | Moment to declare (id is the app's) | `kind` / `reduced` | `timing` (the token the file spends) | `files` |
|---|---|---|---|---|
| Toggle knob | `toggleKnob` | state / `instant` | `{ duration: 'standard', easing: 'standard' }` | `src/ui/toggle.tsx` |
| Toast entrance | `toastEntrance` | transition / `fade` | `{ duration: 'standard', easing: 'decelerate' }` | `src/ui/toast.tsx` |
| Hold to confirm | `holdToConfirm` | functional / `unchanged` | `{ duration: 'holdToConfirm', easing: 'linear' }` | `src/ui/use-hold-to-confirm.ts` only |
| BusyIndicator | `busyWave` | attention / `static` | `{ duration: 'slow', easing: 'linear' }` | none: it reads the moment (below) |
| Confetti | none | | | drop Confetti (below) |

- **The hold** is the one functional moment: it is what lets `use-hold-to-confirm.ts` keep
  `ReduceMotion.Never` and commit from the timer's completion callback (`reduce-motion-opt-out`,
  `commit-before-motion` pass only in a functional moment's files). `hold-button.tsx` is not listed:
  its fill only reads the hook's progress, so check-motion sees no animation there and would fail
  the entry (`moment-files`: "animates nothing"). Its width is animated on purpose and carries
  `// motion-layout: an absolutely positioned, childless fill inside its track` (`compositor-props`).
- **BusyIndicator** loops forever, and check-motion allows an endless loop only inside
  `useMotionLoop` (`loop-through-hook`; listing the file does not lift it). Replace the template
  with this skill's `examples/busy-indicator-with-moments.tsx`: the same props and look, the wave
  from `useMotionLoop(MOTION_MOMENTS.busyWave, { isFocused })`, so it also stops while its screen
  is covered or the app is in the background. The template's test passes on it unchanged.
  `useMotionLoop` reads reduce motion itself (the one allowed exception to "components never read
  it", above), so the swap keeps `isReducedMotion` as an unread prop until its callers stop passing it.
- **Confetti** is a celebration, and a celebration must play through `useCelebration` from the
  handler that committed the result (`celebration-through-hook`), which a mount-started band cannot.
  Remove `confetti.tsx`, its test and its catalogue entry, and celebrate with motion-and-animation's
  `<CelebrationBurst>` (`celebration` / `none`).
- **Checked** in a copy of the reference app holding both skills' templates (2026-10-10): with these
  four moments, the BusyIndicator swap and Confetti removed, check-motion reports nothing in
  `src/ui/`; leaving `toggle.tsx` out of `files` fails it with `moment-declared` and
  `moment-unused`. Re-run motion-and-animation's `check-motion.mjs` after adopting.
- A new animated component either reads its moment through `timingOf(MOTION_MOMENTS.<id>)` (an app
  component that may depend on the catalogue) or keeps the tokens and is listed in `files` (a
  component that must also work without it), and gets a row in this table.

## Writing the test

Render through the app's render helper and assert what a person and a screen reader rely on:

```tsx
it('is named by its label, since an icon has no text to read', async () => {
  const onPress = jest.fn();
  const user = userEvent.setup();
  await renderWithProviders(
    <IconButton label="Settings" icon={glyph} onPress={onPress} testID="tasks.settings-button" isReducedMotion />,
  );

  await user.press(screen.getByRole('button', { name: 'Settings' }));

  expect(onPress).toHaveBeenCalledTimes(1);
  expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
});
```

- Query by role and name first; a part by its derived testID; a hidden part with
  `{ includeHiddenElements: true }`. A group role on a View that is not one accessibility element
  (a radiogroup) is asserted with `toHaveProp('accessibilityRole', ...)`.
- One or two load-bearing styles with `toHaveStyle` against the palette (`PALETTE.light.danger`) or
  the specs (`COMPONENT_SPECS.row.separator`), never literal values (unit-and-component-tests allows
  style assertions in `src/ui`).
- **Each non-colour state cue has an assertion that fails when the cue is removed** (SKILL.md rule
  7). A colour-only proof (`backgroundColor: PALETTE.light.primary`) stays green when the check is
  deleted, so query the cue itself: a drawn mark by its derived part with
  `{ includeHiddenElements: true }`, present in the state that shows it and absent otherwise; a
  width or edge cue with `toHaveStyle` against the specs. Remove the cue once and watch the test go
  red, then put it back:

  ```tsx
  expect(screen.getByTestId('settings.theme-control.light.check', HIDDEN)).toBeOnTheScreen();
  expect(screen.queryByTestId('settings.theme-control.dark.check', HIDDEN)).not.toBeOnTheScreen();
  expect(screen.getByTestId('onboarding.pager-dots.lists', HIDDEN)).toHaveStyle({
    width: COMPONENT_SPECS.pagerDots.activeWidth,
  });
  ```
- An icon slot is a `jest.fn` that records the look the component asked for.
- Every RNTL call is awaited (`render`, `fireEvent`, `user.press`); gestures go through
  `fireGestureHandler`; Android-only behaviour (back on a Modal) lives in `<name>.android.test.tsx`.
- A component test that renders a pressable ends with the `findInaccessiblePressables` audit.
- `component-untested` fails when no test imports the component.

## Lint limits that shape the code

typescript-and-lint-rules owns the limits; these patterns keep components inside them: optional
props spread conditionally (`{...(props.hint === undefined ? {} : { hint: props.hint })}`);
branchy render logic in small lower-case helpers that return JSX (they are not components, so one
component per file holds) with at most 3 parameters; a second component in a file becomes its own
file; hooks a fixed number of times, never in a loop (three blocks, three `useAnimatedStyle`); no
nested ternaries (a helper with early returns); no `useMemo` / `useCallback` / `memo` (React
Compiler).

## Adding it to the catalogue

Add an entry to `contracts/component-library.json`: name, file, role, the parts it derives and any
flag it needs (`hidesItself`, `mayRotate`, `mayShadow`, `inPairCell`, `modalRoot`, `drawnUnderline`,
`holdFill`, `scatter`; [catalogue-contract-and-checks.md](catalogue-contract-and-checks.md)). Add
its measurements to the token file's `components` block and run `write-component-specs.mjs`. A
component missing from the catalogue fails `component-unlisted`.

## Replacing older primitives

An app often has primitives from before the library (a `PrimaryButton` on a raw `Pressable` with an
opacity press, a `Row` with `TouchableOpacity`). `check-components.mjs` names them
(`press-outside-host`, `own-press-look`). For each: find every caller
(`grep -rln "primary-button" src`), move it to the library component (map the props, pass
`isReducedMotion` from the screen model, keep its testID), run tsc, ESLint and Jest, then delete the
old file and its test. Deleting files is a visible change: name the files and their callers in the
report.
