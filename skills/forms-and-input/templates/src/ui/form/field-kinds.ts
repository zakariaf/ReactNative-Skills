// src/ui/form/field-kinds.ts
// The input presets a text field picks by name (forms-and-input). One kind fixes the keyboard
// (inputMode), what autofill and password managers offer (autoComplete: React Native 0.86 maps the
// web value to iOS textContentType and to an Android autofill hint), capitalization, autocorrect,
// secure entry and whether the field holds lines. Screens never set those props one by one: a
// password field without autoComplete gets no password manager on either platform, and an email
// field with sentence capitalization starts every address with a capital letter.
import type { TextInputProps } from 'react-native';

export type FieldKind =
  | 'sentence'
  | 'multiline'
  | 'name'
  | 'given-name'
  | 'family-name'
  | 'email'
  | 'username'
  | 'current-password'
  | 'new-password'
  | 'one-time-code'
  | 'phone'
  | 'url'
  | 'integer'
  | 'decimal'
  | 'postal-code'
  | 'search';

export type FieldKindPreset = {
  readonly autoComplete: NonNullable<TextInputProps['autoComplete']>;
  /**
   * iOS only, and only where autoComplete cannot say it on both platforms: an explicit
   * textContentType wins over React Native's autoComplete mapping on iOS; Android ignores it.
   */
  readonly textContentType?: NonNullable<TextInputProps['textContentType']>;
  readonly inputMode: NonNullable<TextInputProps['inputMode']>;
  readonly autoCapitalize: NonNullable<TextInputProps['autoCapitalize']>;
  readonly autoCorrect: boolean;
  readonly secureTextEntry: boolean;
  readonly isMultiline: boolean;
  /**
   * False where the iOS keyboard for this inputMode has no return key (number pad, decimal pad,
   * phone pad): a form that shows such a field renders KeyboardDoneBar, or the keyboard cannot be
   * closed on an iPhone. Android's pads always have one.
   */
  readonly hasReturnKey: boolean;
};

const TEXT = {
  inputMode: 'text',
  autoCorrect: false,
  secureTextEntry: false,
  isMultiline: false,
  hasReturnKey: true,
} as const;
const SECRET = { ...TEXT, autoCapitalize: 'none', secureTextEntry: true } as const;
const PAD = { ...TEXT, autoCapitalize: 'none', hasReturnKey: false } as const;

/** Every kind, with the props it sets. Add a kind here, never a prop on one field. */
export const FIELD_KINDS: Readonly<Record<FieldKind, FieldKindPreset>> = {
  sentence: { ...TEXT, autoComplete: 'off', autoCapitalize: 'sentences', autoCorrect: true },
  multiline: {
    ...TEXT,
    autoComplete: 'off',
    autoCapitalize: 'sentences',
    autoCorrect: true,
    isMultiline: true,
  },
  name: { ...TEXT, autoComplete: 'name', autoCapitalize: 'words' },
  'given-name': { ...TEXT, autoComplete: 'given-name', autoCapitalize: 'words' },
  'family-name': { ...TEXT, autoComplete: 'family-name', autoCapitalize: 'words' },
  email: { ...TEXT, autoComplete: 'email', inputMode: 'email', autoCapitalize: 'none' },
  username: { ...TEXT, autoComplete: 'username', autoCapitalize: 'none' },
  'current-password': { ...SECRET, autoComplete: 'current-password' },
  'new-password': { ...SECRET, autoComplete: 'new-password' },
  'one-time-code': { ...PAD, autoComplete: 'one-time-code', inputMode: 'numeric' },
  phone: { ...PAD, autoComplete: 'tel', inputMode: 'tel' },
  // autoComplete 'off', not 'url': Android has no URL autofill hint (React Native 0.86 logs
  // "Invalid autoComplete" and turns autofill off). iOS keeps its URL suggestions through
  // textContentType, which Android ignores.
  url: {
    ...TEXT,
    autoComplete: 'off',
    textContentType: 'URL',
    inputMode: 'url',
    autoCapitalize: 'none',
  },
  integer: { ...PAD, autoComplete: 'off', inputMode: 'numeric' },
  decimal: { ...PAD, autoComplete: 'off', inputMode: 'decimal' },
  'postal-code': { ...TEXT, autoComplete: 'postal-code', autoCapitalize: 'characters' },
  search: { ...TEXT, autoComplete: 'off', inputMode: 'search', autoCapitalize: 'none' },
};

/** The TextInput props of a kind (FIELD_KINDS has the reasons). */
export function inputPropsOf(kind: FieldKind): Partial<TextInputProps> {
  const preset = FIELD_KINDS[kind];
  return {
    autoComplete: preset.autoComplete,
    ...(preset.textContentType === undefined ? {} : { textContentType: preset.textContentType }),
    inputMode: preset.inputMode,
    autoCapitalize: preset.autoCapitalize,
    autoCorrect: preset.autoCorrect,
    spellCheck: preset.autoCorrect,
    secureTextEntry: preset.secureTextEntry,
    multiline: preset.isMultiline,
  };
}
