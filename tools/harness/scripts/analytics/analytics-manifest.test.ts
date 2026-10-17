// scripts/analytics/analytics-manifest.test.ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  analyticsCollectedDataTypes,
  collectedDataTypes,
  dataSafetyRows,
  parseCollects,
} from './analytics-manifest.ts';

const COLLECTS = [
  { dataType: 'product-interaction', linked: true, tracking: false, purposes: ['analytics'] },
  { dataType: 'device-id', linked: true, tracking: false, purposes: ['analytics'] },
];

describe('analytics store declarations', () => {
  it('maps collects to Apple privacy-manifest entries', () => {
    expect(collectedDataTypes(parseCollects({ collects: COLLECTS }))).toStrictEqual([
      {
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeProductInteraction',
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
      },
      {
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAnalytics'],
      },
    ]);
  });

  it('maps collects to Data safety rows, optional because analytics is opt-in', () => {
    const rows = dataSafetyRows(
      parseCollects({
        collects: [
          { ...COLLECTS[0], purposes: ['developer-advertising', 'third-party-advertising'] },
        ],
      }),
    );
    expect(rows).toStrictEqual([
      {
        dataType: 'App activity > App interactions',
        collected: true,
        optional: true,
        purposes: ['Advertising or marketing'],
      },
    ]);
  });

  it('refuses a malformed contract instead of declaring less', () => {
    expect(() => parseCollects({})).toThrow('collects list');
    expect(() => parseCollects({ collects: ['x'] })).toThrow('not an object');
    expect(() => parseCollects({ collects: [{ ...COLLECTS[0], dataType: 'mood' }] })).toThrow(
      'data type',
    );
    expect(() => parseCollects({ collects: [{ ...COLLECTS[0], linked: 'yes' }] })).toThrow(
      'booleans',
    );
    expect(() => parseCollects({ collects: [{ ...COLLECTS[0], purposes: [] }] })).toThrow(
      'purpose',
    );
  });

  it('reads contracts/analytics.json for app.config.ts', () => {
    const root = mkdtempSync(join(tmpdir(), 'analytics-manifest-'));
    try {
      mkdirSync(join(root, 'contracts'));
      writeFileSync(
        join(root, 'contracts', 'analytics.json'),
        JSON.stringify({ collects: COLLECTS }),
      );
      expect(analyticsCollectedDataTypes(root)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
