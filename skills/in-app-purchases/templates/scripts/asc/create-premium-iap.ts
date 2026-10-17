// scripts/asc/create-premium-iap.ts: creates (or completes) the Premium product in App Store Connect from the contract.
// Usage: node scripts/asc/create-premium-iap.ts <bundleId>
// Needs ASC_KEY_ID and ASC_ISSUER_ID (a team API key) in the environment. Everything else comes from
// contracts/in-app-purchases.json: the product id, Family Sharing, the price point and its base
// territory, the store texts. Re-running is safe: it reuses the product, skips locales that exist,
// and posting the price schedule again replaces it. It stops (exit 1) when the contract's price is
// no longer a price point; then the developer decides.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ascRequest } from './asc-client.ts';
import { loadAscCredentials } from './asc-credentials.ts';
import { createAscJwt } from './asc-jwt.ts';
import { parseIapContract } from './iap-contract.ts';
import {
  appWithBundleId,
  closestPricePoints,
  createIapBody,
  localizationBody,
  priceScheduleBody,
} from './premium-iap-payloads.ts';
import { nowEpochSeconds } from '../clock/system-clock.ts';

import type { AscRequest } from './asc-client.ts';
import type { IapContract } from './iap-contract.ts';
import type { AscResource, PricePoint } from './premium-iap-payloads.ts';

type Resource = AscResource;
type Call = (request: AscRequest) => Promise<unknown>;

const CONTRACT = join(process.cwd(), 'contracts', 'in-app-purchases.json');
const NEAREST_SHOWN = 3;

function dataOf(json: unknown): Resource[] {
  const data: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'data') : [];
  return (Array.isArray(data) ? data : [data]) as Resource[];
}

async function findOrCreate(call: Call, appId: string, contract: IapContract): Promise<string> {
  const path = `/v1/apps/${appId}/inAppPurchasesV2?filter[productId]=${contract.productId}`;
  const existing = dataOf(await call({ method: 'GET', path }))[0];
  if (existing !== undefined) return existing.id;
  const body = createIapBody(appId, contract);
  const created = dataOf(await call({ method: 'POST', path: '/v2/inAppPurchases', body }))[0];
  if (created === undefined) throw new Error('create returned no data');
  return created.id;
}

async function addMissingLocalizations(
  call: Call,
  iapId: string,
  contract: IapContract,
): Promise<void> {
  const path = `/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations`;
  const existing = dataOf(await call({ method: 'GET', path })).map((l) => l.attributes?.['locale']);
  for (const storeText of contract.storeTexts) {
    if (existing.includes(storeText.locale)) continue;
    const body = localizationBody(iapId, storeText);
    await call({ method: 'POST', path: '/v1/inAppPurchaseLocalizations', body });
  }
}

/** limit=8000 is the endpoint's maximum: one page holds every price point of a territory. */
async function pricePoints(call: Call, iapId: string, territory: string): Promise<PricePoint[]> {
  const path = `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=${territory}&limit=8000`;
  return dataOf(await call({ method: 'GET', path })).map((point) => ({
    id: point.id,
    customerPrice: Number(point.attributes?.['customerPrice']),
  }));
}

/** Exactly the contract's price point; never a "nearest" one without the developer. */
async function choosePricePoint(
  call: Call,
  iapId: string,
  contract: IapContract,
): Promise<PricePoint> {
  const { amount, currency, baseTerritory } = contract.price;
  const target = Number(amount);
  const ranked = closestPricePoints(await pricePoints(call, iapId, baseTerritory), target);
  const best = ranked[0];
  if (best?.customerPrice === target) return best;
  const nearest = ranked
    .slice(0, NEAREST_SHOWN)
    .map((point) => String(point.customerPrice))
    .join(', ');
  throw new Error(
    `${currency} ${amount} is not a price point in ${baseTerritory} (nearest: ${nearest}). Ask the developer, then update the contract.`,
  );
}

async function main(bundleId: string, issuedAt: number): Promise<void> {
  if (bundleId === '') throw new Error('usage: create-premium-iap.ts <bundleId>');
  const contract = parseIapContract(JSON.parse(readFileSync(CONTRACT, 'utf8')));
  const token = createAscJwt(loadAscCredentials(process.env), issuedAt);
  const call: Call = async (request) => {
    const response = await ascRequest(token, request);
    if (!response.ok) throw new Error(`${request.path}: ${JSON.stringify(response.errors)}`);
    return response.json;
  };
  const app = appWithBundleId(
    dataOf(await call({ method: 'GET', path: `/v1/apps?filter[bundleId]=${bundleId}` })),
    bundleId,
  );
  const iapId = await findOrCreate(call, app.id, contract);
  await addMissingLocalizations(call, iapId, contract);
  const point = await choosePricePoint(call, iapId, contract);
  const body = priceScheduleBody(iapId, point.id, contract.price.baseTerritory);
  await call({ method: 'POST', path: '/v1/inAppPurchasePriceSchedules', body });
  console.error(
    `Premium ${iapId}: ${contract.price.currency} ${String(point.customerPrice)}; next: availability, review screenshot`,
  );
}

await main(process.argv[2] ?? '', nowEpochSeconds());
