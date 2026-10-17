// src/i18n/runtime-message.test.ts
import { createIntl } from 'react-intl';

import { createT } from './create-t';
import { localeTagFor } from './digits';
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';
import { isMessageKey, translateRuntimeMessage } from './runtime-message';

import type { TFunction } from './create-t';
import type { Language } from './languages';

function failOnError(error: Error): never {
  throw error;
}

function tFor(language: Language): TFunction {
  const intl = createIntl({
    locale: localeTagFor(language, 'automatic'),
    messages: messagesFor(language),
    defaultLocale: SOURCE_LANGUAGE,
    onError: failOnError,
  });
  return createT({ intl, onError: failOnError });
}

describe('runtime messages', () => {
  it('accepts only the keys of the source catalog, never inherited names', () => {
    expect(isMessageKey('common.cancel')).toBe(true);
    expect(isMessageKey('common.missing')).toBe(false);
    expect(isMessageKey('toString')).toBe(false);
    expect(isMessageKey('')).toBe(false);
  });

  it('formats a known id with its values in each language', () => {
    const message = { id: 'tasks.summary.open', values: { openCount: 2 } };
    expect(translateRuntimeMessage(tFor('en'), message, failOnError)).toBe('2 open tasks');
    expect(translateRuntimeMessage(tFor('ar'), message, failOnError)).toBe('مهمتان مفتوحتان');
    expect(translateRuntimeMessage(tFor('en'), { id: 'common.cancel' }, failOnError)).toBe(
      'Cancel',
    );
  });

  it('reports an unknown id and shows nothing rather than the raw key', () => {
    const onError = jest.fn();
    expect(translateRuntimeMessage(tFor('en'), { id: 'game.hud.unknown' }, onError)).toBe('');
    expect(onError).toHaveBeenCalledWith(
      new Error('i18n: "game.hud.unknown" is not a key of the en catalog'),
    );
  });
});
