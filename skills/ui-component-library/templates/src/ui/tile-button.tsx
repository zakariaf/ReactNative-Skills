// src/ui/tile-button.tsx
import { StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const TILE = COMPONENT_SPECS.tileButton;

export type TileButtonProps = {
  /** Translated; up to two lines. */
  readonly label: string;
  readonly icon: IconSlot;
  readonly onPress: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  readonly isDisabled?: boolean;
  readonly hint?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      minHeight: TILE.minHeight,
      paddingBlock: TILE.paddingBlock,
      paddingInline: TILE.paddingInline,
      gap: TILE.gap,
    },
    // Grows into its cell of a row or grid, keeping its content height. Never flex: 1 here: in a
    // column cell that is a zero vertical basis, and the row measures 0 pt on a device.
    cell: { flexGrow: 1 },
  });
  return styles;
});

/** A square-ish key with an icon over a label, for a grid of quick actions. */
export function TileButton(props: TileButtonProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const isDisabled = props.isDisabled === true;
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onPress}
      testID={props.testID}
      radius={TILE.radius}
      fill={theme.colors.surface}
      isReducedMotion={props.isReducedMotion}
      isDisabled={isDisabled}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      faceStyle={styles.face}
      layoutStyle={styles.cell}
      isStretched
    >
      {props.icon({
        size: TILE.icon,
        color: isDisabled ? theme.colors.textMuted : theme.colors.text,
      })}
      <AppText
        variant="buttonLabel"
        tone={isDisabled ? 'muted' : 'default'}
        align="center"
        testID={`${props.testID}.label`}
      >
        {props.label}
      </AppText>
    </PressableSurface>
  );
}
