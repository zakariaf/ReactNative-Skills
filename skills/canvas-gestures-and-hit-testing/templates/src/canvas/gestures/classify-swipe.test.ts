// src/canvas/gestures/classify-swipe.test.ts
import { classifySwipe, DEFAULT_SWIPE } from './classify-swipe';

describe('classifySwipe', () => {
  it('reads the dominant axis as a physical direction', () => {
    expect(classifySwipe({ dx: 60, dy: 5, vx: 0, vy: 0 })).toBe('right');
    expect(classifySwipe({ dx: -3, dy: -80, vx: 0, vy: 0 })).toBe('up');
  });

  it('accepts a short flick that is fast enough', () => {
    expect(classifySwipe({ dx: 0, dy: 12, vx: 0, vy: 900 })).toBe('down');
  });

  it('rejects swipes that are too short and too slow', () => {
    expect(classifySwipe({ dx: 10, dy: 0, vx: 100, vy: 0 })).toBeNull();
  });

  it('rejects diagonal swipes where no axis dominates', () => {
    expect(classifySwipe({ dx: 50, dy: 48, vx: 0, vy: 0 })).toBeNull();
  });

  it('uses per-surface thresholds when given', () => {
    const strict = { ...DEFAULT_SWIPE, minDistance: 80 };
    expect(classifySwipe({ dx: 60, dy: 0, vx: 0, vy: 0 }, strict)).toBeNull();
  });
});
