// src/canvas/surface-host.tsx
import { CanvasLayoutProbe } from './canvas-layout-probe';
import { SurfaceCanvas } from './surface-canvas';
import { useSurfacePlayer } from './use-surface-player';

import type { CanvasColors, CanvasHighlight, DrawKit } from './canvas-types';
import type { SurfacePlayerInput } from './use-surface-player';

export type SurfaceHostProps<TState, TEvent, TView, TToken extends string> = SurfacePlayerInput<
  TState,
  TEvent,
  TView,
  TToken
> & {
  readonly colors: CanvasColors<TToken>;
  readonly kit: DrawKit;
  /** UI-only selection and hinted targets; EMPTY_HIGHLIGHT when there are none. */
  readonly highlight: CanvasHighlight;
  /** Already translated with t() from surface.describe(view). */
  readonly accessibilityLabel: string;
  /** Default true (draw() paints every pixel first); see SurfaceCanvasProps.isOpaque. */
  readonly isOpaque?: boolean;
  /** End-to-end builds only: publish <testIdPrefix>.canvas-layout and .canvas-frame. */
  readonly probe?: { readonly testIdPrefix: string };
};

/** A display-only surface: clock, presenter, cues and lifecycle around one SurfaceCanvas. */
export function SurfaceHost<TState, TEvent, TView, TToken extends string>(
  props: SurfaceHostProps<TState, TEvent, TView, TToken>,
): React.JSX.Element {
  const { clock, size, layout } = useSurfacePlayer(props);
  const canvas = (
    <SurfaceCanvas
      surface={props.surface}
      clock={clock}
      size={size}
      layout={layout}
      colors={props.colors}
      kit={props.kit}
      highlight={props.highlight}
      accessibilityLabel={props.accessibilityLabel}
      onDrawError={props.onFailure}
      isOpaque={props.isOpaque ?? true}
    />
  );
  if (props.probe === undefined) return canvas;
  return (
    <CanvasLayoutProbe testIdPrefix={props.probe.testIdPrefix} layout={layout} clock={clock}>
      {canvas}
    </CanvasLayoutProbe>
  );
}
