// src/ui/app-text-balance.test.tsx
// no-providers: AppText is the design system's lowest layer; it renders on the theme context's
// default (the light theme) and English, which is all the balance search reads.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AppText } from './app-text';

const HEADING = 'Your tasks stay on this phone, and the app collects no data.';

describe('AppText balanced display text (text-wrap: balance)', () => {
  it('pads a two-line heading at its end until its lines are nearly equal', async () => {
    await render(
      <AppText variant="heading" testID="privacy.summary">
        {HEADING}
      </AppText>,
    );
    const label = screen.getByTestId('privacy.summary');

    await fireEvent(label, 'layout', { nativeEvent: { layout: { width: 316, height: 60 } } });
    await fireEvent(label, 'textLayout', {
      nativeEvent: { lines: [{ width: 305 }, { width: 56 }] },
    });

    expect(label).toHaveStyle({ paddingEnd: 68 });
  });

  it('balances when iOS sends the text layout and the layout in one batch (no stale closure)', async () => {
    await render(
      <AppText variant="heading" testID="privacy.summary">
        {HEADING}
      </AppText>,
    );
    const label = screen.getByTestId('privacy.summary');
    const handlers = label.props as {
      onTextLayout: (event: unknown) => void;
      onLayout: (event: unknown) => void;
    };

    await act(() => {
      handlers.onTextLayout({ nativeEvent: { lines: [{ width: 305 }, { width: 56 }] } });
      handlers.onLayout({ nativeEvent: { layout: { width: 316, height: 60 } } });
    });

    expect(screen.getByTestId('privacy.summary')).toHaveStyle({ paddingEnd: 68 });
  });

  it('leaves body text greedy', async () => {
    await render(<AppText testID="privacy.body">{HEADING}</AppText>);
    const body = screen.getByTestId('privacy.body');

    await fireEvent(body, 'layout', { nativeEvent: { layout: { width: 316, height: 60 } } });

    expect(body).not.toHaveStyle({ paddingEnd: 68 });
  });
});
