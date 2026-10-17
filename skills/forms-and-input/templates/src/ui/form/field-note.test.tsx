// src/ui/form/field-note.test.tsx
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { FieldNote, isShown } from './field-note';

import type { FieldNoteProps } from './field-note';
import type { TestInstance } from 'test-renderer';

const ID = 'task-editor.title';

/** The live-region setting of the nearest ancestor that has one. */
function liveRegionOf(element: TestInstance): unknown {
  for (let node: TestInstance | null = element; node !== null; node = node.parent) {
    const region: unknown = node.props['accessibilityLiveRegion'];
    if (region !== undefined) return region;
  }
  return undefined;
}

async function renderNote(props: Omit<FieldNoteProps, 'testID'>): Promise<void> {
  await renderWithProviders(<FieldNote testID={ID} {...props} />);
}

describe('FieldNote', () => {
  it('shows the error first, in a polite live region', async () => {
    await renderNote({ error: 'Give the task a title', status: 'Checking…', hint: 'Short' });

    const error = screen.getByTestId(`${ID}.error`);
    expect(error).toHaveTextContent('Give the task a title');
    expect(screen.queryByTestId(`${ID}.status`)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(`${ID}.hint`)).not.toBeOnTheScreen();
    expect(liveRegionOf(error)).toBe('polite');
  });

  it('shows the progress note while there is no error', async () => {
    await renderNote({ error: null, status: 'Checking…', hint: 'Short' });

    expect(screen.getByTestId(`${ID}.status`)).toHaveTextContent('Checking…');
  });

  it('shows the hint alone, and nothing at all without text', async () => {
    await renderNote({ hint: 'Short' });
    expect(screen.getByTestId(`${ID}.hint`)).toHaveTextContent('Short');

    await renderNote({ error: '', status: null });
    expect(screen.queryByTestId(`${ID}.hint`)).not.toBeOnTheScreen();
  });
});

describe('isShown', () => {
  it('is true only for a non-empty text', () => {
    expect([isShown('a'), isShown(''), isShown(null), isShown(undefined)]).toStrictEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
