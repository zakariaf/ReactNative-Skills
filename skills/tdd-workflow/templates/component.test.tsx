// src/features/__FEATURE__/components/__COMPONENT_FILE__.test.tsx
// __REQUIREMENT_ID__: "__REQUIREMENT_QUOTE__"
// Render through renderWithProviders (the app's real providers), find by role and accessible name,
// press with userEvent, and await every render and press (React Native Testing Library 14 is
// async). End with the accessibility audit line.
import { screen, userEvent } from '@testing-library/react-native';

import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { __COMPONENT_PASCAL__ } from './__COMPONENT_FILE__';

describe('__COMPONENT_PASCAL__', () => {
  it('__BEHAVIOUR_TITLE__ (__REQUIREMENT_ID__)', async () => {
    const __CALLBACK_PROP__ = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <__COMPONENT_PASCAL__ __PROPS__ __CALLBACK_PROP__={__CALLBACK_PROP__} />,
    );

    await user.press(screen.getByRole('__ROLE__', { name: '__ACCESSIBLE_NAME__' }));

    expect(__CALLBACK_PROP__).toHaveBeenCalledWith(__CALLBACK_ARGS__);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });
});
