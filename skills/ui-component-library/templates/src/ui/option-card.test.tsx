// src/ui/option-card.test.tsx
import { screen, userEvent } from '@testing-library/react-native';

import { STROKE } from '@/theme/tokens';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { OptionCard } from './option-card';

const HIDDEN = { includeHiddenElements: true } as const;

/** The card's face (the bordered box): the radio mark's parent. */
function faceOf(testID: string): ReturnType<typeof screen.getByTestId> {
  const face = screen.getByTestId(`${testID}.radio`, HIDDEN).parent;
  if (face === null) throw new Error(`${testID} has no face`);
  return face;
}

describe('OptionCard', () => {
  it('is a selectable radio with its label, description and radio parts', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await renderWithProviders(
      <OptionCard
        label="By due date"
        description="Soonest first"
        isSelected={false}
        onSelect={onSelect}
        testID="sort.by-date-option"
        isReducedMotion
      />,
    );

    const radio = screen.getByRole('radio', { name: 'By due date' });
    expect(radio).not.toBeSelected();
    expect(screen.getByTestId('sort.by-date-option.description')).toHaveTextContent(
      'Soonest first',
    );
    expect(screen.getByTestId('sort.by-date-option.radio', HIDDEN)).toBeOnTheScreen();
    await user.press(radio);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('shows the choice by shape, not only colour: a bold edge and a radio dot', async () => {
    await renderWithProviders(
      <>
        <OptionCard
          label="By due date"
          isSelected
          onSelect={jest.fn()}
          testID="sort.by-date-option"
          isReducedMotion
        />
        <OptionCard
          label="By name"
          isSelected={false}
          onSelect={jest.fn()}
          testID="sort.by-name-option"
          isReducedMotion
        />
      </>,
    );

    expect(screen.getByRole('radio', { name: 'By due date' })).toBeSelected();
    expect(faceOf('sort.by-date-option')).toHaveStyle({ borderWidth: STROKE.bold });
    expect(screen.getByTestId('sort.by-date-option.radio.dot', HIDDEN)).toBeOnTheScreen();
    expect(faceOf('sort.by-name-option')).toHaveStyle({ borderWidth: STROKE.regular });
    expect(screen.queryByTestId('sort.by-name-option.radio.dot', HIDDEN)).not.toBeOnTheScreen();
  });

  it('marks an autonym with its own language for the screen reader', async () => {
    await renderWithProviders(
      <OptionCard
        label="العربية"
        labelLanguage="ar"
        isSelected
        onSelect={jest.fn()}
        testID="language.ar-option"
        isReducedMotion
      />,
    );

    expect(screen.getByRole('radio', { name: 'العربية' })).toBeSelected();
    expect(screen.getByTestId('language.ar-option.label')).toHaveProp(
      'accessibilityLanguage',
      'ar',
    );
  });
});
