// src/features/root-navigator/web-storage-notice.tsx
// What WebStorageGate shows instead of the app in the web build (web-support): another tab of the app
// holds the storage ('in-use-elsewhere'), or this browser cannot run it ('unsupported': the page is
// not cross-origin isolated). The gate is the root layout's outermost element, so this renders
// outside every provider, like the crash fallback, and reads no React context that lacks
// a default: copy from createTranslateNow (the language I18nProvider showed last, else the
// browser's), the text locale from the same languageNow(), and the background from useTheme(), whose
// context defaults to the light theme AppText falls back to. The catalog keys come from the root layout, which owns the
// copy (i18n-strings-and-catalogs adds them to every catalog). Keep it trivial: nothing above it
// catches an error.
import { StyleSheet, View } from 'react-native';

import { directionOf } from '@/i18n/languages';
import { createTranslateNow, languageNow } from '@/i18n/translate-now';
import { TextLocaleProvider } from '@/theme/text-locale';
import { CONTENT_MAX_WIDTH } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';

import type { MessageKey } from '@/i18n/messages';

/** Why the gate holds the app back. */
export type WebStorageNoticeReason = 'in-use-elsewhere' | 'unsupported';

export type WebStorageNoticeProps = {
  readonly reason: WebStorageNoticeReason;
  /** The catalog key of the title ("The app is open in another tab"). */
  readonly titleKey: MessageKey;
  /** The catalog key of the one sentence that says what to do ("Close the other tab, then reload"). */
  readonly bodyKey: MessageKey;
  /** Receives a missing message (the error net's report); a throw here would reach nothing. */
  readonly onMessageError: (error: Error) => void;
};

/** One testID per reason, so a smoke test or a flow can tell the two notices apart. */
const SCREEN_TEST_IDS = {
  'in-use-elsewhere': 'web-storage.other-tab',
  unsupported: 'web-storage.unsupported',
} as const satisfies Record<WebStorageNoticeReason, string>;

export function WebStorageNotice(props: WebStorageNoticeProps): React.JSX.Element {
  const theme = useTheme();
  const t = createTranslateNow(props.onMessageError);
  const { language } = languageNow();
  return (
    <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
      <View
        testID={SCREEN_TEST_IDS[props.reason]}
        role="alert"
        style={[styles.screen, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.column}>
          <AppText testID="web-storage.title">{t(props.titleKey)}</AppText>
          <AppText testID="web-storage.body">{t(props.bodyKey)}</AppText>
        </View>
      </View>
    </TextLocaleProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  // A readable line on a wide browser window: a constant, so no context is read.
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: 16 },
});
