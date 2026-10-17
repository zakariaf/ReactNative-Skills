# Worked example: an accessible task row

A Tasks app lists tasks as rows. Tapping a row's body opens the task; its checkbox completes it.
VoiceOver and TalkBack must hear "Buy milk, due tomorrow, 2 of 3 subtasks done, button" for the
body and "Complete Buy milk, checkbox, not checked" for the checkbox; a done task also shows a
check mark and a strike-through (never colour alone), and the row stays readable at 200 % text.
This is a shape to imitate, not a file to copy: the shared card belongs to the app's UI layer
(ui-component-library), the strings to its catalogs (i18n-strings-and-catalogs).

Two files, because of two lint rules in the canonical ESLint config (typescript-and-lint-rules):
only `src/ui/` may import `Pressable` ("Use the buttons and rows in src/ui"), and `src/ui/` may not
import from `@/features/*`. So the opener lives in a generic `src/ui/action-card.tsx` that takes
strings and nodes, never a `TaskView`, and the feature's `TaskRow` composes it.

## Catalog entries (English shown; every shipped locale has them)

```json
{
  "tasks.task-row.a11y-label": "{taskName}, {dueText}, {done, number} of {total, plural, one {# subtask} other {# subtasks}} done",
  "tasks.task-row.no-subtasks.a11y-label": "{taskName}, {dueText}",
  "tasks.task-row.complete-checkbox.a11y-label": "Complete {taskName}",
  "tasks.task-row.complete-checkbox.a11y-hint": "Marks the task as not done."
}
```

The name is one sentence with typed numbers and a plural, so every locale gets its own grammar and
digits; free-text placeholders end in `Name` or `Text` (`{taskName}`, `{dueText}`), as
naming-conventions requires. Never glue it (`` `${task.title}, ${task.dueText}` ``):
`check-a11y-code` rejects template-built labels (`literal-a11y-text`).

## Where the names are built: the model hook, with t()

```ts
// src/features/tasks/use-tasks-model.ts (excerpt)
function rowLabels(t: Translate, task: TaskView): TaskRowLabels {
  const open =
    task.subtasks.total === 0
      ? t('tasks.task-row.no-subtasks.a11y-label', { taskName: task.title, dueText: task.dueText })
      : t('tasks.task-row.a11y-label', {
          taskName: task.title,
          dueText: task.dueText,
          done: task.subtasks.done,
          total: task.subtasks.total,
        });
  return {
    open,
    complete: t('tasks.task-row.complete-checkbox.a11y-label', { taskName: task.title }),
    ...(task.isDone ? { completeHint: t('tasks.task-row.complete-checkbox.a11y-hint') } : {}),
  };
}
```

## The shared card: the opener, the text layer and the action slot in one component

```tsx
// src/ui/action-card.tsx (shape)
export type ActionCardProps = {
  /** Translated: the card's visible texts joined in reading order (the model hook builds it). */
  readonly openLabel: string;
  readonly onOpen: () => void;
  readonly testID: string;
  /** The visible texts: hidden from screen readers (the opener says them), passing touches. */
  readonly children: ReactNode;
  /** The card's own action (a Checkbox, a Button): a sibling of the opener, drawn above it. */
  readonly action: ReactNode;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingInline: SPACING.lg,
      gap: SPACING.md,
    },
    opener: { position: 'absolute', inset: 0 },
    texts: { flex: 1, pointerEvents: 'none' },
  });
  return styles;
});

export function ActionCard({
  openLabel,
  onOpen,
  testID,
  children,
  action,
}: ActionCardProps): ReactNode {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.opener}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        onPress={onOpen}
        testID={testID}
      />
      <View style={styles.texts} aria-hidden>
        {children}
      </View>
      {action}
    </View>
  );
}
```

The card's styles carry the touch order. The opener fills the card under everything else, and the
text layer is drawn above it, so it must pass touches through, or tapping the title does nothing on
a device (the touch goes to the topmost view under the finger and never reaches a sibling). Keep the
opener and the text layer it sits under in this one component. Split them (a shared `CardOpener` in
`src/ui/` with the text layer left in each feature) and every screen has to remember
`pointerEvents: 'none'`; the first one that forgets brings the dead taps back (`check-a11y-code`
follows a shared opener and reports that layer as `opener-covered`).

