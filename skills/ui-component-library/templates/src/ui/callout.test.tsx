// src/ui/callout.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { Callout } from './callout';
import { COMPONENT_SPECS } from './component-specs';

import type { IconLook } from './icon-slot';
import type { ReactNode } from 'react';

describe('Callout', () => {
  it('shows a note with its icon and label parts, the icon at the top', async () => {
    await renderWithProviders(
      <Callout
        icon={() => null}
        text="Reminders are off for this list."
        testID="list.reminders-note"
      />,
    );

    expect(screen.getByTestId('list.reminders-note.label')).toHaveTextContent(
      'Reminders are off for this list.',
    );
    expect(screen.getByTestId('list.reminders-note.icon')).toHaveStyle({
      alignSelf: 'flex-start',
      marginTop: COMPONENT_SPECS.callout.iconNudge,
    });
  });

  it('paints an error note and its icon danger', async () => {
    const icon = jest.fn((_look: IconLook): ReactNode => null);
    await renderWithProviders(
      <Callout icon={icon} text="Could not save." isError testID="task-edit.error-note" />,
    );

    expect(screen.getByTestId('task-edit.error-note')).toHaveStyle({
      borderColor: PALETTE.light.danger,
    });
    expect(icon).toHaveBeenCalledWith({
      size: COMPONENT_SPECS.callout.icon,
      color: PALETTE.light.danger,
    });
  });
});
