// src/i18n/document-language.ts
// The page language of the web build (web-support). Nothing to do on iOS and Android, where each
// text carries its locale (AppText). document-language.web.ts sets <html lang> in the browser.
// Call it wherever the shown language changes (the language provider, in an effect):
//   useEffect(() => { syncDocumentLanguage(language); }, [language]);
import type { Language } from './languages';

/** Makes the page language follow the app's language (web only; nothing on iOS and Android). */
export const syncDocumentLanguage: (language: Language) => void = () => undefined;
