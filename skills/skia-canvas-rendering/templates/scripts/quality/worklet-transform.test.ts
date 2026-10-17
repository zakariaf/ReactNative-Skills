// scripts/quality/worklet-transform.test.ts — proves the Worklets Babel plugin really workletizes
// files that use the file-level 'worklet' directive after a leading path comment.
import { tickClock } from '@/canvas/scene';

describe('file-level worklet directive', () => {
  it('compiles every top-level function of a directive file into a worklet', () => {
    expect(tickClock).toHaveProperty('__workletHash', expect.any(Number));
  });
});
