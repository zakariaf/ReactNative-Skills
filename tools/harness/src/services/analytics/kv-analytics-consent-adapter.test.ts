// src/services/analytics/kv-analytics-consent-adapter.test.ts
// The adapter against an in-memory stand-in for expo-sqlite/kv-store's synchronous API (the real
// kv-store SQL is exercised by the direction guard's node:sqlite test).
import {
  ANALYTICS_CONSENT_KEY,
  createKvAnalyticsConsentAdapter,
} from './kv-analytics-consent-adapter';

const mockItems = new Map<string, string>();
let isMockFailing = false;

function mockGuard(): void {
  if (isMockFailing) throw new Error('disk I/O error');
}

jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => {
      mockGuard();
      return mockItems.get(key) ?? null;
    },
    setItemSync: (key: string, value: string) => {
      mockGuard();
      mockItems.set(key, value);
    },
    removeItemSync: (key: string) => {
      mockGuard();
      mockItems.delete(key);
    },
  },
}));

describe('createKvAnalyticsConsentAdapter', () => {
  beforeEach(() => {
    mockItems.clear();
    isMockFailing = false;
  });

  it('reads null before the first answer, then the saved text', () => {
    const store = createKvAnalyticsConsentAdapter();
    expect(store.read()).toStrictEqual({ ok: true, value: null });
    expect(store.write('{"choice":"granted"}')).toStrictEqual({ ok: true, value: undefined });
    expect(mockItems.get(ANALYTICS_CONSENT_KEY)).toBe('{"choice":"granted"}');
    expect(store.read()).toStrictEqual({ ok: true, value: '{"choice":"granted"}' });
  });

  it('clears the record', () => {
    const store = createKvAnalyticsConsentAdapter();
    store.write('x');
    expect(store.clear().ok).toBe(true);
    expect(store.read()).toStrictEqual({ ok: true, value: null });
  });

  it('turns storage failures into values instead of throwing', () => {
    const store = createKvAnalyticsConsentAdapter();
    isMockFailing = true;
    expect(store.read()).toStrictEqual({
      ok: false,
      error: { kind: 'analytics-consent-unreadable' },
    });
    expect(store.write('x')).toStrictEqual({
      ok: false,
      error: { kind: 'analytics-consent-not-saved' },
    });
    expect(store.clear()).toStrictEqual({
      ok: false,
      error: { kind: 'analytics-consent-not-saved' },
    });
  });
});
