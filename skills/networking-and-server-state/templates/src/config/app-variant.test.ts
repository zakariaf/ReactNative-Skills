// src/config/app-variant.test.ts
import fc from 'fast-check';

import {
  APP_VARIANTS,
  isAppVariant,
  isStoreVariant,
  parseAppVariant,
  resolveAppVariant,
  variantEnv,
  variantIdentity,
} from './app-variant';

const BASE = { appId: 'com.example.tasks', name: 'Tasks', scheme: 'tasks' } as const;

describe('resolveAppVariant', () => {
  it('returns development when nothing is set on a developer machine', () => {
    expect(resolveAppVariant({})).toBe('development');
  });

  it('throws when nothing is set in a production bundle', () => {
    expect(() => resolveAppVariant({ NODE_ENV: 'production' })).toThrow('are not set');
  });

  it('throws when nothing is set on an EAS Build worker', () => {
    expect(() => resolveAppVariant({ EAS_BUILD: 'true' })).toThrow('are not set');
  });

  it.each(APP_VARIANTS)('resolves %s when both variables name it', (variant) => {
    const env = { APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant, NODE_ENV: 'production' };
    expect(resolveAppVariant(env)).toBe(variant);
  });

  it('throws when the bundle variable is missing', () => {
    expect(() => resolveAppVariant({ APP_VARIANT: 'production' })).toThrow(
      'EXPO_PUBLIC_APP_VARIANT= must equal APP_VARIANT=production',
    );
  });

  it('throws when only the bundle variable is set', () => {
    expect(() => resolveAppVariant({ EXPO_PUBLIC_APP_VARIANT: 'preview' })).toThrow(
      'EXPO_PUBLIC_APP_VARIANT=preview must equal APP_VARIANT=',
    );
  });

  it('throws when the two variables differ', () => {
    const env = { APP_VARIANT: 'production', EXPO_PUBLIC_APP_VARIANT: 'development' };
    expect(() => resolveAppVariant(env)).toThrow('must equal');
  });

  it('throws on an unknown name instead of building the store app', () => {
    const env = { APP_VARIANT: 'staging', EXPO_PUBLIC_APP_VARIANT: 'staging' };
    expect(() => resolveAppVariant(env)).toThrow(
      'APP_VARIANT=staging is not one of development|preview|production',
    );
  });
});

describe('parseAppVariant', () => {
  it('rejects every string that is not a variant name', () => {
    fc.assert(
      fc.property(
        fc.string().filter((raw) => !isAppVariant(raw)),
        (raw) => {
          expect(() => parseAppVariant(raw)).toThrow('is not one of');
        },
      ),
    );
  });

  it('accepts exactly the three names', () => {
    expect(APP_VARIANTS.map((variant) => parseAppVariant(variant))).toStrictEqual([
      'development',
      'preview',
      'production',
    ]);
    expect(isAppVariant('Production')).toBe(false);
  });
});

describe('variantIdentity', () => {
  it('keeps the base identity for production', () => {
    expect(variantIdentity(BASE, 'production')).toStrictEqual(BASE);
  });

  it.each([
    {
      variant: 'development',
      expected: { appId: 'com.example.tasks.dev', name: 'Tasks (Dev)', scheme: 'tasks-dev' },
    },
    {
      variant: 'preview',
      expected: {
        appId: 'com.example.tasks.preview',
        name: 'Tasks (Preview)',
        scheme: 'tasks-preview',
      },
    },
  ] as const)('extends id, name and scheme for $variant', ({ variant, expected }) => {
    expect(variantIdentity(BASE, variant)).toStrictEqual(expected);
  });

  it('gives every variant its own id, name and scheme', () => {
    const identities = APP_VARIANTS.map((variant) => variantIdentity(BASE, variant));
    for (const key of ['appId', 'name', 'scheme'] as const) {
      expect(new Set(identities.map((identity) => identity[key])).size).toBe(APP_VARIANTS.length);
    }
  });
});

describe('variantEnv', () => {
  it('names the variant in both variables', () => {
    expect(variantEnv('preview')).toStrictEqual({
      APP_VARIANT: 'preview',
      EXPO_PUBLIC_APP_VARIANT: 'preview',
    });
  });

  it('resolves back to the same variant for every variant', () => {
    for (const variant of APP_VARIANTS) {
      expect(resolveAppVariant({ ...variantEnv(variant), EAS_BUILD: 'true' })).toBe(variant);
    }
  });
});

describe('isStoreVariant', () => {
  it('is true only for production', () => {
    expect(APP_VARIANTS.filter((variant) => isStoreVariant(variant))).toStrictEqual(['production']);
  });
});
