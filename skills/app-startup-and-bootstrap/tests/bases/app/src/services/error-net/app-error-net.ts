// src/services/error-net/app-error-net.ts (fixture stand-in for error-handling-typed-results' net)
export const appErrorNet = {
  install: (): (() => void) => () => undefined,
  connect: (sink: (report: unknown) => void): void => {
    sink(null);
  },
  report: (report: unknown): void => {
    String(report);
  },
};
