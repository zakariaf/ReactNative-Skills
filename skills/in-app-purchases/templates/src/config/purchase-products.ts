// src/config/purchase-products.ts: the product ids the app sells, written once and never changed.
// Equal to contracts/in-app-purchases.json "productId" (check-purchases compares them). A product id
// can never be reused in its App Store Connect app or Play Console app, even after deletion.

/** The one non-consumable that unlocks Premium, in the App Store and on Google Play. */
export const PREMIUM_PRODUCT_ID = '__PRODUCT_ID__';
