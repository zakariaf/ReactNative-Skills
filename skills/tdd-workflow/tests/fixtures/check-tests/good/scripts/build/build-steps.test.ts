// scripts/build/build-steps.test.ts
import { buildSteps } from './build-steps';

describe('buildSteps', () => {
  it('lists prebuild first', () => {
    expect(buildSteps('preview')[0]).toBe('prebuild');
  });
});
