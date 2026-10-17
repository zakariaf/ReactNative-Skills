// src/ui/empty-state.tsx
import { StyleSheet, View } from 'react-native';

import { AppText } from './app-text';
import { COMPONENT_SPECS } from './component-specs';

import type { ReactNode } from 'react';

const EMPTY = COMPONENT_SPECS.emptyState;

export type EmptyStateProps = {
  /** The state's id (`tasks.empty-state`): parts `.picture`, `.title`, `.body`. */
  readonly testID: string;
  /** Translated ("No tasks yet"). */
  readonly title: string;
  /** Translated: what to do next ("Add your first task to get started."). */
  readonly body?: string;
  /** A decorative picture (a large IconTile); hidden from screen readers. */
  readonly picture?: ReactNode;
  /** The one action that fills the state (a Button). */
  readonly action?: ReactNode;
};

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: EMPTY.gap, paddingBlock: EMPTY.paddingBlock },
});

/** What a screen shows when it has nothing to show yet: a picture, a title, a hint and an action. */
export function EmptyState({ testID, title, body, picture, action }: EmptyStateProps): ReactNode {
  return (
    <View style={styles.state} testID={testID}>
      {picture === undefined ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`${testID}.picture`}
        >
          {picture}
        </View>
      )}
      <AppText variant="heading" align="center" isHeader testID={`${testID}.title`}>
        {title}
      </AppText>
      {body === undefined ? null : (
        <AppText tone="muted" align="center" testID={`${testID}.body`}>
          {body}
        </AppText>
      )}
      {action}
    </View>
  );
}
