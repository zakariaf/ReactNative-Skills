// src/ui/badge.test.tsx
import { screen } from '@testing-library/react-native';

import { PALETTE } from '@/theme/palette';
import { renderWithProviders } from '@test/render-with-providers';

import { Badge } from './badge';
import { COMPONENT_SPECS } from './component-specs';

describe('Badge', () => {
  it('is one text element that carries the testID on its measured box', async () => {
    await renderWithProviders(
      <Badge text="Overdue" tone="danger" testID="tasks.task-row.t1.overdue-badge" />,
    );

    const badge = screen.getByTestId('tasks.task-row.t1.overdue-badge');
    expect(badge).toHaveProp('accessible', true);
    expect(badge).toHaveProp('accessibilityRole', 'text');
    expect(badge).toHaveAccessibleName('Overdue');
    expect(badge).toHaveStyle({
      backgroundColor: PALETTE.light.dangerSurface,
      alignSelf: 'flex-start',
    });
  });

  it('clamps a decorative tilt to the largest angle the specs allow', async () => {
    await renderWithProviders(<Badge text="New" tiltDeg={30} testID="tasks.new-badge" />);

    expect(screen.getByTestId('tasks.new-badge')).toHaveStyle({
      transform: [{ rotate: `${String(COMPONENT_SPECS.badge.maxTilt)}deg` }],
    });
  });
});
