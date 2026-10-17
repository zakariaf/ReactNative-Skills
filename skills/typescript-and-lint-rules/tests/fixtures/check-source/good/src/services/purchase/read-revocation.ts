// src/services/purchase/read-revocation.ts
import type { Purchase } from 'expo-iap';

/** Revocation evidence; the store types miss the field, so it is read defensively. */
export function readRevocationMs(purchase: Purchase): number | null {
  // @ts-expect-error: expo-iap 5.8 Purchase type misses revocationDate (StoreKit 2 has it)
  const raw: unknown = purchase.revocationDate;
  return typeof raw === 'number' ? raw : null;
}
