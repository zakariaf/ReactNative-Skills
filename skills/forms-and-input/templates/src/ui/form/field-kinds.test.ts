// src/ui/form/field-kinds.test.ts
// no-providers: pure data and a pure mapping, no React.
import { FIELD_KINDS, inputPropsOf } from './field-kinds';

import type { FieldKind } from './field-kinds';

const KINDS = Object.keys(FIELD_KINDS) as FieldKind[];
const PADS: readonly string[] = ['numeric', 'decimal', 'tel'];
const PASSWORDS: readonly string[] = ['current-password', 'new-password'];

describe('FIELD_KINDS', () => {
  it.each(KINDS)('hides the text of %s only when it is a password', (kind) => {
    const preset = FIELD_KINDS[kind];

    expect(preset.secureTextEntry).toBe(PASSWORDS.includes(preset.autoComplete));
  });

  it.each(KINDS)('marks %s as lacking an iOS return key exactly when it is a pad', (kind) => {
    const preset = FIELD_KINDS[kind];

    expect(preset.hasReturnKey).toBe(!PADS.includes(preset.inputMode));
  });

  it.each(KINDS.filter((kind) => FIELD_KINDS[kind].autoComplete !== 'off'))(
    'keeps autocorrect off for %s, whose text autofill fills',
    (kind) => {
      expect(FIELD_KINDS[kind].autoCorrect).toBe(false);
    },
  );

  it('keeps email, username, url and passwords lower case as typed', () => {
    for (const kind of ['email', 'username', 'url', 'current-password'] as const) {
      expect(FIELD_KINDS[kind].autoCapitalize).toBe('none');
    }
  });
});

describe('inputPropsOf', () => {
  it('gives an email field the email keyboard and the email autofill', () => {
    expect(inputPropsOf('email')).toStrictEqual({
      autoComplete: 'email',
      inputMode: 'email',
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      secureTextEntry: false,
      multiline: false,
    });
  });

  it('gives a new password secure entry and the new-password autofill', () => {
    expect(inputPropsOf('new-password')).toMatchObject({
      autoComplete: 'new-password',
      secureTextEntry: true,
    });
  });

  it('keeps the iOS URL suggestions of a url field while Android autofill stays off', () => {
    expect(inputPropsOf('url')).toMatchObject({
      autoComplete: 'off',
      textContentType: 'URL',
      inputMode: 'url',
    });
    expect(KINDS.filter((kind) => inputPropsOf(kind).textContentType !== undefined)).toStrictEqual([
      'url',
    ]);
  });

  it('makes only the multiline kind hold lines', () => {
    expect(KINDS.filter((kind) => inputPropsOf(kind).multiline === true)).toStrictEqual([
      'multiline',
    ]);
  });
});
