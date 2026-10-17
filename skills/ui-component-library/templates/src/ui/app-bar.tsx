// src/ui/app-bar.tsx
import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';
import { IconButton } from './icon-button';

import type { IconSlot } from './icon-slot';
import type { ReactNode } from 'react';

const BAR = COMPONENT_SPECS.appBar;

export type AppBarBack = {
  /** Translated ("Back"). */
  readonly label: string;
  readonly onPress: () => void;
  /** The app's back icon; its icon set flips it in right-to-left layouts. */
  readonly icon: IconSlot;
};

export type AppBarProps = {
  /** Translated screen title. */
  readonly title: string;
  readonly testID: string;
  readonly isReducedMotion: boolean;
  readonly back?: AppBarBack;
  /** One action at the end (an IconButton). */
  readonly end?: ReactNode;
};

const styles = StyleSheet.create({
  bar: {
    minHeight: BAR.minHeight,
    paddingInline: BAR.paddingInline,
    gap: BAR.gap,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { flex: 1 },
});

/**
 * A custom top bar for a screen that hides the navigator's header: back button, title (a header),
 * one end action. Prefer the native header of the router's stack; the screen frame keeps the safe
 * area above this bar.
 */
export function AppBar({ title, testID, isReducedMotion, back, end }: AppBarProps): ReactNode {
  return (
    <View style={styles.bar} testID={testID}>
      {back === undefined ? null : (
        <IconButton
          label={back.label}
          icon={back.icon}
          onPress={back.onPress}
          testID={`${testID}.back-button`}
          isReducedMotion={isReducedMotion}
        />
      )}
      <View style={styles.title}>
        <AppText variant="heading" isHeader testID={`${testID}.title`}>
          {title}
        </AppText>
      </View>
      {end}
    </View>
  );
}
