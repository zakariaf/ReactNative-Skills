// test/flush-microtasks.ts — lets every queued promise callback run, without fake timers.
// Use it for promises that settle outside React (a service over a fake port); for anything on
// screen, await screen.findBy...(...) instead.
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
