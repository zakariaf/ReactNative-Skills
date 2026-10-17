// src/features/task-editor/task-editor-screen.tsx
// The New task screen, a pure view of its model (forms-and-input). The fields scroll in
// KeyboardAwareScrollView, so the focused field stays above the keyboard on iOS and on Android's
// edge-to-edge window (where the window no longer shrinks for the keyboard), and
// keyboardShouldPersistTaps="handled" lets the first tap on Save press it instead of only closing
// the keyboard. The estimate's number pad has no return key on iOS: KeyboardDoneBar closes it.
// The bar rides on top of the keyboard, so the scroll view keeps the focused field above the bar
// (bottomOffset and extraKeyboardSpace from the bar's measured height), not just above the keyboard.
import { StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { KeyboardDoneBar } from '@/ui/form/keyboard-done-bar';
import { TextField } from '@/ui/form/text-field';
import { PressableSurface } from '@/ui/pressable-surface';

import type { TaskEditorModel } from './use-task-editor-model';

export type TaskEditorScreenProps = TaskEditorModel;

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.lg,
      paddingBlock: SPACING.lg,
      paddingInline: SPACING.lg,
    },
    submit: { alignItems: 'center', justifyContent: 'center' },
  });
  return styles;
});

export function TaskEditorScreen(props: TaskEditorScreenProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView
        testID="task-editor.form"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        bottomOffset={props.keyboardSpace.bottomOffset}
        extraKeyboardSpace={props.keyboardSpace.extraKeyboardSpace}
      >
        <TextField testID="task-editor.title" {...props.title} />
        <TextField testID="task-editor.notes" {...props.notes} />
        <TextField testID="task-editor.estimate" {...props.estimate} />
        {props.failure === null ? null : (
          <View accessibilityLiveRegion="polite">
            <AppText testID="task-editor.failure" tone="danger">
              {props.failure}
            </AppText>
          </View>
        )}
        <PressableSurface
          label={props.submitLabel}
          onPress={props.onSubmit}
          testID="task-editor.submit-button"
          radius={RADII.md}
          fill={theme.colors.primary}
          isReducedMotion={props.isReducedMotion}
          isBusy={props.isSubmitting}
          faceStyle={styles.submit}
        >
          <AppText variant="label" tone="onPrimary">
            {props.submitLabel}
          </AppText>
        </PressableSurface>
      </KeyboardAwareScrollView>
      <KeyboardDoneBar
        testID="task-editor.keyboard"
        label={props.doneLabel}
        isReducedMotion={props.isReducedMotion}
        onHeightChange={props.keyboardSpace.onBarHeightChange}
      />
    </View>
  );
}
