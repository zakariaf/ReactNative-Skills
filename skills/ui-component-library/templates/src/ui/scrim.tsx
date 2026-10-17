// src/ui/scrim.tsx
import { Modal, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const SCRIM = COMPONENT_SPECS.scrim;

export type ScrimProps = {
  /** `<dialog>.scrim`. */
  readonly testID: string;
  readonly isVisible: boolean;
  /**
   * Android's back button and predictive back gesture: close the dialog. iOS has no dismiss gesture
   * here: a transparent Modal presents over full screen, and swipe-to-dismiss is a sheet's.
   */
  readonly onRequestClose: () => void;
  /** No fade in under reduce motion. */
  readonly isReducedMotion: boolean;
  /** The DialogCard, centred on the dimmed screen. */
  readonly children?: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'center',
      paddingBlock: SCRIM.paddingBlock,
      paddingInline: SCRIM.paddingInline,
      backgroundColor: theme.colors.scrim,
    },
  });
  return styles;
});

/**
 * Dims the screen and centres a dialog on it, in React Native's Modal: VoiceOver and TalkBack stay
 * inside, Android's back closes it (onRequestClose), and under Android's edge-to-edge it also
 * covers the status and navigation bars. The scrim is the modal root: accessibilityViewIsModal sits
 * here and never on the card, which would hide the scrim's own testID from the tree E2E tools read.
 */
export function Scrim(props: ScrimProps): ReactNode {
  const styles = useStyles();
  return (
    <Modal
      visible={props.isVisible}
      transparent
      animationType={props.isReducedMotion ? 'none' : 'fade'}
      onRequestClose={props.onRequestClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.scrim} testID={props.testID} accessibilityViewIsModal>
        {props.children}
      </View>
    </Modal>
  );
}
