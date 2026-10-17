// src/ui/card.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';

import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

const CARD = COMPONENT_SPECS.card;

export type CardTone = 'default' | 'muted' | 'danger';

export type CardProps = {
  readonly testID: string;
  readonly children: ReactNode;
  /** 'muted' sits on the sunken fill; 'danger' tints an error. Default 'default'. */
  readonly tone?: CardTone;
  /** 'compact' for dense summary cards. Default 'regular'. */
  readonly padding?: 'regular' | 'compact';
  /** Lay the children out in a row (an icon beside text). */
  readonly isRow?: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      gap: CARD.gap,
      padding: CARD.padding,
      borderRadius: CARD.radius,
      borderWidth: CARD.border,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    compact: { padding: CARD.paddingCompact },
    row: { flexDirection: 'row', alignItems: 'flex-start' },
    muted: { backgroundColor: theme.colors.sunken },
    danger: { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSurface },
  });
  return styles;
});

type Styles = ReturnType<typeof useStyles>;

function toneStyle(tone: CardTone, styles: Styles): StyleProp<ViewStyle> {
  if (tone === 'muted') return styles.muted;
  return tone === 'danger' ? styles.danger : null;
}

/**
 * A flat surface that groups related content. Flat on purpose: a raised look promises a press, so a
 * card that does something holds a button (or is an ActionCard), and never casts a shadow itself.
 */
export function Card(props: CardProps): ReactNode {
  const styles = useStyles();
  return (
    <View
      style={[
        styles.card,
        props.padding === 'compact' && styles.compact,
        props.isRow === true && styles.row,
        toneStyle(props.tone ?? 'default', styles),
      ]}
      testID={props.testID}
    >
      {props.children}
    </View>
  );
}
