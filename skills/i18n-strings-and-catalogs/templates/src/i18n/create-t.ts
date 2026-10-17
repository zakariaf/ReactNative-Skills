// src/i18n/create-t.ts
import { isolate } from './bidi';

import type { MessageKey } from './messages';
import type { IntlShape } from 'react-intl';

export type MessageValues = Readonly<Record<string, string | number>>;
export type TFunction = (key: MessageKey, values?: MessageValues) => string;
export type CreateTOptions = {
  readonly intl: IntlShape;
  readonly onError: (error: Error) => void;
};

// Placeholders that receive free text (names, pre-formatted dates) end in Name or Text. Only
// those are bidi-isolated; numbers and select keys pass through untouched.
const TEXT_ARGUMENT = /(Name|Text)$/;

function prepareValue(
  name: string,
  value: string | number,
  onError: (error: Error) => void,
): string | number {
  if (!TEXT_ARGUMENT.test(name)) return value;
  if (typeof value === 'number') {
    onError(new Error(`i18n: "${name}" is a text placeholder; pass a string, not a number`));
    return String(value);
  }
  return isolate(value);
}

/** t(key, values): react-intl's formatMessage plus FSI/PDI isolation of every *Name/*Text value. */
export function createT({ intl, onError }: CreateTOptions): TFunction {
  return (key, values) => {
    if (values === undefined) return intl.formatMessage({ id: key });
    const prepared = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, prepareValue(name, value, onError)]),
    );
    return intl.formatMessage({ id: key }, prepared);
  };
}
