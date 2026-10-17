// src/services/media-picker/fake-media-picker.test.ts
import { err, ok } from '@/core/result';

import { createFakeMediaPicker, pickedImageFixture } from './fake-media-picker';

describe('createFakeMediaPicker', () => {
  it('answers queued picks in order, then a cancel, and records each limit', async () => {
    const picker = createFakeMediaPicker();
    const photo = pickedImageFixture('a.jpg');
    picker.queuePick(ok([photo]));
    picker.queuePick(err({ kind: 'pick-failed' }));
    await expect(picker.pickImages({ limit: 3 })).resolves.toStrictEqual({
      ok: true,
      value: [photo],
    });
    await expect(picker.pickImages({ limit: 1 })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'pick-failed' },
    });
    await expect(picker.pickImages({ limit: 1 })).resolves.toStrictEqual({ ok: true, value: [] });
    expect(picker.pickLimits).toStrictEqual([3, 1, 1]);
  });

  it('refuses a capture without the camera permission, like the adapter', async () => {
    const picker = createFakeMediaPicker();
    picker.setCameraAllowed(false);
    picker.queueCapture(ok(pickedImageFixture('b.jpg')));
    await expect(picker.capturePhoto()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'permission-needed' },
    });
    picker.setCameraAllowed(true);
    await expect(picker.capturePhoto()).resolves.toStrictEqual({
      ok: true,
      value: pickedImageFixture('b.jpg'),
    });
    await expect(picker.capturePhoto()).resolves.toStrictEqual({ ok: true, value: null });
  });

  it('answers camera-unavailable on a device without a camera, before the permission', async () => {
    const picker = createFakeMediaPicker();
    picker.setCameraPresent(false);
    picker.setCameraAllowed(false);
    picker.queueCapture(ok(pickedImageFixture('c.jpg')));
    await expect(picker.capturePhoto()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'camera-unavailable' },
    });
  });

  it('gives a pending pick back once', async () => {
    const picker = createFakeMediaPicker();
    picker.leavePendingPick([pickedImageFixture('lost.jpg')]);
    await expect(picker.recoverPendingPick()).resolves.toStrictEqual({
      ok: true,
      value: [pickedImageFixture('lost.jpg')],
    });
    await expect(picker.recoverPendingPick()).resolves.toStrictEqual({ ok: true, value: [] });
  });
});
