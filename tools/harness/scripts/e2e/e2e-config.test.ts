// scripts/e2e/e2e-config.test.ts
import { parseE2eConfig } from './e2e-config.ts';

const MINIMAL = {
  productionAppIds: ['com.example.tasks'],
  network: { mode: 'offline-only' },
};

describe('parseE2eConfig', () => {
  describe('when only the required keys are given', () => {
    it('fills every default and names the devices with the fallback prefix', () => {
      const config = parseE2eConfig(MINIMAL, 'tasks');
      expect(config.devicePrefix).toBe('tasks');
      expect(config.maestroBin).toBe('tools/maestro/bin/maestro');
      expect(config.iosModels).toStrictEqual({
        phone: 'iPhone 17 Pro Max',
        tablet: 'iPad Pro 13-inch (M5)',
      });
      expect(config.androidDevices).toStrictEqual({ phone: 'pixel_8', tablet: 'pixel_tablet' });
      expect(config.network).toStrictEqual({ mode: 'offline-only', allowHosts: [] });
      expect(config.screenshots.flow).toBe('.maestro/screenshots/matrix.yaml');
      expect(config.buildExtra).toStrictEqual({});
    });
  });

  describe('when the contract sets its own values', () => {
    it('keeps them', () => {
      const config = parseE2eConfig(
        {
          ...MINIMAL,
          devicePrefix: 'acme-tasks',
          network: { mode: 'allowlist', allowHosts: ['api.example.com'] },
          largeText: { locales: ['en', 'ar'] },
          buildExtra: { adsMode: 'off' },
        },
        'tasks',
      );
      expect(config.devicePrefix).toBe('acme-tasks');
      expect(config.buildExtra).toStrictEqual({ adsMode: 'off' });
      expect(config.network.allowHosts).toStrictEqual(['api.example.com']);
      expect(config.largeTextLocales).toStrictEqual(['en', 'ar']);
    });
  });

  describe('when the contract is wrong', () => {
    it('refuses a missing production id, naming the key', () => {
      expect(() => parseE2eConfig({ network: { mode: 'off', why: 'x' } }, 'tasks')).toThrow(
        'productionAppIds',
      );
    });

    it('refuses network off without a reason and an allowlist without hosts', () => {
      expect(() => parseE2eConfig({ ...MINIMAL, network: { mode: 'off' } }, 'tasks')).toThrow(
        'off needs a why',
      );
      expect(() => parseE2eConfig({ ...MINIMAL, network: { mode: 'allowlist' } }, 'tasks')).toThrow(
        'allowlist needs allowHosts',
      );
    });

    it('refuses a device prefix that is not kebab-case', () => {
      expect(() => parseE2eConfig({ ...MINIMAL, devicePrefix: 'Tasks App' }, 'tasks')).toThrow(
        'kebab-case',
      );
    });
  });
});
