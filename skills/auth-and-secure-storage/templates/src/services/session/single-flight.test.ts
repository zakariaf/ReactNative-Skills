// src/services/session/single-flight.test.ts
import { cell, singleFlight } from './single-flight';

describe('cell', () => {
  it('returns what was last set', () => {
    const count = cell(1);

    count.set(2);

    expect(count.get()).toBe(2);
  });
});

describe('singleFlight', () => {
  it('runs the work once for every caller while it is in flight, then again afterwards', async () => {
    const slot = cell<Promise<number> | null>(null);
    let runs = 0;
    const work = (): Promise<number> => {
      runs += 1;
      return Promise.resolve(runs);
    };

    const together = await Promise.all([singleFlight(slot, work), singleFlight(slot, work)]);
    const later = await singleFlight(slot, work);

    expect([together, later, slot.get()]).toStrictEqual([[1, 1], 2, null]);
  });

  it('frees the slot after a rejection too', async () => {
    const slot = cell<Promise<number> | null>(null);

    await expect(singleFlight(slot, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(slot.get()).toBeNull();
  });
});
