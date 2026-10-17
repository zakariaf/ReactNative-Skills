// src/services/create-test-services.test.ts
import { createFakeClock } from '@/services/clock/fake-clock';

import { createTestServices } from './create-test-services';

describe('createTestServices', () => {
  it('returns the ports the test gives', () => {
    const clock = createFakeClock({ nowMs: 5, today: '2026-10-03' });

    expect(createTestServices({ clock }).clock).toBe(clock);
  });

  it('throws with the port name when a test uses a port it did not give', () => {
    const services = createTestServices();

    expect(() => services.errorLog.entries()).toThrow(
      'services.errorLog.entries was used, but the test gave no errorLog port',
    );
  });
});
