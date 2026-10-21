// server/src/quota/check-quota.ts
import { resolvePlan } from '../subscriptions/entitlement-doc';

export type QuotaRequest = { readonly data: { readonly count: number } };
export type EntitlementReader = (userId: string) => Promise<unknown>;

export async function canAddTasks(userId: string, request: QuotaRequest, readEntitlement: EntitlementReader): Promise<boolean> {
  const plan = resolvePlan(await readEntitlement(userId), Date.now());
  return plan === 'premium' || request.data.count <= 50;
}
