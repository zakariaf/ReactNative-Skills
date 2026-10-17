// src/ui/feedback/notice-host.tsx
import { useEffect, useEffectEvent } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useStore } from 'zustand';

import { makeStyles } from '@/theme/make-styles';
import { shadow } from '@/theme/shadow-styles';
import { CONTENT_MAX_WIDTH, ELEVATION, RADII, SPACING, STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { useAnnounce } from '@/ui/a11y/use-announce';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import { AboveModalScreens } from './above-modal-screens';
import { noticeLifetimeMs } from './notice';
import { scheduleNoticeClose } from './notice-timer';

import type { Notice } from './notice';
import type { ReactNode } from 'react';

export type NoticeHostProps = {
  /** The dock's id (the host's, e.g. 'app.notice'); each notice and its parts take the notice's testID. */
  readonly testID: string;
  readonly notice: Notice | null;
  readonly onClose: (serial: number) => void;
  /** Translated "Dismiss": shown when the notice stays until dismissed. */
  readonly dismissLabel: string;
  /** The bottom safe-area inset; the notice floats above it. */
  readonly bottomInset: number;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    dock: { position: 'absolute', insetInline: SPACING.lg, alignItems: 'center' },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      gap: SPACING.md,
      paddingBlock: SPACING.sm,
      paddingInlineStart: SPACING.lg,
      paddingInlineEnd: SPACING.sm,
      borderRadius: RADII.md,
      borderWidth: STROKE.hair,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      ...shadow(ELEVATION.overlay, theme.colors.shadow, ELEVATION.overlay),
    },
    text: { flexShrink: 1, flexGrow: 1 },
    actionFace: { paddingBlock: SPACING.sm, paddingInline: SPACING.md },
  });
  return styles;
});

/**
 * The one notice on screen, docked above the bottom inset and above modal screens. TalkBack reads
 * it through the polite live region; iOS reads no live region, so it is announced there once per
 * notice. It closes after its lifetime (passed through the person's recommended timeout), or stays
 * with a Dismiss button while a screen reader runs and it holds an action.
 */
export function NoticeHost(props: NoticeHostProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const announce = useAnnounce();
  const isScreenReaderOn = useStore(systemA11yStore, (state) => state.isScreenReaderOn);
  const { notice, onClose } = props;
  const lifetimeMs = notice === null ? null : noticeLifetimeMs(notice, isScreenReaderOn);
  const onShown = useEffectEvent((shown: Notice) => {
    if (Platform.OS === 'ios') announce(shown.text);
  });
  useEffect(() => {
    if (notice !== null) onShown(notice);
  }, [notice]);
  // The timer follows the notice and its lifetime only: a new onClose identity never restarts it.
  const onExpired = useEffectEvent((serial: number) => {
    onClose(serial);
  });
  useEffect(() => {
    if (notice === null || lifetimeMs === null) return undefined;
    return scheduleNoticeClose(lifetimeMs, () => {
      onExpired(notice.serial);
    });
  }, [notice, lifetimeMs]);
  if (notice === null) return null;
  const button = (label: string, testID: string, onPress: () => void): ReactNode => (
    <PressableSurface
      label={label}
      onPress={onPress}
      testID={testID}
      radius={RADII.sm}
      fill={theme.colors.surface}
      isReducedMotion={props.isReducedMotion}
      faceStyle={styles.actionFace}
    >
      <AppText variant="buttonLabel">{label}</AppText>
    </PressableSurface>
  );
  const close = (): void => {
    onClose(notice.serial);
  };
  // Keyed by notice: each notice mounts a new overlay, which adds itself on top of the window, so a
  // replacement shows above a modal screen presented since the previous notice appeared.
  return (
    <AboveModalScreens key={notice.serial}>
      <View
        testID={props.testID}
        style={[styles.dock, { bottom: props.bottomInset + SPACING.lg }]}
        pointerEvents="box-none"
      >
        <View testID={notice.testID} style={styles.notice}>
          {/* The text alone is the alert: an accessible container would hide its buttons. */}
          <View
            style={styles.text}
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <AppText variant="toast" testID={`${notice.testID}.text`}>
              {notice.text}
            </AppText>
          </View>
          {notice.action === undefined
            ? null
            : button(notice.action.label, `${notice.testID}.action`, () => {
                notice.action?.onPress();
                close();
              })}
          {lifetimeMs === null
            ? button(props.dismissLabel, `${notice.testID}.dismiss`, close)
            : null}
        </View>
      </View>
    </AboveModalScreens>
  );
}
