// scripts/e2e/open-device.ts
// The build and the dedicated device of one platform, for the runner and the screenshot capture.
// Device names are <devicePrefix>-<purpose> on both platforms (an iOS simulator, an Android AVD).
// The iOS side (ios-simulator-build's simulator layer) loads only for an iOS run, so an app that
// tests Android alone needs none of it.
import { globSync } from 'node:fs';
import { join } from 'node:path';

import { openAndroidDevice } from './android-device.ts';
import { readAndroidBuild, readIosBuild, requireE2eBuild } from './build-guard.ts';
import { deviceName } from './e2e-device.ts';

import type { E2eConfig } from './e2e-config.ts';
import type { BuiltApp, E2eDevice, FormFactor, Platform } from './e2e-device.ts';

/** The device <prefix>-<purpose> of the platform, booted and ready. */
export async function openDevice(
  platform: Platform,
  config: E2eConfig,
  target: { readonly purpose: string; readonly formFactor: FormFactor },
): Promise<E2eDevice> {
  if (platform === 'ios') {
    const { openIosDevice } = await import('./ios-device.ts');
    const model = config.iosModels[target.formFactor];
    return openIosDevice({ prefix: config.devicePrefix, purpose: target.purpose, model });
  }
  return openAndroidDevice({
    name: deviceName(config.devicePrefix, target.purpose),
    image: config.androidImage,
    device: config.androidDevices[target.formFactor],
  });
}

/** The Release build to test, checked: a test variant with its JavaScript embedded. */
export function readCheckedBuild(
  platform: Platform,
  config: E2eConfig,
  appPath: string | undefined,
): BuiltApp {
  let app: BuiltApp;
  if (platform === 'ios') {
    const path = appPath ?? globSync(join(config.iosAppDir, '*.app'))[0];
    if (path === undefined) {
      throw new Error(
        `e2e: no .app in ${config.iosAppDir}: build a Release simulator build of the preview variant`,
      );
    }
    app = readIosBuild(path);
  } else {
    app = readAndroidBuild(appPath ?? config.apkPath);
  }
  requireE2eBuild(app, config);
  return app;
}
