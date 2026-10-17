// src/i18n/document-language.web.ts
// <html lang> follows the app's language in the web build (web-support). The static HTML carries the
// source language (+html.tsx writes it at export time), but a visitor reads the app in their own:
// screen readers pick their voice, browsers their hyphenation, line breaking and font fallback from
// the page language. react-native-web has no other place for it.
import type * as Native from './document-language';

export const syncDocumentLanguage: typeof Native.syncDocumentLanguage = (language) => {
  // Static rendering runs in Node, where there is no page.
  if (typeof document !== 'undefined') document.documentElement.lang = language;
};
