// src/ui/subtree-error-boundary.tsx
// The one class component an app needs: React 19 has no hook that catches a render error. Wrap a
// part of a screen that can fail on its own (a canvas, a chart, a WebView, a third-party widget) so
// the rest of the screen keeps working. A whole route fails into Expo Router's ErrorBoundary export
// instead (error-handling-typed-results), and errors in handlers, promises and worklets never reach
// any boundary: catch and record them where they happen.
import { Component } from 'react';

import type { ErrorInfo, ReactNode } from 'react';

export type SubtreeErrorBoundaryProps = {
  readonly children: ReactNode;
  /** Records the error (the error net's report or the error log port). Must not throw. */
  readonly onError: (error: unknown, componentStack: string) => void;
  /**
   * What shows instead: one way out, `reset`, called only from a user action. Never retry from an
   * effect or a timer: a render error that happens every time becomes a crash loop.
   */
  readonly renderFallback: (reset: () => void) => ReactNode;
};

type BoundaryState = { readonly hasError: boolean };

export class SubtreeErrorBoundary extends Component<SubtreeErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info.componentStack ?? '');
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    return this.state.hasError ? this.props.renderFallback(this.reset) : this.props.children;
  }
}
