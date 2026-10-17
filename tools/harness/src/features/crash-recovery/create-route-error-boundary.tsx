// src/features/crash-recovery/create-route-error-boundary.tsx
// Builds the component a route file exports as `ErrorBoundary` (Expo Router wraps that route, a
// layout included, in a React error boundary). Expo Router's boundary records nothing, so this one
// records the caught error once, then renders the app's fallback. The fallback has one way out and
// never retries by itself: retrying a render error that happens every time is a crash loop.
import { useEffect } from 'react';

import type { ErrorBoundaryProps } from 'expo-router';
import type { ComponentType } from 'react';

/** What the app's fallback screen receives: the one way out, called only from a user action. */
export type CrashFallbackProps = { readonly onRestart: () => void };

export type RouteErrorBoundaryOptions = {
  /** Records the caught error (the error net's report). Must not throw. */
  readonly record: (error: unknown) => void;
  /**
   * The fallback screen. Under the root layout it renders outside every provider that layout
   * mounts, so it reads no context (copy, theme or stores from providers would throw here).
   */
  readonly Fallback: ComponentType<CrashFallbackProps>;
  /** The way out; default: re-render the route (`retry`). The root layout may reload the app. */
  readonly restart?: (retry: ErrorBoundaryProps['retry']) => Promise<void>;
};

/** A route's `ErrorBoundary` export: a function component Expo Router renders with the error. */
export type RouteErrorBoundary = (props: ErrorBoundaryProps) => React.JSX.Element;

/** Returns an `ErrorBoundary` component for a route file to export. */
export function createRouteErrorBoundary(options: RouteErrorBoundaryOptions): RouteErrorBoundary {
  const { record, Fallback } = options;
  const restart = options.restart ?? ((retry: ErrorBoundaryProps['retry']) => retry());
  return function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps): React.JSX.Element {
    useEffect(() => {
      record(error);
    }, [error]);
    const handleRestart = (): void => {
      restart(retry).catch(record);
    };
    return <Fallback onRestart={handleRestart} />;
  };
}
