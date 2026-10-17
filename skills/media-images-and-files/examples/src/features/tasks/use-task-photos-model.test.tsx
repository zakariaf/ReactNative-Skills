// src/features/tasks/use-task-photos-model.test.tsx: a task's photos through the fakes (a shape to imitate).
// The camera gate on both platforms (allowed, declined on iOS so blocked, Android's rationale after a
// refusal, blocked with the Settings app), a failed record save removing the new file, a failed share.
import { act, renderHook } from '@testing-library/react-native';

import { ok } from '@/core/result';
import { createMediaImporter } from '@/data/media/media-importer';
import { I18nProvider } from '@/i18n/i18n-provider';
import { createFakeImageResizer } from '@/services/image-resizer/fake-image-resizer';
import {
  createFakeMediaPicker,
  pickedImageFixture,
} from '@/services/media-picker/fake-media-picker';
import { createFakeMediaStore } from '@/services/media-store/fake-media-store';
import {
  createFakePermissionAccess,
  createFakePermissions,
} from '@/services/permissions/fake-permissions';
import { createFakeShareSheet } from '@/services/share-sheet/fake-share-sheet';
import { flushMicrotasks } from '@test/flush-microtasks';
import { createProvidersWrapper } from '@test/render-with-providers';

import { useTaskPhotosModel } from './use-task-photos-model';

import type { TaskPhotosModel } from './use-task-photos-model';
import type { MediaRef } from '@/core/media/media-ref';
import type { FakePermissionScript } from '@/services/permissions/fake-permissions';
import type { Services } from '@/services/services-context';
import type { ReactNode } from 'react';

function failOnError(error: Error): never {
  throw error;
}

/** The canonical providers with these services, then the app's I18nProvider (useT needs it). */
function wrapperWith(
  services: Partial<Services>,
): (props: { readonly children: ReactNode }) => ReactNode {
  const { wrapper: Providers } = createProvidersWrapper({ services });
  return function I18nWrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <Providers>
        <I18nProvider language="en" digits="automatic" onError={failOnError}>
          {children}
        </I18nProvider>
      </Providers>
    );
  };
}

type Press = 'onTakePhoto' | 'onAddFromLibrary' | 'onCameraContinue' | 'onOpenSettings';

/** The importer over the fakes, the way the composition root builds it from the adapters. */
function mediaFakes(): {
  readonly picker: ReturnType<typeof createFakeMediaPicker>;
  readonly store: ReturnType<typeof createFakeMediaStore>;
  readonly importer: ReturnType<typeof createMediaImporter>;
} {
  const picker = createFakeMediaPicker();
  const resizer = createFakeImageResizer();
  const store = createFakeMediaStore();
  resizer.onOutput((uri) => {
    store.giveTemporary(uri);
  });
  let next = 0;
  const importer = createMediaImporter({
    picker,
    resizer,
    store,
    nextMediaId: () => {
      next += 1;
      return `p${String(next)}`;
    },
  });
  return { picker, store, importer };
}

async function mountModel(script: FakePermissionScript, { isSaveOk = true } = {}) {
  const { picker, store, importer } = mediaFakes();
  const camera = createFakePermissionAccess(script);
  const permissions = createFakePermissions({ camera });
  const shareSheet = createFakeShareSheet();
  const saved: (readonly MediaRef[])[] = [];
  const savePhotos = (photos: readonly MediaRef[]): Promise<boolean> => {
    saved.push(photos);
    return Promise.resolve(isSaveOk);
  };
  const view = await renderHook(() => useTaskPhotosModel({ photos: [], savePhotos }), {
    wrapper: wrapperWith({ mediaImporter: importer, mediaStore: store, permissions, shareSheet }),
  });
  const press = async (action: Press): Promise<void> => {
    await act(async () => {
      view.result.current[action]();
      await flushMicrotasks();
    });
  };
  const model = (): TaskPhotosModel => view.result.current;
  return { picker, store, camera, permissions, shareSheet, saved, press, model };
}

/** The camera returns one photo, left in the cache like the real picker leaves it. */
function queuePhoto(mounted: Awaited<ReturnType<typeof mountModel>>): void {
  const photo = pickedImageFixture('camera.jpg');
  mounted.store.giveTemporary(photo.uri);
  mounted.picker.queueCapture(ok(photo));
}

describe('useTaskPhotosModel', () => {
  it('takes, stores and saves the photo once the person allows the camera', async () => {
    const mounted = await mountModel({ platform: 'ios', answers: ['allow'] });
    queuePhoto(mounted);

    await mounted.press('onTakePhoto');

    expect(mounted.camera.dialogs()).toBe(1);
    expect(mounted.saved).toStrictEqual([['p1.jpg']]);
    expect(mounted.model().phase).toStrictEqual({ kind: 'idle' });
  });

  it('respects a refusal on iOS: blocked, no sheet, no capture', async () => {
    const mounted = await mountModel({ platform: 'ios', answers: ['deny'] });
    queuePhoto(mounted);

    await mounted.press('onTakePhoto');

    expect(mounted.model().cameraSheet).toBeNull();
    expect(mounted.model().isCameraOff).toBe(true);
    expect(mounted.saved).toStrictEqual([]);
  });

  it("shows Android's rationale after one refusal (denied), then asks once more", async () => {
    const mounted = await mountModel({ platform: 'android', state: 'denied', answers: ['allow'] });
    queuePhoto(mounted);

    await mounted.press('onTakePhoto');
    expect(mounted.model().cameraSheet).toBe('rationale');
    await mounted.press('onCameraContinue');

    expect(mounted.camera.dialogs()).toBe(1);
    expect(mounted.saved).toStrictEqual([['p1.jpg']]);
  });

  it('offers the Settings app when the camera is blocked, and never shows a dialog', async () => {
    const mounted = await mountModel({ platform: 'android', state: 'blocked' });

    await mounted.press('onTakePhoto');
    expect(mounted.model().cameraSheet).toBe('settings');
    await mounted.press('onOpenSettings');

    expect(mounted.permissions.settingsOpened()).toBe(1);
    expect(mounted.camera.dialogs()).toBe(0);
  });

  it('removes the new file when the record cannot be saved, and says so', async () => {
    const mounted = await mountModel({ platform: 'ios', state: 'granted' }, { isSaveOk: false });
    const photo = pickedImageFixture('library.jpg');
    mounted.store.giveTemporary(photo.uri);
    mounted.picker.queuePick(ok([photo]));

    await mounted.press('onAddFromLibrary');

    expect(mounted.store.stored().size).toBe(0);
    expect(mounted.model().phase).toStrictEqual({
      kind: 'failed',
      message: 'The photo could not be saved. Try again.',
    });
  });
});
