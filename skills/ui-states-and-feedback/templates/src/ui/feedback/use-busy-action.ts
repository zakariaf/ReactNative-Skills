// src/ui/feedback/use-busy-action.ts
import { useRef, useState } from 'react';

export type BusyAction = {
  /** True from the press until the work settled: the control shows its busy state (isBusy). */
  readonly isBusy: boolean;
  /** Starts the work; a press while it runs is ignored, so a double tap never writes twice. */
  readonly start: () => void;
};

/**
 * In-flight feedback on the control that started the work, never an overlay over the screen. The
 * work must not reject (it returns a Result and reports its own failure); a rejection that still
 * escapes goes to `onError`, and the control is usable again either way.
 */
export function useBusyAction(
  work: () => Promise<unknown>,
  onError: (error: unknown) => void,
): BusyAction {
  const [isBusy, setIsBusy] = useState(false);
  const isRunning = useRef(false);
  return {
    isBusy,
    start: () => {
      if (isRunning.current) return;
      isRunning.current = true;
      setIsBusy(true);
      work()
        .catch(onError)
        .finally(() => {
          isRunning.current = false;
          setIsBusy(false);
        });
    },
  };
}
