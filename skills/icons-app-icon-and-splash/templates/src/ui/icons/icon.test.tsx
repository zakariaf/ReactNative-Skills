// src/ui/icons/icon.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { Icon } from './icon';
import { DIRECTIONAL_ICONS, ICON_PATHS } from './icon-paths';

describe('Icon', () => {
  it('mirrors an icon that points along the reading direction in right-to-left layouts', async () => {
    await renderWithProviders(<Icon name="back" color="#15171C" testID="test.icon" />, {
      direction: 'rtl',
    });

    expect(screen.getByTestId('test.icon', { includeHiddenElements: true })).toHaveStyle({
      transform: [{ scaleX: -1 }],
    });
  });

  it('keeps a check unmirrored in right-to-left layouts, at the size asked for', async () => {
    await renderWithProviders(<Icon name="check" color="#15171C" size={20} testID="test.icon" />, {
      direction: 'rtl',
    });

    const icon = screen.getByTestId('test.icon', { includeHiddenElements: true });
    expect(icon).not.toHaveStyle({ transform: [{ scaleX: -1 }] });
    expect(icon).toHaveStyle({ width: 20, height: 20 });
  });

  it('is hidden from VoiceOver and TalkBack: the control around it carries the label', async () => {
    await renderWithProviders(<Icon name="plus" color="#15171C" testID="test.icon" />);

    expect(screen.queryByTestId('test.icon')).toBeNull();
    expect(screen.getByTestId('test.icon', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('flips only icons that exist in the set', () => {
    expect([...DIRECTIONAL_ICONS].every((name) => name in ICON_PATHS)).toBe(true);
  });
});
