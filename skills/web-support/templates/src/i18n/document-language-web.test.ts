// src/i18n/document-language-web.test.ts
// Tests document-language.web.ts and its native base. Jest runs in Node, so a small document stands
// in for the browser's.
import { syncDocumentLanguage as syncNative } from './document-language';
import { syncDocumentLanguage } from './document-language.web';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

/** A page whose <html lang> starts as English. */
function usePage(): { lang: string } {
  const root = { lang: 'en' };
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: root },
    configurable: true,
  });
  return root;
}

describe('syncDocumentLanguage', () => {
  afterEach(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });

  it('sets <html lang> to the app language in the browser', () => {
    const root = usePage();

    syncDocumentLanguage('ar');

    expect(root.lang).toBe('ar');
  });

  it('skips the page during static rendering, where there is no document', () => {
    expect(() => {
      syncDocumentLanguage('ar');
    }).not.toThrow();
  });

  it('leaves everything alone on iOS and Android', () => {
    const root = usePage();

    syncNative('ar');

    expect(root.lang).toBe('en');
  });
});