## The row: the feature composes the card

```tsx
// src/features/tasks/components/task-row.tsx (shape)
export function TaskRow({ task, labels, onOpen, onToggle }: TaskRowProps): ReactNode {
  const styles = useStyles();
  return (
    <ActionCard
      openLabel={labels.open}
      onOpen={onOpen}
      testID={`tasks.task-row.${task.id}`}
      action={
        <Checkbox
          label={labels.complete}
          {...(labels.completeHint === undefined ? {} : { hint: labels.completeHint })}
          isChecked={task.isDone}
          onToggle={onToggle}
          testID={`tasks.task-row.${task.id}.complete-checkbox`}
        />
      }
    >
      <View>
        <AppText variant="body">{task.title}</AppText>
        {task.isDone ? <View style={styles.strike} /> : null}
      </View>
      <AppText variant="caption" tone="muted">
        {task.dueText}
      </AppText>
    </ActionCard>
  );
}
```

`Checkbox` (in `src/ui/`) is a 44 × 44 pt pressable with `accessibilityRole="checkbox"`,
`accessibilityState={{ checked }}`, its `label` as `accessibilityLabel`, and a check glyph that
appears when checked. `AppText` (design-system-structure) takes its translated string as
`children` and has no strike-through prop, so the row draws its own: `styles.strike` is a
hairline `View` across the title (`position: 'absolute'`, `insetInline: 0`, `top: '50%'`,
`height: StyleSheet.hairlineWidth`, `backgroundColor: theme.colors.textMuted`), inside the card's
hidden text layer and shown only for a done task.

| Choice | Why |
|---|---|
| Opener and checkbox as siblings, the texts hidden | a nested checkbox is unreachable; the texts are already in the opener's label |
| `pointerEvents: 'none'` on the texts, in the same `src/ui/` component as the opener | they are drawn above the opener; without it taps on the title never reach it (`check-a11y-code`: `opener-covered`), and no feature can leave it out |
| `ActionCard` takes strings and nodes, the row passes them | only `src/ui/` may import `Pressable`, and `src/ui/` may not import the feature's `TaskView` |
| One label per element from `t()` with plurals | correct grammar and digits in every locale |
| Hint only on a completed task, naming the result | the outcome of tapping an open task's checkbox is obvious; on a done task the name still says "Complete", so the hint says what happens ("Marks the task as not done."), never the gesture the screen reader already announces |
| Check glyph and strike-through on done tasks | the state is visible without colour |
| `styles.row` uses `minHeight`, the texts wrap | at 200 % the row grows instead of clipping |
| Completing announces "Buy milk completed" once | `useAnnounce()` in the model hook, only while a screen reader runs |

## The test

```tsx
// src/features/tasks/tasks-screen.test.tsx (excerpt)
it('reads each task as an opener and a checkbox, and completes it', async () => {
  const user = userEvent.setup();
  const { stores } = await renderWithProviders(<TasksRoute />, { tasks: [BUY_MILK] });

  const complete = screen.getByRole('checkbox', { name: 'Complete Buy milk' });
  expect(complete).not.toBeChecked();
  await user.press(complete);

  expect(stores.tasks.getState().byId['task-2']?.isDone).toBe(true);
  expect(screen.getByRole('checkbox', { name: 'Complete Buy milk' })).toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Buy milk, due tomorrow, 2 of 3 subtasks done' }),
  ).toBeOnTheScreen();
  expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
});
```

The RNTL test presses the opener directly, so it cannot see a text layer that swallows the touch.
The large-text Maestro flow (testing reference) taps the card by its opener's testID: Maestro taps
the centre of the opener's bounds on the real screen, where the text layer sits, so it catches it.
A text query is the wrong tool: the title sits in the hidden layer, which iOS leaves out of the
hierarchy Maestro searches.

Then run the checks from the repo root:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-a11y-code.mjs .
node ${CLAUDE_SKILL_DIR}/scripts/check-contrast.mjs .
```
