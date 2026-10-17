// src/ui/screen-body.test.tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { SPACING } from '@/theme/tokens';
import { findInaccessiblePressables } from '@test/a11y/find-inaccessible-pressables';
import { renderWithProviders } from '@test/render-with-providers';

import { AppText } from './app-text';
import { ScreenBody, TOP_OVERHANG } from './screen-body';
import { PAGE_BOTTOM_PADDING } from './use-page-bottom-padding';

import type { ScreenBodyProps } from './screen-body';

const BODY_TEXT = 'Body text';

async function renderBody(
  props: Omit<ScreenBodyProps, 'children'> = {},
  bottomInset = 34,
): Promise<void> {
  await renderWithProviders(
    <SafeAreaInsetsContext value={{ top: 59, right: 0, bottom: bottomInset, left: 0 }}>
      <ScreenBody testID="page.body" {...props}>
        <AppText>{BODY_TEXT}</AppText>
      </ScreenBody>
    </SafeAreaInsetsContext>,
  );
}

function contentStyle(): Record<string, unknown> {
  const style: unknown = screen.getByTestId('page.body').props['contentContainerStyle'];
  return Object.assign({}, ...[style].flat(2).filter(Boolean)) as Record<string, unknown>;
}

describe('ScreenBody', () => {
  it('lays its blocks out with the page padding and one gap', async () => {
    await renderBody({ gap: 'md' });

    expect(screen.getByText(BODY_TEXT)).toBeOnTheScreen();
    expect(contentStyle()).toMatchObject({
      flexGrow: 1,
      gap: SPACING.md,
      paddingInline: SPACING.lg,
      paddingBlockStart: SPACING.sm,
      paddingBlockEnd: PAGE_BOTTOM_PADDING,
    });
    expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
  });

  it('ends with the bottom inset when the page runs under the home indicator', async () => {
    await renderBody({ isUnderHomeIndicator: true }, 48);

    expect(contentStyle()).toMatchObject({ paddingBlockEnd: 48 });
  });

  it('moves the clip edge up and pads the content by the same amount for an overhang', async () => {
    await renderBody({ hasTopOverhang: true });

    const style: unknown = screen.getByTestId('page.body').props['style'];
    expect(Object.assign({}, ...[style].flat(2).filter(Boolean))).toMatchObject({
      marginBlockStart: -TOP_OVERHANG,
    });
    expect(contentStyle()).toMatchObject({ paddingBlockStart: SPACING.sm + TOP_OVERHANG });
  });

  it('scrolls to its offset after the content size change and again after the layout', async () => {
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => undefined);
    await renderBody({ scrollToY: 420 });
    const body = screen.getByTestId('page.body');

    await fireEvent(body, 'contentSizeChange', 390, 1200);
    await fireEvent(body, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } },
    });

    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 420, animated: false });
    scrollTo.mockRestore();
  });

  it('leaves the offset to the person once they drag, whatever the content does next', async () => {
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => undefined);
    await renderBody({ scrollToY: 420 });
    const body = screen.getByTestId('page.body');
    await fireEvent(body, 'contentSizeChange', 390, 1200);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    await fireEvent(body, 'scrollBeginDrag');
    await fireEvent(body, 'contentSizeChange', 390, 1600);
    await fireEvent(body, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 640 } },
    });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockRestore();
  });

  it('does not scroll by itself without an offset', async () => {
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => undefined);
    await renderBody();

    await fireEvent(screen.getByTestId('page.body'), 'contentSizeChange', 390, 1200);

    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});
