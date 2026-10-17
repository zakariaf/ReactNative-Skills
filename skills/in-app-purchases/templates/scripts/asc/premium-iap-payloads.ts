// scripts/asc/premium-iap-payloads.ts: pure request bodies for the Premium in-app purchase (App Store Connect API v1/v2).
import type { IapContract, StoreText } from './iap-contract.ts';

export type PricePoint = { readonly id: string; readonly customerPrice: number };

/** An App Store Connect resource: its id and attributes. */
export type AscResource = { readonly id: string; readonly attributes?: Record<string, unknown> };

/**
 * The one app record whose bundle id equals `bundleId`. Apple's filter[bundleId] is not an exact match
 * (com.acme.tasks also returns com.acme.tasks2), so the first record could be another app's: this
 * keeps only the exact one, and stops on none or two.
 */
export function appWithBundleId(records: readonly AscResource[], bundleId: string): AscResource {
  const matches = records.filter((record) => record.attributes?.['bundleId'] === bundleId);
  const [app] = matches;
  if (app === undefined) throw new Error(`no app record for ${bundleId}: a human step first`);
  if (matches.length > 1) throw new Error(`${String(matches.length)} app records for ${bundleId}`);
  return app;
}

type Relationship = { readonly data: { readonly type: string; readonly id: string } };

const rel = (type: string, id: string): Relationship => ({ data: { type, id } });

/** POST /v2/inAppPurchases: one non-consumable, Family Sharing exactly as the contract decided. */
export function createIapBody(appId: string, contract: IapContract): unknown {
  return {
    data: {
      type: 'inAppPurchases',
      attributes: {
        name: 'Premium', // reference name, at most 64 characters, never shown to users
        productId: contract.productId, // never reusable in this app, even after deletion
        inAppPurchaseType: 'NON_CONSUMABLE',
        familySharable: contract.familyShareable, // once on, it can never be turned off
        reviewNote: contract.reviewNote,
      },
      relationships: { app: rel('apps', appId) },
    },
  };
}

/** POST /v1/inAppPurchaseLocalizations: display name 2-30 characters, description at most 45. */
export function localizationBody(iapId: string, storeText: StoreText): unknown {
  return {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: storeText,
      relationships: { inAppPurchaseV2: rel('inAppPurchases', iapId) },
    },
  };
}

/** The price points closest to `target` first; the caller takes only an exact match. */
export function closestPricePoints(points: readonly PricePoint[], target: number): PricePoint[] {
  return [...points].sort(
    (a, b) => Math.abs(a.customerPrice - target) - Math.abs(b.customerPrice - target),
  );
}

/** POST /v1/inAppPurchasePriceSchedules ('${price-0}' is JSON:API local-id syntax, not a template). */
export function priceScheduleBody(iapId: string, pricePointId: string, territory: string): unknown {
  return {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: rel('inAppPurchases', iapId),
        baseTerritory: rel('territories', territory),
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price-0}' }] },
      },
    },
    included: [
      {
        type: 'inAppPurchasePrices',
        id: '${price-0}',
        attributes: { startDate: null },
        relationships: { inAppPurchasePricePoint: rel('inAppPurchasePricePoints', pricePointId) },
      },
    ],
  };
}

/** POST /v1/inAppPurchaseAvailabilities: sell wherever the app is sold. */
export function availabilityBody(iapId: string, territoryIds: readonly string[]): unknown {
  return {
    data: {
      type: 'inAppPurchaseAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        inAppPurchase: rel('inAppPurchases', iapId),
        availableTerritories: { data: territoryIds.map((id) => ({ type: 'territories', id })) },
      },
    },
  };
}

/** The review screenshot: reserve (this body), PUT the bytes to each upload operation, then commit. */
export function screenshotReserveBody(iapId: string, fileName: string, fileSize: number): unknown {
  return {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      attributes: { fileName, fileSize },
      relationships: { inAppPurchaseV2: rel('inAppPurchases', iapId) },
    },
  };
}

/** PATCH the reserved screenshot once its bytes are uploaded (md5 hex of the file). */
export function screenshotCommitBody(screenshotId: string, md5Hex: string): unknown {
  return {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      id: screenshotId,
      attributes: { uploaded: true, sourceFileChecksum: md5Hex },
    },
  };
}
