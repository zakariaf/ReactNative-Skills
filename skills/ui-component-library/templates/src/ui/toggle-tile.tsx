// src/ui/toggle-tile.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { CheckMark } from './check-mark';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const TILE = COMPONENT_SPECS.toggleTile;

export type ToggleTileProps = {
  /** Translated ("Sounds"). */
  readonly label: string;
  /** Translated state word ("On" or "Off"): the state is written, not only coloured. */
  readonly stateText: string;
  readonly isOn: boolean;
  readonly icon: IconSlot;
  /** The handler plays the switch's own feedback; the surface plays no tap for a switch. */
  readonly onToggle: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      minHeight: TILE.minHeight,
      paddingBlock: TILE.paddingBlock,
      paddingInline: TILE.paddingInline,
      gap: TILE.gap,
    },
    state: { flexDirection: 'row', alignItems: 'center', gap: TILE.stateGap },
    // Grows into its cell (never flex: 1, a zero vertical basis in a column cell).
    cell: { flexGrow: 1 },
  });
  return styles;
});

/** A tile that switches one setting on and off: icon, label and a written state. */
export function ToggleTile(props: ToggleTileProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const ink = props.isOn ? theme.colors.onPrimary : theme.colors.text;
  const tone = props.isOn ? 'onPrimary' : 'default';
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onToggle}
      testID={props.testID}
      accessibilityRole="switch"
      isChecked={props.isOn}
      radius={TILE.radius}
      fill={props.isOn ? theme.colors.primary : theme.colors.surface}
      edgeColor={props.isOn ? theme.colors.primary : theme.colors.border}
      isReducedMotion={props.isReducedMotion}
      faceStyle={styles.face}
      layoutStyle={styles.cell}
      isStretched
    >
      {props.icon({ size: TILE.icon, color: ink })}
      <AppText variant="buttonLabel" tone={tone} align="center" testID={`${props.testID}.label`}>
        {props.label}
      </AppText>
      <View style={styles.state} testID={`${props.testID}.state`}>
        {props.isOn ? <CheckMark color={ink} testID={`${props.testID}.check`} /> : null}
        <AppText variant="statLabel" tone={tone}>
          {props.stateText}
        </AppText>
      </View>
    </PressableSurface>
  );
}
