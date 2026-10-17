// src/services/purchase/entitlement-evidence.test.ts
import { entitlementEvidence, latestRevocationMs } from './entitlement-evidence';

import type { StoreTransaction } from './purchase-port';

const ID = 'com.example.tasks.premium';
const tx = (transactionId: string, revocationDateMs: number | null): StoreTransaction => ({
  productId: ID,
  transactionId,
  state: 'purchased',
  revocationDateMs,
  handle: null,
});

describe('entitlementEvidence', () => {
  it('treats absence as no evidence', () => {
    expect(entitlementEvidence([], ID)).toBe('unknown');
  });

  it('reads a refund as a revocation', () => {
    expect(entitlementEvidence([tx('1', 1_700_000_000_000)], ID)).toBe('revoked');
  });

  it('lets a newer purchase after a refund win', () => {
    expect(entitlementEvidence([tx('1', 1_700_000_000_000), tx('2', null)], ID)).toBe('owned');
  });

  it('ignores a pending purchase and other products', () => {
    expect(entitlementEvidence([{ ...tx('3', null), state: 'pending' }], ID)).toBe('unknown');
    expect(entitlementEvidence([{ ...tx('4', null), productId: 'other' }], ID)).toBe('unknown');
  });

  it('returns the latest revocation date', () => {
    expect(latestRevocationMs([tx('1', 5), tx('2', 9), tx('3', null)], ID)).toBe(9);
  });
});
