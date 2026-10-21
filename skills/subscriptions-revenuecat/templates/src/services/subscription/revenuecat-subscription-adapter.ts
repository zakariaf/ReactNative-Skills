// src/services/subscription/revenuecat-subscription-adapter.ts: SubscriptionPort over react-native-purchases.
// The only file that imports react-native-purchases (check-revenuecat sdk-outside-adapter). Created
// once, by the composition root. Never mixed with another purchase SDK (mixed-purchase-sdks).
import Purchases, { PACKAGE_TYPE, PURCHASES_ERROR_CODE } from 'react-native-purchases';

import { attempt, attemptAsync, ok } from '@/core/result';

import { NO_ENTITLEMENT } from './subscription-port';

import type {
  ClientEntitlement,
  SubscriptionFailure,
  SubscriptionFailureKind,
  SubscriptionOffer,
  SubscriptionPackage,
  SubscriptionPeriod,
  SubscriptionPort,
} from './subscription-port';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

export type RevenueCatAdapterOptions = {
  /** The platform's public SDK key (EXPO_PUBLIC_*: public by design). Never the REST secret key. */
  readonly apiKey: string;
  readonly entitlementId: string;
};

const CODES = PURCHASES_ERROR_CODE;

/** PURCHASES_ERROR_CODE values by what the paywall shows; any other code is 'unknown'. */
const KIND_CODES: readonly (readonly [SubscriptionFailureKind, readonly string[]])[] = [
  ['cancelled', [CODES.PURCHASE_CANCELLED_ERROR]],
  ['pending', [CODES.PAYMENT_PENDING_ERROR]],
  ['network', [CODES.NETWORK_ERROR, CODES.OFFLINE_CONNECTION_ERROR]],
  [
    'store-unavailable',
    [
      CODES.STORE_PROBLEM_ERROR,
      CODES.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR,
      CODES.PRODUCT_REQUEST_TIMED_OUT_ERROR,
    ],
  ],
  ['not-allowed', [CODES.PURCHASE_NOT_ALLOWED_ERROR, CODES.INSUFFICIENT_PERMISSIONS_ERROR]],
  [
    'already-owned',
    [
      CODES.PRODUCT_ALREADY_PURCHASED_ERROR,
      CODES.RECEIPT_ALREADY_IN_USE_ERROR,
      CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR,
    ],
  ],
  ['not-configured', [CODES.CONFIGURATION_ERROR, CODES.INVALID_CREDENTIALS_ERROR]],
];

const KIND_BY_CODE = new Map(
  KIND_CODES.flatMap(([kind, codes]) => codes.map((code) => [code, kind] as const)),
);

function codeOf(thrown: unknown): string {
  const code: unknown =
    typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'code') : null;
  return typeof code === 'string' ? code : 'unknown';
}

function toFailure(thrown: unknown): SubscriptionFailure {
  const code = codeOf(thrown);
  return { kind: KIND_BY_CODE.get(code) ?? 'unknown', code };
}

function periodOf(pkg: PurchasesPackage): SubscriptionPeriod {
  if (pkg.packageType === PACKAGE_TYPE.MONTHLY) return 'monthly';
  if (pkg.packageType === PACKAGE_TYPE.ANNUAL) return 'annual';
  return 'other';
}

function toPackage(pkg: PurchasesPackage): SubscriptionPackage {
  const period = periodOf(pkg);
  return {
    packageId: pkg.identifier,
    productId: pkg.product.identifier,
    period,
    priceText: pkg.product.priceString,
    pricePerMonthText: period === 'monthly' ? null : pkg.product.pricePerMonthString,
  };
}

function toOffer(offering: PurchasesOffering): SubscriptionOffer {
  return { offeringId: offering.identifier, packages: offering.availablePackages.map(toPackage) };
}

/** The SDK's view of one entitlement; UI only. */
export function toClientEntitlement(info: CustomerInfo, entitlementId: string): ClientEntitlement {
  const active = info.entitlements.active[entitlementId];
  if (active?.isActive !== true) return NO_ENTITLEMENT;
  return {
    isActive: true,
    productId: active.productIdentifier,
    expiresAtMs: active.expirationDateMillis,
    willRenew: active.willRenew,
    hasBillingIssue: active.billingIssueDetectedAtMillis !== null,
  };
}

type EntitlementOf = (info: CustomerInfo) => ClientEntitlement;

/** Offerings and purchases; the packages of the last offering are kept to buy by package id. */
function offerCalls(entitlementOf: EntitlementOf): Pick<SubscriptionPort, 'getOffer' | 'purchase'> {
  const packages = new Map<string, PurchasesPackage>();
  async function currentOffering(): Promise<PurchasesOffering | null> {
    const current = (await Purchases.getOfferings()).current;
    for (const pkg of current?.availablePackages ?? []) packages.set(pkg.identifier, pkg);
    return current;
  }
  return {
    getOffer: () =>
      attemptAsync(async () => {
        const current = await currentOffering();
        return current === null || current.availablePackages.length === 0 ? null : toOffer(current);
      }, toFailure),
    purchase: (packageId) =>
      attemptAsync(async () => {
        if (!packages.has(packageId)) await currentOffering();
        const pkg = packages.get(packageId);
        if (pkg === undefined) {
          throw Object.assign(new Error('unknown package'), {
            code: CODES.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR,
          });
        }
        return entitlementOf((await Purchases.purchasePackage(pkg)).customerInfo);
      }, toFailure),
  };
}

/** Identity, restore and customer info reads. */
function customerCalls(
  entitlementOf: EntitlementOf,
): Omit<SubscriptionPort, 'configure' | 'getOffer' | 'purchase'> {
  return {
    logIn: (appUserId) =>
      attemptAsync(
        async () => entitlementOf((await Purchases.logIn(appUserId)).customerInfo),
        toFailure,
      ),
    logOut: () =>
      attemptAsync(async () => {
        await Purchases.logOut();
      }, toFailure),
    restore: () =>
      attemptAsync(async () => entitlementOf(await Purchases.restorePurchases()), toFailure),
    getEntitlement: () =>
      attemptAsync(async () => entitlementOf(await Purchases.getCustomerInfo()), toFailure),
    onEntitlementChange: (listener) => {
      const onInfo = (info: CustomerInfo): void => {
        listener(entitlementOf(info));
      };
      Purchases.addCustomerInfoUpdateListener(onInfo);
      return () => {
        Purchases.removeCustomerInfoUpdateListener(onInfo);
      };
    },
    managementUrl: async () => {
      const info = await attemptAsync(() => Purchases.getCustomerInfo(), toFailure);
      return info.ok ? ok(info.value.managementURL) : info;
    },
  };
}

/** Creates the port. Call once, from the composition root. */
export function createRevenueCatSubscriptionAdapter(
  options: RevenueCatAdapterOptions,
): SubscriptionPort {
  const entitlementOf: EntitlementOf = (info) => toClientEntitlement(info, options.entitlementId);
  return {
    // configure with the backend user id: the SDK then never creates an anonymous id.
    configure: (appUserId) =>
      attempt(() => {
        Purchases.configure({ apiKey: options.apiKey, appUserID: appUserId });
      }, toFailure),
    ...offerCalls(entitlementOf),
    ...customerCalls(entitlementOf),
  };
}
