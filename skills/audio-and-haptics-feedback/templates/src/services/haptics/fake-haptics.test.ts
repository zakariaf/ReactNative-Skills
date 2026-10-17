// src/services/haptics/fake-haptics.test.ts
import { createFakeHaptics } from './fake-haptics';

describe('createFakeHaptics', () => {
  it('records every cue it is asked to play', () => {
    const haptics = createFakeHaptics();
    haptics.play('light');
    haptics.play('success');
    expect(haptics.isSupported).toBe(true);
    expect(haptics.played).toStrictEqual(['light', 'success']);
  });

  it('stands in for an iPad, which has no haptic engine', () => {
    expect(createFakeHaptics(false).isSupported).toBe(false);
  });
});
