// src/feature/feature.test.ts
import { featureLabel } from './feature';

test('labels the count', () => {
  expect(featureLabel()).toBe('count 2');
});
