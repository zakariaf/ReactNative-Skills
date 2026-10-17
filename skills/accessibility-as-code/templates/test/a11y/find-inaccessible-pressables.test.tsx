// test/a11y/find-inaccessible-pressables.test.tsx
import { render, screen } from '@testing-library/react-native';
import { createElement } from 'react';
import { Pressable, Text, TouchableWithoutFeedback, View } from 'react-native';

import { findInaccessiblePressables } from './find-inaccessible-pressables';

type HostPressableProps = {
  readonly onPress: () => void;
  readonly testID: string;
  readonly accessibilityLabel: string;
};

describe('findInaccessiblePressables', () => {
  it('reports a pressable host element without a role', async () => {
    // A bare host element stands in for a hand-made pressable that forgot its role.
    await render(
      createElement<HostPressableProps>('RCTView', {
        onPress: jest.fn(),
        testID: 'tasks.add-button',
        accessibilityLabel: 'Add task',
      }),
    );
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([
      'tasks.add-button: no role',
    ]);
  });

  it('reports an icon-only pressable without a label', async () => {
    await render(
      <Pressable accessibilityRole="button" onPress={jest.fn()} testID="tasks.filter-button">
        <View />
      </Pressable>,
    );
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([
      'tasks.filter-button: no accessible name',
    ]);
  });

  it('skips pressables hidden from screen readers (a backdrop, a keyboard-dismiss area)', async () => {
    await render(
      <View>
        <Pressable
          accessibilityRole="none"
          accessible={false}
          onPress={jest.fn()}
          testID="tasks.filter-sheet.backdrop-button"
        />
        <Pressable
          accessibilityRole="none"
          aria-hidden
          onPress={jest.fn()}
          testID="task-actions-menu.backdrop-button"
        />
        <TouchableWithoutFeedback onPress={jest.fn()} accessible={false}>
          <View testID="tasks.form.dismiss-area" />
        </TouchableWithoutFeedback>
      </View>,
    );
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('accepts pressables named by a label, aria-label or their own text', async () => {
    await render(
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add task"
          onPress={jest.fn()}
          testID="tasks.add-button"
        />
        <Pressable
          role="button"
          aria-label="Sort tasks"
          onPress={jest.fn()}
          testID="tasks.sort-button"
        />
        <Pressable accessibilityRole="button" onPress={jest.fn()} testID="tasks.clear-done-button">
          <Text>Clear done tasks</Text>
        </Pressable>
      </View>,
    );
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
