// src/ui/feedback/feedback-timing.test.ts
import { NOTICE_TIMING, PLACEHOLDER_TIMING } from './feedback-timing';

describe('feedback timing', () => {
  it('delays a placeholder past the flicker threshold and holds it long enough to read', () => {
    expect(PLACEHOLDER_TIMING).toStrictEqual({ showDelayMs: 300, minVisibleMs: 500 });
    expect(PLACEHOLDER_TIMING.minVisibleMs).toBeGreaterThan(PLACEHOLDER_TIMING.showDelayMs);
  });

  it('keeps a notice with an action up longer than a plain result', () => {
    expect(NOTICE_TIMING).toStrictEqual({ resultMs: 4000, actionMs: 8000 });
    expect(NOTICE_TIMING.actionMs).toBeGreaterThan(NOTICE_TIMING.resultMs);
  });
});
