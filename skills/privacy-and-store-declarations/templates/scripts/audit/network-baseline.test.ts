// scripts/audit/network-baseline.test.ts
import { addFinding, compareToBaseline } from './network-baseline.ts';

const BASELINE = {
  'react-native': {
    categories: ['webSocket', 'remoteUrl'],
    reason: 'RN core modules, reached only through the ApiClient',
  },
  'left-package': { categories: ['fetch'], reason: 'a package the app has since removed' },
};

describe('compareToBaseline', () => {
  it('fails a category the baseline does not cover and notes a stale entry', () => {
    const findings = new Map<string, Set<string>>();
    addFinding(findings, 'react-native', 'webSocket');
    addFinding(findings, 'react-native', 'fetch');
    addFinding(findings, 'new-sdk', 'remoteUrl');

    expect(compareToBaseline(findings, BASELINE)).toStrictEqual({
      failures: [
        'NEW react-native: fetch (not in the baseline)',
        'NEW new-sdk: remoteUrl (not in the baseline)',
      ],
      notes: ['STALE left-package: in the baseline but not found'],
    });
  });

  it('covers every finding of a declared SDK, baselined or not', () => {
    const findings = new Map([['ads-sdk', new Set(['fetch', 'webSocket', 'remoteUrl'])]]);

    expect(compareToBaseline(findings, BASELINE, new Set(['ads-sdk'])).failures).toStrictEqual([]);
    expect(compareToBaseline(findings, BASELINE).failures).toStrictEqual([
      'NEW ads-sdk: fetch, webSocket, remoteUrl (not in the baseline)',
    ]);
  });

  it('passes findings the baseline covers', () => {
    const findings = new Map([['react-native', new Set(['remoteUrl'])]]);

    expect(
      compareToBaseline(findings, { 'react-native': BASELINE['react-native'] }).failures,
    ).toStrictEqual([]);
  });
});
