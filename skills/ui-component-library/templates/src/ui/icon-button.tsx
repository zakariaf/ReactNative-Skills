// src/ui/icon-button.tsx
import { StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { COMPONENT_SPECS } from './component-specs';
import { PressableSurface } from './pressable-surface';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const ICON_BUTTON = COMPONENT_SPECS.iconButton;

export type IconButtonProps = {
  /** Translated and required: an icon has no text for a screen reader to read. */
  readonly label: string;
  readonly icon: IconSlot;
  readonly onPress: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** 'small' is the 44 pt minimum (dense toolbars); never smaller. Default 'regular'. */
  readonly size?: 'regular' | 'small';
  readonly isDisabled?: boolean;
  readonly hint?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    regular: { width: ICON_BUTTON.size, height: ICON_BUTTON.size },
    small: { width: ICON_BUTTON.sizeSmall, height: ICON_BUTTON.sizeSmall },
    inline: { alignSelf: 'flex-start' },
  });
  return styles;
});

/** A square button with one icon and a required accessible name (Back, Settings, Add). */
export function IconButton(props: IconButtonProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  const isDisabled = props.isDisabled === true;
  return (
    <PressableSurface
      label={props.label}
      onPress={props.onPress}
      testID={props.testID}
      radius={ICON_BUTTON.radius}
      fill={theme.colors.surface}
      isReducedMotion={props.isReducedMotion}
      isDisabled={isDisabled}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      faceStyle={props.size === 'small' ? styles.small : styles.regular}
      layoutStyle={styles.inline}
    >
      {props.icon({
        size: ICON_BUTTON.icon,
        color: isDisabled ? theme.colors.textMuted : theme.colors.text,
      })}
    </PressableSurface>
  );
}
