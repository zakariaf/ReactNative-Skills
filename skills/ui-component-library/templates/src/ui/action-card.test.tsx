// src/ui/action-card.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { ActionCard } from './action-card';
import { AppText } from './app-text';
import { Checkbox } from './checkbox';

describe('ActionCard', () => {
  it('keeps the opener and the action as two sibling targets', async () => {
    const onOpen = jest.fn();
    const onToggle = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <ActionCard
        openLabel="Buy milk, due tomorrow"
        onOpen={onOpen}
        testID="tasks.task-row.t1"
        isReducedMotion
        action={
          <Checkbox
            label="Complete Buy milk"
            isChecked={false}
            onToggle={onToggle}
            testID="tasks.task-row.t1.complete-checkbox"
            isReducedMotion
          />
        }
      >
        <AppText>Buy milk</AppText>
      </ActionCard>,
    );

    await user.press(screen.getByRole('button', { name: 'Buy milk, due tomorrow' }));
    await user.press(screen.getByRole('checkbox', { name: 'Complete Buy milk' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('hides the visible texts from screen readers, since the opener says them', async () => {
    await renderWithProviders(
      <ActionCard
        openLabel="Call mum, today"
        onOpen={jest.fn()}
        testID="tasks.task-row.t2"
        isReducedMotion
      >
        <AppText>Call mum</AppText>
      </ActionCard>,
    );

    expect(screen.queryByText('Call mum')).not.toBeOnTheScreen();
    expect(screen.getByText('Call mum', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});
