// src/stores/premium/premium-store.test.ts
import { err, ok } from '@/core/result';
import { createFakeEntitlementRepository } from '@/data/entitlements/fake-entitlement-repository';
import { selectIsPremium } from '@/stores/premium/premium-selectors';
import { createPremiumStore } from '@/stores/premium/premium-store';

const OWNED = { isOwned: true, ownedSinceMs: 1_000, revokedAtMs: null };

describe('premium store', () => {
  it('hydrates from the saved entitlement', () => {
    const store = createPremiumStore({ entitlements: createFakeEntitlementRepository(OWNED) });
    expect(selectIsPremium(store.getState())).toBe(true);
  });

  it('starts as not owned when the read fails', () => {
    const entitlements = createFakeEntitlementRepository(OWNED);
    const store = createPremiumStore({
      entitlements: { ...entitlements, premium: () => err({ kind: 'storage-busy' }) },
    });
    expect(selectIsPremium(store.getState())).toBe(false);
  });

  it('saves Premium before it publishes it', () => {
    const entitlements = createFakeEntitlementRepository();
    const store = createPremiumStore({ entitlements });
    const seenOnDisk: boolean[] = [];
    store.subscribe(() => {
      seenOnDisk.push(entitlements.saves.at(-1)?.isOwned ?? false);
    });
    expect(store.getState().grantPremium({ ownedSinceMs: 2_000 })).toStrictEqual(ok(undefined));
    expect(seenOnDisk).toStrictEqual([true]);
  });

  it('publishes nothing when the save fails', () => {
    const entitlements = createFakeEntitlementRepository();
    const store = createPremiumStore({ entitlements });
    const listener = jest.fn();
    store.subscribe(listener);
    entitlements.failNextSave = { kind: 'storage-full' };
    expect(store.getState().grantPremium({ ownedSinceMs: 2_000 })).toStrictEqual(
      err({ kind: 'storage-full' }),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(selectIsPremium(store.getState())).toBe(false);
  });

  it('writes nothing for a grant it already holds', () => {
    const entitlements = createFakeEntitlementRepository(OWNED);
    const store = createPremiumStore({ entitlements });
    expect(store.getState().grantPremium({ ownedSinceMs: 9_000 })).toStrictEqual(ok(undefined));
    expect(entitlements.saves).toStrictEqual([]);
  });

  it('saves a dated revocation and ignores one without a date', () => {
    const entitlements = createFakeEntitlementRepository(OWNED);
    const store = createPremiumStore({ entitlements });
    expect(store.getState().revokePremium(0)).toStrictEqual(ok(undefined));
    expect(selectIsPremium(store.getState())).toBe(true);
    expect(store.getState().revokePremium(5_000)).toStrictEqual(ok(undefined));
    expect(entitlements.saves).toStrictEqual([
      { isOwned: false, ownedSinceMs: 1_000, revokedAtMs: 5_000 },
    ]);
    expect(selectIsPremium(store.getState())).toBe(false);
  });

  it('reloads what is on disk', () => {
    const entitlements = createFakeEntitlementRepository();
    const store = createPremiumStore({ entitlements });
    expect(entitlements.savePremium(OWNED)).toStrictEqual(ok(undefined));
    expect(store.getState().reload()).toStrictEqual(ok(undefined));
    expect(selectIsPremium(store.getState())).toBe(true);
  });
});
