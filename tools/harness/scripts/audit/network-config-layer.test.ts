// scripts/audit/network-config-layer.test.ts
import { configProblems } from './network-config-layer.ts';

const ATS = { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } };

describe('configProblems', () => {
  it('passes the production config of an api-port app', () => {
    expect(
      configProblems(
        { plugins: ['expo-router', 'expo-updates'], updates: { enabled: true } },
        'api-port',
      ),
    ).toStrictEqual([]);
  });

  it('fails arbitrary loads and cleartext in any profile', () => {
    const config = {
      ios: { infoPlist: ATS },
      plugins: [['expo-build-properties', { android: { usesCleartextTraffic: true } }] as const],
    };

    expect(configProblems(config, 'api-port')).toStrictEqual([
      'Android usesCleartextTraffic is true in the production config',
      'NSAllowsArbitraryLoads is true in the production config',
    ]);
  });

  it('needs updates off and no expo-updates plugin under offline-only', () => {
    expect(configProblems({ plugins: ['expo-updates'] }, 'offline-only')).toStrictEqual([
      'offline-only: expo.updates.enabled must be false',
      'offline-only: the expo-updates plugin adds over-the-air update traffic',
    ]);
    expect(configProblems({ updates: { enabled: false } }, 'offline-only')).toStrictEqual([]);
  });
});
