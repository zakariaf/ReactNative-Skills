// src/canvas/canvas-types.ts
// The contract between the canvas kit (src/canvas) and every surface (src/features/<feature>/canvas).
// Touch input (canvas-gestures-and-hit-testing) builds on PointerSample, CanvasHighlight and the
// layout types: renaming a member here is a breaking change for both.
import type { CanvasLayout, CanvasTarget } from './canvas-layout';
import type { FxSample } from './timeline/sample';
import type {
  SkCanvas,
  SkColor,
  SkFont,
  SkPaint,
  SkParagraph,
  SkPath,
  Skia,
} from '@shopify/react-native-skia';

/** Finger state on the UI thread (drag previews, hover rings). Never goes through React. */
export type PointerSample = {
  readonly isDown: boolean;
  readonly x: number;
  readonly y: number;
  readonly hover: CanvasTarget | null;
  readonly dragFrom: CanvasTarget | null;
};

/** The Skia API object (the device module, Jest's CanvasKit, or headless getSkiaExports().Skia). */
export type SkiaApi = typeof Skia;

export const IDLE_POINTER: PointerSample = {
  isDown: false,
  x: 0,
  y: 0,
  hover: null,
  dragFrom: null,
};

/** Everything that changes per frame on the UI thread: the timeline sample plus the pointer. */
export type CanvasFx = FxSample & { readonly pointer: PointerSample };

/**
 * What the surface highlights: UI state the screen holds, never domain state (stores, undo and
 * persistence never see it). It changes on taps and hints only, so it travels as a prop and
 * reaches draw() as frame.highlight.
 */
export type CanvasHighlight = {
  /** The target a tap selected (a tap-then-tap selection, the focused day). */
  readonly selected: CanvasTarget | null;
  /** Targets to ring (a suggested action, today's cell); CanvasSurface.targetsOf builds them. */
  readonly hinted: readonly CanvasTarget[];
};

/** Nothing selected, nothing hinted. */
export const EMPTY_HIGHLIGHT: CanvasHighlight = { selected: null, hinted: [] };

/** Palette tokens resolved to Skia colours once per palette set (light, dark, ...). */
export type CanvasColors<TToken extends string> = {
  /** The palette set the colours came from ('light', 'dark', or an opt-in set). */
  readonly set: string;
  readonly color: Readonly<Record<TToken, SkColor>>;
};

/** Skia objects built once on the JS thread and reused every frame (no per-frame allocation). */
export type DrawKit = {
  /** Scratch fill paint: set the colour and alpha immediately before each draw call. */
  readonly fill: SkPaint;
  /** Scratch stroke paint. */
  readonly stroke: SkPaint;
  /** Bundled font for digits and Latin text via drawText (no shaping needed). */
  readonly numberFont: SkFont | null;
  /** Unit-size (0…1) paths, drawn with canvas.scale and canvas.translate. */
  readonly paths: Readonly<Partial<Record<string, SkPath>>>;
  /** Shaped, laid-out paragraphs for words, Arabic-script and other complex-script text. */
  readonly labels: Readonly<Partial<Record<string, SkParagraph>>>;
};

/** The six inputs of draw(), grouped into one object (max-params is 3). */
export type DrawFrame<TView, TToken extends string> = {
  readonly view: TView;
  readonly fx: CanvasFx;
  /** The screen's selection and hinted targets (EMPTY_HIGHLIGHT when there are none). */
  readonly highlight: CanvasHighlight;
  readonly colors: CanvasColors<TToken>;
  readonly layout: CanvasLayout;
  readonly kit: DrawKit;
};

export type LayoutInput<TView> = {
  readonly width: number;
  readonly height: number;
  readonly view: TView;
  readonly isMirrored: boolean;
};

/** Number formatting from the app's i18n layer, applied in toView (digits arrive localised). */
export type ViewFormat = { readonly formatNumber: (value: number) => string };

/** A catalog message id plus values; the screen renders it with t() for the canvas label. */
export type A11yMessage = {
  readonly id: string;
  readonly values: Readonly<Record<string, number | string>>;
};

/**
 * The rendering members of one canvas surface (src/features/<feature>/canvas/<id>-surface.ts).
 * TAction is only needed by surfaces that implement targetsOf.
 */
export type CanvasSurface<TState, TView, TToken extends string, TAction = unknown> = {
  /** Whether positions mirror in right-to-left locales (a time axis does; a photo does not). */
  readonly isMirroredInRtl: boolean;
  /** JS thread, pure: state → a flat, serialisable view with digits already localised. */
  readonly toView: (state: TState, format: ViewFormat) => TView;
  /** Worklet: canvas size → layout. Used by draw AND hit-testing. */
  readonly layout: (input: LayoutInput<TView>) => CanvasLayout;
  /** Worklet: paints one frame. Allocates no Skia objects, reads no clock or random source. */
  readonly draw: (canvas: SkCanvas, frame: DrawFrame<TView, TToken>) => void;
  /** JS thread: builds the unit paths once per kit (Skia.PathBuilder). */
  readonly buildPaths: (skia: SkiaApi) => Readonly<Partial<Record<string, SkPath>>>;
  /** The spoken summary (Skia content is invisible to VoiceOver and TalkBack). */
  readonly describe: (view: TView) => A11yMessage;
  /**
   * Points the gesture layer lifts the drag pointer above the finger (hover, preview and drop
   * target alike); default 0. A surface with a lift keeps at least that much canvas below its
   * last row, so the edge rows stay reachable.
   */
  readonly dragLiftPt?: number;
  /** Optional: the targets an action touches, so the screen can ring a suggested action. */
  targetsOf?(state: TState, action: TAction): readonly CanvasTarget[];
};
