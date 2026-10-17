// src/ui/badge.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { STROKE } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { TextTone } from './app-text';
import type { IconSlot } from './icon-slot';
import type { Theme } from '@/theme/theme-types';
import type { ReactNode } from 'react';

const BADGE = COMPONENT_SPECS.badge;

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export type BadgeProps = {
  /** Translated, short ("New", "Overdue", "Premium"). */
  readonly text: string;
  readonly testID: string;
  /** Default 'neutral'. A status tone always comes with a word, never colour alone. */
  readonly tone?: BadgeTone;
  readonly icon?: IconSlot;
  /**
   * A decorative tilt in degrees, clamped to the specs' maximum. It keeps its angle in
   * right-to-left layouts: a tilt is a printed look, not a direction.
   */
  readonly tiltDeg?: number;
};

type BadgePaint = {
  readonly fill: string;
  readonly edge: string;
  readonly tone: TextTone;
  readonly ink: string;
};

function paintOf(theme: Theme, tone: BadgeTone): BadgePaint {
  const { colors } = theme;
  switch (tone) {
    case 'primary':
      return {
        fill: colors.primary,
        edge: colors.primary,
        tone: 'onPrimary',
        ink: colors.onPrimary,
      };
    case 'success':
      return { fill: colors.surface, edge: colors.success, tone: 'success', ink: colors.success };
    case 'warning':
      return { fill: colors.surface, edge: colors.warning, tone: 'warning', ink: colors.warning };
    case 'danger':
      return {
        fill: colors.dangerSurface,
        edge: colors.danger,
        tone: 'danger',
        ink: colors.danger,
      };
    case 'neutral':
      return { fill: colors.sunken, edge: colors.sunken, tone: 'default', ink: colors.text };
  }
}

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    // Hugs its text: alignSelf on itself, so a parent's alignItems does not centre it (wrap it in a
    // row with justifyContent instead).
    badge: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: BADGE.gap,
      paddingBlock: BADGE.paddingBlock,
      paddingInline: BADGE.paddingInline,
      borderRadius: BADGE.radius,
      borderWidth: STROKE.hair,
    },
  });
  return styles;
});

function clampTilt(deg: number): number {
  return Math.max(-BADGE.maxTilt, Math.min(BADGE.maxTilt, deg));
}

/**
 * A small status label. The badge box is one accessible text element with the testID, so an E2E
 * tool measures the whole badge, not only its words.
 */
export function Badge(props: BadgeProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const paint = paintOf(theme, props.tone ?? 'neutral');
  const tilt =
    props.tiltDeg === undefined
      ? null
      : { transform: [{ rotate: `${String(clampTilt(props.tiltDeg))}deg` }] };
  return (
    <View
      style={[styles.badge, { backgroundColor: paint.fill, borderColor: paint.edge }, tilt]}
      testID={props.testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={props.text}
    >
      {props.icon?.({ size: BADGE.icon, color: paint.ink }) ?? null}
      <AppText variant="badge" tone={paint.tone}>
        {props.text}
      </AppText>
    </View>
  );
}
