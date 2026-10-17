// src/ui/toast.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Toast } from './toast';

describe('Toast', () => {
  it('is an alert with a polite live region', async () => {
    await renderWithProviders(
      <Toast text="Task deleted" testID="tasks.deleted-toast" isReducedMotion />,
    );

    const toast = screen.getByRole('alert');
    expect(toast).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(screen.getByText('Task deleted')).toBeOnTheScreen();
  });

  it('shows the busy blocks while work is in progress', async () => {
    await renderWithProviders(
      <Toast
        text="Restoring..."
        icon="busy"
        testID="settings.restoring-toast"
        isReducedMotion={false}
      />,
    );

    expect(screen.getByRole('alert')).toHaveProp('testID', 'settings.restoring-toast');
  });
});
