# Worked example: a task row that mirrors correctly

Task: a task row shows the title at the start, the due date at the end and a chevron after it. In
Arabic the whole row mirrors: title on the right, due date and chevron on the left, the chevron
pointing left. The title is the person's own text, so it keeps its own direction.

If the app's component library already has a list row (ui-component-library), build on it; this
minimal row shows the rules on their own, and the test pattern applies to any component with text or
a row.

## The component

```tsx
// src/features/tasks/components/task-row.tsx
import { StyleSheet, View } from 'react-native';

import { useDirection } from '@/i18n/direction-context';
import { firstStrongDirection } from '@/i18n/text-direction';
import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { Icon } from '@/ui/icons/icon';
import { PressableSurface } from '@/ui/pressable-surface';

export type TaskRowProps = {
  /** The person's own text: laid out by its first strong letter. */
  readonly title: string;
  /** Already formatted in the model hook (dates and digits from the locale tag). */
  readonly dueText: string;
  readonly onPress: () => void;
  readonly testID: string;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    // 'row' mirrors by itself: never 'row-reverse', never marginLeft/marginRight.
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingInline: SPACING.md },
    title: { flex: 1 },
  });
  return styles;
});

export function TaskRow({
  title,
  dueText,
  onPress,
  testID,
  isReducedMotion,
}: TaskRowProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  const layout = useDirection();
  return (
    <PressableSurface
      label={title}
      onPress={onPress}
      testID={testID}
      radius={RADII.md}
      fill={theme.colors.surface}
      isReducedMotion={isReducedMotion}
    >
      <View style={styles.row}>
        <View style={styles.title}>
          <AppText direction={firstStrongDirection(title) ?? layout} numberOfLines={2}>
            {title}
          </AppText>
        </View>
        <AppText tone="muted" align="end">
          {dueText}
        </AppText>
        {/* chevron is in DIRECTIONAL_ICONS: Icon flips it in a right-to-left layout. */}
        <Icon name="chevron" />
      </View>
    </PressableSurface>
  );
}
```

What each choice buys:

| Choice | Why |
|---|---|
| `flexDirection: 'row'`, `paddingInline`, `gap` | the title sits at the start edge in both directions; nothing to mirror by hand |
| `align="end"` on the due date | `TEXT_ALIGN.end` is `'right'`, which React Native swaps to the left in Arabic |
| `direction={firstStrongDirection(title) ?? layout}` | "Buy milk!" in an Arabic screen keeps its `!` at its own end; an Arabic title reads right to left on an English screen |
| `Icon name="chevron"` | `Icon` flips it; the call site never checks the direction |
| strings as props | the model hook formats the date and digits with the locale tag and calls `t()` |
| `label={title}` | the screen reader names the row by its task; `PressableSurface` (design-system-structure) requires it, with `radius`, `fill` and `isReducedMotion`. A label that joins the title and the due date is a message with placeholders from the model hook, never a template literal in JSX |

The same row written wrong, and what `check-rtl` says:

| Wrong | Rule |
|---|---|
| `flexDirection: isRtl ? 'row-reverse' : 'row'` | `row-reverse` (and `i18nmanager` for the `isRtl` it reads) |
| `marginLeft: 'auto'` on the due date | `physical-style-key` (use `marginStart`) |
| `<Text style={{ textAlign: 'right' }}>` | `text-import`, `text-align-literal` |
| `style={{ transform: [{ scaleX: -1 }] }}` on the chevron | `scale-x-flip` (add it to `DIRECTIONAL_ICONS` instead) |
| `{task.dueInDays.toString()}` as a child | `number-to-text` (format it in the model hook) |
| `'\u200F' + title` (a hand-written right-to-left mark) | `bidi-in-source` (use the `direction` prop) |

## The test

The app's `test/test-app.tsx` takes `language` (and optionally the layout `direction`), as
testing-rtl.md shows; then the row renders right to left through the usual helper:

```tsx
// src/features/tasks/components/task-row.test.tsx
// allow-style-assertion: the writing direction of the person's text is this row's contract.
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { TaskRow } from './task-row';

describe('TaskRow', () => {
  it('keeps a Latin title left to right inside an Arabic screen', async () => {
    await renderWithProviders(
      <TaskRow
        title="Buy milk!"
        dueText="غدًا"
        onPress={jest.fn()}
        testID="tasks.task-row.1"
        isReducedMotion={false}
      />,
      { language: 'ar' },
    );

    expect(screen.getByText('Buy milk!', { exact: false })).toHaveStyle({
      writingDirection: 'ltr',
    });
  });

  it('writes an Arabic title right to left', async () => {
    await renderWithProviders(
      <TaskRow
        title="شراء الحليب"
        dueText="Tomorrow"
        onPress={jest.fn()}
        testID="tasks.task-row.2"
        isReducedMotion={false}
      />,
    );

    expect(screen.getByText('شراء الحليب', { exact: false })).toHaveStyle({
      writingDirection: 'rtl',
    });
  });
});
```

(`exact: false`: on Android AppText prefixes a direction mark to a text with an explicit
direction; the iOS project sees the bare string.)

## Check it

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-rtl.mjs .
npx jest src/features/tasks/components/task-row.test.tsx --ci
```

Then capture the task list in Arabic on an iOS simulator and an Android emulator (testing-rtl.md):
title on the right, due date and a left-pointing chevron on the left, a Latin title with its
punctuation at its own end.
