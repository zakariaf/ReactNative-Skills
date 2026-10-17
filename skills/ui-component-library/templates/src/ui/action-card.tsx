// src/ui/action-card.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { ReactNode } from 'react';

const CARD = COMPONENT_SPECS.actionCard;

export type ActionCardProps = {
  /** Translated: the card's visible texts as one sentence (the model builds it with t()). */
  readonly openLabel: string;
  readonly onOpen: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** The visible texts: hidden from screen readers (the opener says them) and passing touches. */
  readonly children: ReactNode;
  /** The card's own action (a Checkbox, an IconButton): a sibling of the opener, drawn above it. */
  readonly action?: ReactNode;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      minHeight: CARD.minHeight,
      paddingBlock: CARD.paddingBlock,
      paddingInline: CARD.paddingInline,
      gap: CARD.gap,
      flexDirection: 'row',
      alignItems: 'center',
    },
    // The opener fills the card under everything else and paints the card's face.
    opener: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 },
    openerFace: { flexGrow: 1 },
    // Drawn above the opener, so it must let touches through to it (a tap on the title opens).
    texts: { flex: 1, pointerEvents: 'none' },
  });
  return styles;
});

/**
 * A card that opens something and holds its own action. The opener and the action are siblings,
 * never nested (a screen reader reaches only the outer one of two nested pressables), and the text
 * layer passes touches through; keeping all three in this one component means no screen can forget.
 */
export function ActionCard(props: ActionCardProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.card}>
      <PressableSurface
        label={props.openLabel}
        onPress={props.onOpen}
        testID={props.testID}
        radius={CARD.radius}
        fill={theme.colors.surface}
        edgeColor={theme.colors.separator}
        edgeWidth={STROKE.hair}
        isReducedMotion={props.isReducedMotion}
        faceStyle={styles.openerFace}
        layoutStyle={styles.opener}
        isStretched
      >
        {null}
      </PressableSurface>
      <View style={styles.texts} aria-hidden>
        {props.children}
      </View>
      {props.action}
    </View>
  );
}
