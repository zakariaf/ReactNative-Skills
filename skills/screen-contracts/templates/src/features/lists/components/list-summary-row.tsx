// src/features/lists/components/list-summary-row.tsx
// One list in the Lists screen: the list's name (data text, never translated) and its delete button,
// side by side as siblings. The row itself is not accessible: on iOS an accessible View hides every
// child from VoiceOver and from the tree E2E tools read, so a button nested in it could be neither
// found nor pressed. The row's testID sits on the box the design measures; the button's id extends
// it with a part (lists.list-row.<id>.delete-button), keyed by the list's id, never by its index.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { TaskList } from '@/data/tasks/task-repository';

export type ListSummaryRowProps = {
  readonly list: TaskList;
  /** Translated: "Delete", the button's visible text. */
  readonly deleteText: string;
  /** Translated: "Delete Groceries", its accessible name (VoiceOver and TalkBack read it). */
  readonly deleteLabel: string;
  readonly onDelete: (listId: number) => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.md,
      backgroundColor: theme.colors.surface,
      borderRadius: RADII.md,
      paddingBlock: SPACING.sm,
      paddingInlineStart: SPACING.lg,
      paddingInlineEnd: SPACING.sm,
    },
    name: { flexGrow: 1, flexShrink: 1 },
    face: { paddingBlock: SPACING.sm, paddingInline: SPACING.md, alignItems: 'center' },
  });
  return styles;
});

export function ListSummaryRow(props: ListSummaryRowProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  const { list } = props;
  const rowID = `lists.list-row.${String(list.id)}`;
  return (
    <View testID={rowID} style={styles.row}>
      <View style={styles.name}>
        <AppText>{list.name}</AppText>
      </View>
      <PressableSurface
        testID={`${rowID}.delete-button`}
        label={props.deleteLabel}
        onPress={() => {
          props.onDelete(list.id);
        }}
        radius={RADII.sm}
        fill={theme.colors.dangerSurface}
        isReducedMotion={props.isReducedMotion}
        accessibilityRole="button"
        faceStyle={styles.face}
      >
        <AppText tone="danger" variant="label">
          {props.deleteText}
        </AppText>
      </PressableSurface>
    </View>
  );
}
