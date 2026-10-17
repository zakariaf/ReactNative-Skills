// src/ui/app-text.android.test.tsx
// no-providers: AppText is the design system's lowest layer; it renders on the theme context's
// default (the light theme) and the Arabic cases build TextLocaleProvider themselves.
import { render, screen } from '@testing-library/react-native';
import { PixelRatio } from 'react-native';

import { TextLocaleProvider } from '@/theme/text-locale';

import { AppText } from './app-text';

const ARABIC = { language: 'ar', direction: 'rtl' } as const;

/**
 * The overflow guard needs a bundled tall-script font and its hhea metrics, while the template app
 * uses the system font. So this file bundles the documented example, Noto Sans Arabic (hhea 1374 /
 * -738 of 1000): what fonts.ts holds once the app bundles it.
 */
jest.mock('@/theme/fonts', () => {
  const actual = jest.requireActual('@/theme/fonts');
  const bundled = {
    latin: null,
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
const mockWindow = { width: 411, height: 914, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

/** A 420 dpi-class Android phone (3x) with the system font size at this scale. */
function onDevice(fontScale: number): void {
  mockWindow.fontScale = fontScale;
  jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
}

async function renderCount(): Promise<void> {
  await render(
    <TextLocaleProvider value={ARABIC}>
      <AppText variant="number" testID="tasks.summary-done-count">
        ٥٨
      </AppText>
    </TextLocaleProvider>,
  );
}

// The guard cases run on the bundled example font mocked above; an app that keeps Arabic on the
// system font draws no guard (fonts.ts has no metrics for it).
describe('AppText on Android', () => {
  it('grows the frame of a tall line evenly, without moving the text', async () => {
    onDevice(1);
    await renderCount();

    // Android centres the overflow (half-leading): the pads only make the frame hold the ink.
    expect(screen.getByText('٥٨')).toHaveStyle({
      lineHeight: 42,
      paddingTop: 9,
      paddingBottom: 9,
      marginVertical: -9,
    });
    expect(screen.getByTestId('tasks.summary-done-count')).toHaveTextContent('٥٨');
  });

  it('starts a text in the other direction with a mark, since Android ignores writingDirection', async () => {
    onDevice(1);
    await render(<AppText direction="rtl">Tasks مهام</AppText>);

    // Android takes a paragraph's direction from its first strong character: U+200F makes it RTL.
    expect(screen.getByText('\u200FTasks مهام')).toBeOnTheScreen();
  });

  it('sizes the guard from the drawn text at 200 % (sp units scale size and line height)', async () => {
    onDevice(2);
    await renderCount();

    expect(screen.getByText('٥٨')).toHaveStyle({
      paddingTop: 17,
      paddingBottom: 17,
      marginVertical: -17,
    });
  });
});
