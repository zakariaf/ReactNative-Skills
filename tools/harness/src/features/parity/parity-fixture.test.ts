// src/features/parity/parity-fixture.test.ts
import { PARITY_FIXTURE, parityDataFor } from './parity-fixture';

describe('the parity fixture', () => {
  it('loads and draws its rows in the render language', () => {
    const data = parityDataFor(PARITY_FIXTURE, 'ar', 'design');

    expect(data.day).toBe(PARITY_FIXTURE.day);
    expect(data.tasks).toHaveLength(PARITY_FIXTURE.tasks.length);
    expect(data.tasks[0]).toStrictEqual({ id: 'milk', title: 'شراء الحليب', isDone: false });
    expect(data.lists.map((list) => list.id)).toStrictEqual(
      PARITY_FIXTURE.lists.map((list) => list.id),
    );
  });

  it('writes nothing for an empty frame', () => {
    expect(parityDataFor(PARITY_FIXTURE, 'en', 'empty')).toStrictEqual({
      day: PARITY_FIXTURE.day,
      tasks: [],
      lists: [],
    });
  });
});
