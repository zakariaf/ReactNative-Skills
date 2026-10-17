// scripts/asc/premium-iap-payloads.test.ts
import { parseIapContract } from './iap-contract.ts';
import {
  appWithBundleId,
  availabilityBody,
  closestPricePoints,
  createIapBody,
  localizationBody,
  priceScheduleBody,
  screenshotCommitBody,
} from './premium-iap-payloads.ts';

const CONTRACT = parseIapContract({
  productId: 'com.example.tasks.premium',
  familyShareable: false,
  price: { amount: '2.99', currency: 'USD', baseTerritory: 'USA' },
  storeTexts: [{ locale: 'en-US', name: 'Premium', description: 'Unlock Premium.' }],
  reviewNote: 'Restore is on the paywall.',
});

describe('premium IAP payloads', () => {
  it('creates one non-consumable with Family Sharing as the contract decided', () => {
    expect(createIapBody('app1', CONTRACT)).toMatchObject({
      data: {
        attributes: {
          name: 'Premium',
          productId: 'com.example.tasks.premium',
          inAppPurchaseType: 'NON_CONSUMABLE',
          familySharable: false,
          reviewNote: 'Restore is on the paywall.',
        },
        relationships: { app: { data: { id: 'app1' } } },
      },
    });
  });

  it('builds a localization from a store text', () => {
    const storeText = { locale: 'en-US', name: 'Premium', description: 'Unlock Premium.' };
    expect(localizationBody('iap1', storeText)).toMatchObject({
      data: { attributes: storeText },
    });
  });

  it('ranks price points by distance to the target', () => {
    const points = [
      { id: 'a', customerPrice: 3.99 },
      { id: 'b', customerPrice: 2.99 },
      { id: 'c', customerPrice: 1.99 },
    ];
    expect(closestPricePoints(points, 2.99).map((point) => point.id)).toStrictEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('keeps the JSON:API local id in the price schedule', () => {
    expect(JSON.stringify(priceScheduleBody('iap1', 'pp1', 'USA'))).toContain('${price-0}');
  });

  it('builds availability and screenshot bodies', () => {
    expect(availabilityBody('iap1', ['USA', 'DEU'])).toMatchObject({
      data: { attributes: { availableInNewTerritories: true } },
    });
    expect(screenshotCommitBody('shot1', 'abc')).toMatchObject({
      data: { attributes: { uploaded: true, sourceFileChecksum: 'abc' } },
    });
  });
});

describe('parseIapContract', () => {
  it('refuses a product id Google Play would refuse', () => {
    expect(() => parseIapContract({ ...CONTRACT, productId: 'Com.Example-Premium' })).toThrow(
      'breaks the id rules',
    );
  });

  it('refuses a store text over the limits', () => {
    const storeTexts = [{ locale: 'en-US', name: 'P', description: 'x' }];
    expect(() => parseIapContract({ ...CONTRACT, storeTexts })).toThrow('limits');
  });
});

describe('appWithBundleId', () => {
  const record = (id: string, bundleId: string) => ({ id, attributes: { bundleId } });

  it('keeps only the record whose bundle id is exactly the one asked for', () => {
    const records = [record('2', 'com.example.tasks2'), record('1', 'com.example.tasks')];
    expect(appWithBundleId(records, 'com.example.tasks').id).toBe('1');
  });

  it('stops when only a longer bundle id matched the filter', () => {
    expect(() => appWithBundleId([record('2', 'com.example.tasks2')], 'com.example.tasks')).toThrow(
      'no app record for com.example.tasks',
    );
  });

  it('stops on two records with the same bundle id', () => {
    const records = [record('1', 'com.example.tasks'), record('3', 'com.example.tasks')];
    expect(() => appWithBundleId(records, 'com.example.tasks')).toThrow('2 app records');
  });
});
