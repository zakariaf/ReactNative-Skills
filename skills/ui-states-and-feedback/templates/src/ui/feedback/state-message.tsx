// src/ui/feedback/state-message.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { ReactNode } from 'react';

/** The one next step a state offers: retry, add the first item, clear the filter. */
export type StateAction = {
  /** Translated verb: "Try again", "Add a task", "Show all tasks". */
  readonly label: string;
  readonly onPress: () => void;
};

export type StateMessageProps = {
  /** '<screen>.state.<state>'; the parts derive from it (.title, .body, .action). */
  readonly testID: string;
  /** Translated; read as a header. */
  readonly title: string;
  /** Translated: what happened and what the person can do. */
  readonly body: string;
  /** Required for failed, empty and filtered-empty states; an offline state resumes by itself. */
  readonly action?: StateAction;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    frame: {
      flexGrow: 1,
      justifyContent: 'center',
      alignSelf: 'center',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      gap: SPACING.md,
      paddingBlock: SPACING.xxl,
      paddingInline: SPACING.xl,
    },
    actionFace: { paddingBlock: SPACING.md, paddingInline: SPACING.xl, alignItems: 'center' },
  });
  return styles;
});

/** What an empty, filtered-empty, failed or offline screen shows in place of its content. */
export function StateMessage(props: StateMessageProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View testID={props.testID} style={styles.frame}>
      <AppText testID={`${props.testID}.title`} variant="title" align="center" isHeader>
        {props.title}
      </AppText>
      <AppText testID={`${props.testID}.body`} tone="muted" align="center">
        {props.body}
      </AppText>
      {props.action === undefined ? null : (
        <PressableSurface
          label={props.action.label}
          onPress={props.action.onPress}
          testID={`${props.testID}.action`}
          radius={RADII.md}
          fill={theme.colors.primary}
          isReducedMotion={props.isReducedMotion}
          faceStyle={styles.actionFace}
        >
          <AppText variant="buttonLabel" tone="onPrimary">
            {props.action.label}
          </AppText>
        </PressableSurface>
      )}
    </View>
  );
}
