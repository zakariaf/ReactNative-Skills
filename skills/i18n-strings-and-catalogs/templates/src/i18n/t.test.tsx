// src/i18n/t.test.tsx
// no-providers: this file tests I18nProvider itself, so each case renders <I18nProvider><T /> with
// the language and digits it proves; the render helper would wrap a second intl provider around it.
import { render, screen } from '@testing-library/react-native';

import { I18nProvider } from './i18n-provider';
import { T } from './t';
import { languageNow, recordShownLanguage } from './translate-now';

import type { Language } from './languages';

function failOnError(error: Error): never {
  throw error;
}

async function renderPage(language: Language): Promise<void> {
  await render(
    <I18nProvider language={language} digits="automatic" onError={failOnError}>
      <T id="tasks.page" values={{ page: 12 }} testID="tasks.page-label" />
    </I18nProvider>,
  );
}

describe('T', () => {
  it('renders the English message with its number', async () => {
    await renderPage('en');
    expect(screen.getByTestId('tasks.page-label')).toHaveTextContent('Page 12');
  });

  it('renders the Arabic message with Arabic-Indic digits', async () => {
    await renderPage('ar');
    expect(screen.getByTestId('tasks.page-label')).toHaveTextContent('الصفحة ١٢');
  });
});

describe('I18nProvider', () => {
  it('records what it shows for texts rendered outside it (createTranslateNow)', async () => {
    recordShownLanguage(null);
    await render(
      <I18nProvider language="ar" digits="latin" onError={failOnError}>
        <T id="tasks.page" values={{ page: 12 }} />
      </I18nProvider>,
    );
    expect(languageNow()).toStrictEqual({ language: 'ar', digits: 'latin' });
  });
});
