// src/ui/feedback/notice-timer.ts
import { AccessibilityInfo } from 'react-native';

/**
 * Calls `close` after the person's recommended timeout for `floorMs` (Android's "Time to take
 * action" setting; iOS answers floorMs), never sooner than floorMs. Returns the cancel, which also
 * covers an answer that arrives after it ran.
 */
export function scheduleNoticeClose(floorMs: number, close: () => void): () => void {
  let isActive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const start = (recommendedMs: number): void => {
    if (!isActive) return;
    timer = setTimeout(close, Math.max(recommendedMs, floorMs));
  };
  AccessibilityInfo.getRecommendedTimeoutMillis(floorMs).then(start, () => {
    start(floorMs);
  });
  return () => {
    isActive = false;
    if (timer !== null) clearTimeout(timer);
  };
}
