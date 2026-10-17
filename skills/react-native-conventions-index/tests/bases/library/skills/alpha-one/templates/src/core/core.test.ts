// src/core/core.test.ts
import { useCount } from './core';

test('starts at two', () => {
  expect(useCount.getState().count).toBe(2);
});
