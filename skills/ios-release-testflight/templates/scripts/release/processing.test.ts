// scripts/release/processing.test.ts
import {
  buildsPath,
  findDeliveryId,
  isVersionAboveLastRelease,
  lastReleaseVersion,
  processingStateOf,
} from './processing.ts';

describe('findDeliveryId', () => {
  it('finds the delivery id under any spelling, at any depth', () => {
    expect(findDeliveryId({ 'product-errors': [], details: { deliveryUuid: 'abc-1' } })).toBe(
      'abc-1',
    );
    expect(findDeliveryId([{ other: 1 }, { 'delivery-id': 'abc-2' }])).toBe('abc-2');
    expect(findDeliveryId({ success: true })).toBeNull();
  });
});

describe('processingStateOf', () => {
  it('reads the first build state and ignores anything else', () => {
    expect(processingStateOf({ data: [{ attributes: { processingState: 'VALID' } }] })).toBe(
      'VALID',
    );
    expect(processingStateOf({ data: [{ attributes: { processingState: 'ODD' } }] })).toBeNull();
    expect(processingStateOf({ data: [] })).toBeNull();
  });
});

describe('buildsPath', () => {
  it('filters one build by app, build number and version', () => {
    expect(buildsPath('6400000000', 8, '1.4.0')).toBe(
      '/v1/builds?filter[app]=6400000000&filter[version]=8&filter[preReleaseVersion.version]=1.4.0',
    );
  });
});

describe('the version rule', () => {
  const tags = ['v1.2.0', 'v1.3.0+ios.11', 'v1.10.0', 'v1.4.0+ios.12', 'notes'];

  it('compares release tags numerically and ignores upload tags', () => {
    expect(lastReleaseVersion(tags, '')).toBe('1.10.0');
  });

  it('requires a version above the last release', () => {
    expect(isVersionAboveLastRelease('1.10.0', tags, '')).toBe(false);
    expect(isVersionAboveLastRelease('1.11.0', tags, '')).toBe(true);
    expect(isVersionAboveLastRelease('1.0.0', [], '')).toBe(true);
  });

  it('reads only the app prefix when multi-package', () => {
    expect(lastReleaseVersion(['mobile/v2.0.0', 'v9.0.0'], 'mobile/')).toBe('2.0.0');
  });
});
