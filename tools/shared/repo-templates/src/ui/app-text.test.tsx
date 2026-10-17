// src/ui/app-text.test.tsx
// no-providers: AppText is the design system's lowest layer; it renders on the theme context's
// default (the light theme) and the cases that need another language build TextLocaleProvider.
import { render, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { scriptFontFor } from '@/theme/fonts';
import { PALETTE } from '@/theme/palette';
import { TextLocaleProvider } from '@/theme/text-locale';
import { TYPE_SCALE } from '@/theme/tokens';
import { TEXT_ALIGN, fontStyleOf } from '@/theme/use-text-style';

import { AppText, overflowGuardOf } from './app-text';

import type { ReactElement } from 'react';
import type { TextStyle } from 'react-native';

const ARABIC = { language: 'ar', direction: 'rtl' } as const;
/** A bold or regular text's font in a language, from the bundled SCRIPT_FONTS above. */
const boldFont = (language: string): TextStyle =>
  fontStyleOf(scriptFontFor(language, TYPE_SCALE.label));
const regularFont = (language: string): TextStyle =>
  fontStyleOf(scriptFontFor(language, TYPE_SCALE.body));

/**
 * The overflow guard needs a bundled tall-script font and its hhea metrics, while the template app
 * uses the system font. So this file bundles the documented example, Noto Sans and Noto Sans Arabic
 * (hhea 1374 / -738 of 1000): what fonts.ts holds once the app bundles them.
 */
jest.mock('@/theme/fonts', () => {
  const actual = jest.requireActual('@/theme/fonts');
  const bundled = {
    latin: {
      regular: 'NotoSans-Regular',
      medium: 'NotoSans-Regular',
      semibold: 'NotoSans-Bold',
      bold: 'NotoSans-Bold',
    },
    arabic: {
      regular: 'NotoSansArabic-Regular',
      medium: 'NotoSansArabic-Regular',
      semibold: 'NotoSansArabic-Bold',
      bold: 'NotoSansArabic-Bold',
    },
  };
  const metrics = { unitsPerEm: 1000, ascender: 1374, descender: -738 };
  return {
    ...actual,
    SCRIPT_FONTS: bundled,
    TALL_SCRIPT_METRICS: { 'NotoSansArabic-Regular': metrics, 'NotoSansArabic-Bold': metrics },
    scriptFontFor: (language: string, style: unknown) =>
      actual.scriptFontFor(language, style, bundled),
  };
});

/** The window React Native reports to useWindowDimensions (Jest's own default font scale is 2). */
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

/** A phone at this pixel ratio with the system text size at this scale. */
function onDevice(pixelRatio: number, fontScale: number): void {
  mockWindow.fontScale = fontScale;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(pixelRatio);
}

async function renderInArabic(element: ReactElement): Promise<void> {
  await render(<TextLocaleProvider value={ARABIC}>{element}</TextLocaleProvider>);
}

describe('AppText', () => {
  // Line heights sit on the device pixel grid; 3x is a current iPhone, at the default text size.
  beforeEach(() => {
    onDevice(3, 1);
  });

  it('sets display roles in the Latin bold font on the pixel grid', async () => {
    await render(
      <AppText variant="display" testID="tasks.screen-title">
        Today
      </AppText>,
    );

    expect(screen.getByTestId('tasks.screen-title')).toHaveStyle({
      ...boldFont('en'),
      fontSize: 34,
      lineHeight: 39, // 34 x 1.15 = 39.1, snapped to 117/3
    });
  });

  it('switches to the Arabic font, the tall line height and right to left in Arabic', async () => {
    await renderInArabic(<AppText variant="heading">مهام اليوم</AppText>);

    expect(screen.getByText('مهام اليوم')).toHaveStyle({
      ...boldFont('ar'),
      fontSize: 20,
      lineHeight: 31, // 20 x 1.55
      writingDirection: 'rtl',
      textAlign: TEXT_ALIGN.start, // 'left': React Native swaps it to the right in an RTL layout
    });
  });

  // The overflow guard cases run on the bundled example font mocked above; an app that keeps Arabic
  // on the system font draws no guard (fonts.ts has no metrics for it).
  it('lets tall Arabic digits keep their tops on a tight number line (iOS)', async () => {
    await renderInArabic(
      <AppText variant="number" testID="tasks.summary-done-count">
        ٥٨
      </AppText>,
    );

    // Noto Sans Arabic's content box is 59 pt at 28 pt (hhea 1374 + 738 of 1000): 17 pt over the
    // 42 pt line. The text moves down by half of it and its frame holds the ink; the margins keep
    // the element at the line box, and the wrapper carries the testID.
    expect(screen.getByText('٥٨')).toHaveStyle({
      lineHeight: 42,
      paddingTop: 17.5,
      paddingBottom: 0.5,
      marginVertical: -9,
    });
    expect(screen.getByTestId('tasks.summary-done-count')).toHaveTextContent('٥٨');
  });

  it('keeps tall Arabic digits whole at 200 % text, where the drawn overflow doubles (iOS)', async () => {
    onDevice(3, 2);
    await renderInArabic(
      <AppText variant="number" testID="tasks.summary-done-count">
        ٥٨
      </AppText>,
    );

    // Drawn at 56 pt on an 84 pt line: content 77 + 41 = 118 pt, 17 pt over each edge. The pads
    // from the unscaled sizes (17.5 and 0.5) would cover half of it and clip the tops again.
    expect(screen.getByText('٥٨')).toHaveStyle({
      lineHeight: 42,
      paddingTop: 34,
      paddingBottom: 0,
      marginVertical: -17,
    });
  });

  it('grows only the frame on Android, where the overflow is already centred', () => {
    expect(overflowGuardOf(59, 42, 'android')).toStrictEqual({
      paddingTop: 9,
      paddingBottom: 9,
      marginVertical: -9,
    });
    expect(overflowGuardOf(23, 22.4, 'ios')).toBeNull();
  });

  it('draws Latin numbers without the overflow guard', async () => {
    await render(
      <AppText variant="number" testID="tasks.summary-done-count">
        58
      </AppText>,
    );

    expect(screen.getByTestId('tasks.summary-done-count')).not.toHaveStyle({ marginVertical: -9 });
  });

  it('sets counts in tabular figures', async () => {
    await render(<AppText variant="statValue">12</AppText>);

    expect(screen.getByText('12')).toHaveStyle({ fontVariant: ['tabular-nums'] });
  });

  it('uses the regular Latin font at 17 pt for body text', async () => {
    await render(<AppText testID="tasks.empty-hint">Nothing due today</AppText>);

    expect(screen.getByTestId('tasks.empty-hint')).toHaveStyle({
      ...regularFont('en'),
      fontSize: 17,
      lineHeight: 67 / 3, // 17 x 1.32 = 22.44 on the pixel grid
    });
  });

  it('keeps the brand name in the Latin font and isolates it in right-to-left text', async () => {
    await renderInArabic(
      <AppText variant="brandName" testID="about.brand-name">
        Tasks
      </AppText>,
    );

    const name = screen.getByTestId('about.brand-name');
    expect(name).toHaveTextContent('\u2068Tasks\u2069');
    expect(name).toHaveStyle({ ...boldFont('en'), fontSize: 22 });
  });

  it('sets a text in the other direction with writingDirection on iOS, adding no mark', async () => {
    await render(
      <AppText direction="rtl" testID="lists.language-name">
        Tasks مهام
      </AppText>,
    );

    const name = screen.getByTestId('lists.language-name');
    expect(name).toHaveTextContent('Tasks مهام');
    expect(name).toHaveStyle({ writingDirection: 'rtl' });
  });

  it('paints tones from the theme', async () => {
    await render(
      <AppText tone="danger" testID="task-detail.delete-label">
        Delete task
      </AppText>,
    );

    expect(screen.getByTestId('task-detail.delete-label')).toHaveStyle({
      color: PALETTE.light.danger,
    });
  });

  it('marks headings as headers for VoiceOver and TalkBack', async () => {
    await render(
      <AppText variant="screenTitle" isHeader>
        Lists
      </AppText>,
    );

    expect(screen.getByRole('header', { name: 'Lists' })).toBeOnTheScreen();
  });
});
