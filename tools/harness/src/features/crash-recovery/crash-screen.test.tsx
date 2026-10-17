// src/features/crash-recovery/crash-screen.test.tsx
// no-providers: CrashScreen is a pure view of its props, and under the root layout it renders outside
// every provider, so it is tested exactly there (AppText falls back to the theme context's default).
import { render, screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';

import { CrashScreen } from './crash-screen';

const BACKGROUND = '#fafafa';

describe('CrashScreen', () => {
  it('shows the translated copy and one button that calls the way out', async () => {
    const user = userEvent.setup();
    const onAction = jest.fn();
    await render(
      <CrashScreen
        title="Something went wrong"
        body="Your tasks are safe."
        actionLabel="Restart"
        onAction={onAction}
        backgroundColor={BACKGROUND}
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('Your tasks are safe.')).toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.press(screen.getByRole('button', { name: 'Restart' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('calls nothing on its own without a press', async () => {
    jest.useFakeTimers();
    const onAction = jest.fn();
    await render(
      <CrashScreen
        title="t"
        body="b"
        actionLabel="Restart"
        onAction={onAction}
        backgroundColor={BACKGROUND}
      />,
    );

    jest.advanceTimersByTime(60_000);

    expect(onAction).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('gives its one way out a role and an accessible name', async () => {
    await render(
      <CrashScreen
        title="Something went wrong"
        body="Your tasks are safe."
        actionLabel="Restart"
        onAction={jest.fn()}
        backgroundColor={BACKGROUND}
      />,
    );

    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
