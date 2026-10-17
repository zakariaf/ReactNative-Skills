// src/services/local-zone/fake-local-zone.ts
import type { OffsetAt } from '@/core/reminders/wall-clock';
import type { LocalZonePort } from '@/services/local-zone/local-zone-port';

/** A LocalZonePort whose rules a test sets; `travel` swaps them, as a flight to another zone does. */
export type FakeLocalZone = LocalZonePort & {
  readonly travel: (offsetAt: OffsetAt) => void;
};

/** Starts in `offsetAt` (default: UTC all year). Rule zones for tests: test/reminders/rule-zone.ts. */
export function createFakeLocalZone(offsetAt: OffsetAt = () => 0): FakeLocalZone {
  let rules = offsetAt;
  return {
    offsetAt: (instantMs) => rules(instantMs),
    travel: (next) => {
      rules = next;
    },
  };
}
