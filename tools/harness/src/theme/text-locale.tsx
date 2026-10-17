// src/theme/text-locale.tsx
// The one thing typography needs from i18n: the UI language (it picks the script's font and line
// heights) and the direction of that language's text (directionOf(language)), the default
// writingDirection of every text (use-text-style.ts). It is not the layout direction: that is
// rtl-and-direction's DirectionProvider. The app's i18n root provides it once
// (i18n-strings-and-catalogs owns the language, rtl-and-direction the direction rule); the design
// system never imports i18n code.
import { createContext } from 'react';

import type { ReactNode } from 'react';

export type TextDirection = 'ltr' | 'rtl';
/** The UI language and its text direction (directionOf(language)), not the layout direction. */
export type TextLocale = { readonly language: string; readonly direction: TextDirection };

/** What a component test renders with when it mounts no provider. */
export const DEFAULT_TEXT_LOCALE: TextLocale = { language: 'en', direction: 'ltr' };

/** Read it through useTextLocale (use-text-locale.ts); only the provider below writes it. */
export const TextLocaleContext = createContext<TextLocale>(DEFAULT_TEXT_LOCALE);

export type TextLocaleProviderProps = {
  readonly value: TextLocale;
  readonly children: ReactNode;
};

export function TextLocaleProvider({ value, children }: TextLocaleProviderProps): ReactNode {
  return <TextLocaleContext value={value}>{children}</TextLocaleContext>;
}
