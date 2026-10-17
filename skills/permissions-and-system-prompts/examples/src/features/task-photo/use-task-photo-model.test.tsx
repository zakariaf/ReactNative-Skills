// src/features/task-photo/use-task-photo-model.test.tsx — every outcome of the camera ask on both
// platforms, through the scripted fake: granted, declined (denied), blocked, unavailable.
import { act } from '@testing-library/react-native';

import { createFakePermissionAccess } from '@/services/permissions/fake-permissions';
import { renderHookWithProviders } from '@test/render-with-providers';

import { useTaskPhotoModel } from './use-task-photo-model';

import type { FakePermissionScript } from '@/services/permissions/fake-permissions';

async function mountModel(script: FakePermissionScript) {
  const camera = createFakePermissionAccess(script);
  const takePhoto = jest.fn(() => Promise.resolve('file:///photo.jpg'));
  const openSettings = jest.fn(() => Promise.resolve());
  const view = await renderHookWithProviders(() =>
    useTaskPhotoModel({ camera, openSettings, takePhoto, onError: jest.fn() }),
  );
  const press = async (action: 'onTakePhoto' | 'onContinue' | 'onOpenSettings'): Promise<void> => {
    await act(async () => {
      view.result.current[action]();
      await Promise.resolve();
    });
  };
  return { view, camera, takePhoto, openSettings, press };
}

describe('useTaskPhotoModel', () => {
  it('takes the photo once the person allows the camera', async () => {
    const model = await mountModel({ platform: 'ios', answers: ['allow'] });

    await model.press('onTakePhoto');

    expect(model.takePhoto).toHaveBeenCalledTimes(1);
    expect(model.view.result.current.photoUri).toBe('file:///photo.jpg');
  });

  it('stays quiet after the person declined on iOS: blocked, no sheet, no photo', async () => {
    const model = await mountModel({ platform: 'ios', answers: ['deny'] });

    await model.press('onTakePhoto');

    expect(model.view.result.current.sheet).toBeNull();
    expect(model.view.result.current.isCameraOff).toBe(true);
    expect(model.takePhoto).not.toHaveBeenCalled();
  });

  it('shows the rationale on Android after one refusal (denied), then asks once more', async () => {
    const model = await mountModel({ platform: 'android', state: 'denied', answers: ['allow'] });

    await model.press('onTakePhoto');
    expect(model.view.result.current.sheet).toBe('rationale');
    await model.press('onContinue');

    expect(model.camera.dialogs()).toBe(1);
    expect(model.takePhoto).toHaveBeenCalledTimes(1);
  });

  it('offers the Settings app when blocked', async () => {
    const model = await mountModel({ platform: 'android', state: 'blocked' });

    await model.press('onTakePhoto');
    expect(model.view.result.current.sheet).toBe('settings');
    await model.press('onOpenSettings');

    expect(model.openSettings).toHaveBeenCalledTimes(1);
    expect(model.camera.dialogs()).toBe(0);
  });

  it('hides the camera on a device without one (unavailable)', async () => {
    const model = await mountModel({ platform: 'ios', state: 'unavailable' });

    await model.press('onTakePhoto');

    expect(model.view.result.current.isCameraMissing).toBe(true);
    expect(model.takePhoto).not.toHaveBeenCalled();
  });
});
