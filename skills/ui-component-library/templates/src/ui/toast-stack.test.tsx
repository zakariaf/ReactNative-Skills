// src/ui/toast-stack.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Toast } from './toast';
import { ToastStack } from './toast-stack';

describe('ToastStack', () => {
  it('stacks the toasts that are on screen together', async () => {
    await renderWithProviders(
      <ToastStack testID="settings.toasts">
        <Toast text="Restoring..." icon="busy" testID="settings.restoring-toast" isReducedMotion />
        <Toast text="Purchases restored" testID="settings.restored-toast" isReducedMotion />
      </ToastStack>,
    );

    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
