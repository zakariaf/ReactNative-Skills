// src/services/install-marker/fake-install-marker.test.ts
import { createFakeInstallMarker } from './fake-install-marker';

describe('createFakeInstallMarker', () => {
  it('starts as a known install unless told it is fresh', () => {
    expect(createFakeInstallMarker().isPresent()).toStrictEqual({ ok: true, value: true });
    expect(createFakeInstallMarker({ isPresent: false }).isPresent()).toStrictEqual({
      ok: true,
      value: false,
    });
  });

  it('writes and clears the marker', () => {
    const marker = createFakeInstallMarker({ isPresent: false });

    marker.write();
    const wasSetAfterWrite = marker.isSet();
    marker.clear();

    expect([wasSetAfterWrite, marker.isSet()]).toStrictEqual([true, false]);
  });

  it('fails every operation when failing', () => {
    const marker = createFakeInstallMarker({ isFailing: true });
    const failure = { ok: false, error: { kind: 'install-marker-unavailable' } };

    expect([marker.isPresent(), marker.write(), marker.clear()]).toStrictEqual([
      failure,
      failure,
      failure,
    ]);
    expect(marker.isSet()).toBe(true);
  });
});
