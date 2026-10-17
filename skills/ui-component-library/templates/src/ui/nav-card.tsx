// src/ui/nav-card.tsx
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { useTheme } from '@/theme/use-theme';

import { AppText } from './app-text';
import { Chevron } from './chevron';
import { COMPONENT_SPECS } from './component-specs';
import { IconTile } from './icon-tile';
import { PressableSurface } from './pressable-surface';

import type { IconSlot } from './icon-slot';
import type { IconTilePaint } from './icon-tile';
import type { ReactNode } from 'react';

const NAV = COMPONENT_SPECS.navCard;

export type NavCardProps = {
  /** Translated. */
  readonly label: string;
  readonly description?: string;
  readonly icon: IconSlot;
  readonly iconPaint?: IconTilePaint;
  readonly onPress: () => void;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  /** Translated sentence when the card must be heard as more than its label. */
  readonly a11yLabel?: string;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: {
      minHeight: NAV.minHeight,
      paddingBlock: NAV.paddingBlock,
      paddingInline: NAV.paddingInline,
      gap: NAV.gap,
      flexDirection: 'row',
      justifyContent: 'flex-start',
    },
    text: { flex: 1, gap: NAV.labelGap },
    block: { alignSelf: 'stretch' },
  });
  return styles;
});

/** A block button laid out as a row that opens another screen: tile, label, description, chevron. */
export function NavCard(props: NavCardProps): ReactNode {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <PressableSurface
      label={props.a11yLabel ?? props.label}
      onPress={props.onPress}
      testID={props.testID}
      radius={NAV.radius}
      fill={theme.colors.surface}
      isReducedMotion={props.isReducedMotion}
      faceStyle={styles.face}
      layoutStyle={styles.block}
    >
      <IconTile
        icon={props.icon}
        paint={props.iconPaint ?? 'primary'}
        testID={`${props.testID}.icon`}
      />
      <View style={styles.text}>
        <AppText variant="rowLabelStrong" testID={`${props.testID}.label`}>
          {props.label}
        </AppText>
        {props.description === undefined ? null : (
          <AppText variant="rowDescription" tone="muted" testID={`${props.testID}.description`}>
            {props.description}
          </AppText>
        )}
      </View>
      <Chevron color={theme.colors.textMuted} />
    </PressableSurface>
  );
}
