// src/config/current-app-variant.test.ts
import { APP_VARIANTS } from './app-variant';
import { currentAppVariant } from './current-app-variant';

const NAME = 'EXPO_PUBLIC_APP_VARIANT';

// In Jest, Babel reads EXPO_PUBLIC_* from process.env at run time (production bundles inline them),
// so each test sets the variable on the real process.env object and the original value comes back.
function setBundleVariant(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, NAME);
  } else {
    Object.assign(process.env, { [NAME]: value });
  }
}

describe('currentAppVariant', () => {
  const original = process.env.EXPO_PUBLIC_APP_VARIANT;

  afterEach(() => {
    setBundleVariant(original);
  });

  it('returns development when the bundle variable is unset', () => {
    setBundleVariant(undefined);
    expect(currentAppVariant()).toBe('development');
  });

  it.each(APP_VARIANTS)('returns %s for a bundle built as %s', (variant) => {
    setBundleVariant(variant);
    expect(currentAppVariant()).toBe(variant);
  });

  it('throws on a value no build can produce', () => {
    setBundleVariant('staging');
    expect(() => currentAppVariant()).toThrow('is not one of development|preview|production');
  });
});
