// src/ui/icons/brand-mark-art.ts
// The brand mark as data and its drawing: multi-colour line art on a 48-unit grid whose colours are
// theme roles, so the in-app tile, the app icon (light, dark, tinted, Android) and the splash are
// one design in every scheme. It imports Skia TYPES only and takes the Skia API as a parameter, so
// the same code runs in the app, in CanvasKit goldens and in Node art scripts (type stripping).
import type { ColorTokens } from '@/theme/theme-types';
import type { SkCanvas, Skia } from '@shopify/react-native-skia';

/** The Skia API object (native, CanvasKit in goldens, or headless in Node scripts). */
export type SkiaApi = typeof Skia;

/** The mark's grid: a viewBox of 0 0 48 48. Keep 2 units clear at the edges. */
export const BRAND_GRID = 48;

/** A colour role of the theme (never a hex value: the scheme decides the colour). */
export type ColorRole = keyof ColorTokens;

/** Rotation in degrees about (cx, cy) on the 48 grid, like SVG rotate(deg cx cy). */
export type MarkRotation = { readonly deg: number; readonly cx: number; readonly cy: number };

/** One shape: filled, stroked, or both (the fill first, then its edge). */
export type BrandLayer = {
  readonly d: string;
  readonly fill?: ColorRole;
  readonly stroke?: ColorRole;
  /** Stroke width on the 48 grid; default 2.6. */
  readonly width?: number;
  /** Default 'round' for lines, 'butt' for the edge of a filled shape. */
  readonly cap?: 'butt' | 'round';
  readonly rotate?: MarkRotation;
};

/** The app's mark: the colour role of its tile and its layers in draw order. */
export type BrandMark = { readonly tile: ColorRole; readonly layers: readonly BrandLayer[] };

/** One paint operation; `isCut` erases (the monochrome icon cuts its lines out of its fills). */
export type MarkOp = {
  /** Stable React key: the layer's draw position and the paint (layers never reorder). */
  readonly key: string;
  readonly d: string;
  readonly style: 'fill' | 'stroke';
  readonly color: string;
  readonly width: number;
  readonly cap: 'butt' | 'round';
  readonly isCut: boolean;
  readonly rotate?: MarkRotation;
};

const DEFAULT_WIDTH = 2.6;

type Paint = Omit<MarkOp, 'key' | 'd' | 'rotate'>;

function layerPaints(layer: BrandLayer, colorOf: (role: ColorRole) => string): Paint[] {
  const paints: Paint[] = [];
  if (layer.fill !== undefined) {
    paints.push({ style: 'fill', color: colorOf(layer.fill), width: 0, cap: 'butt', isCut: false });
  }
  if (layer.stroke !== undefined) {
    const cap = layer.cap ?? (layer.fill === undefined ? 'round' : 'butt');
    const width = layer.width ?? DEFAULT_WIDTH;
    paints.push({ style: 'stroke', color: colorOf(layer.stroke), width, cap, isCut: false });
  }
  return paints;
}

function withShape(layer: BrandLayer, index: number, paints: readonly Paint[]): MarkOp[] {
  return paints.map((paint) => ({
    ...paint,
    key: `${String(index)}-${paint.style}`,
    d: layer.d,
    ...(layer.rotate === undefined ? {} : { rotate: layer.rotate }),
  }));
}

/** Layers (a mark's or a picture's) in one scheme's colours, in draw order (a fill before its edge). */
export function layerOps(layers: readonly BrandLayer[], colors: ColorTokens): readonly MarkOp[] {
  return layers.flatMap((layer, index) =>
    withShape(
      layer,
      index,
      layerPaints(layer, (role) => colors[role]),
    ),
  );
}

/** The mark in one scheme's colours. */
export function markOps(mark: BrandMark, colors: ColorTokens): readonly MarkOp[] {
  return layerOps(mark.layers, colors);
}

/**
 * The silhouette for Android's themed (monochrome) icon, which launchers draw from alpha alone:
 * shapes with a fill are painted in `ink` with their edge, lines without a fill are cut out of what
 * lies below. The art script passes opaque white, as Android's guidelines draw it.
 */
export function monoOps(mark: BrandMark, ink: string): readonly MarkOp[] {
  return mark.layers.flatMap((layer, index) => {
    const isLine = layer.fill === undefined;
    const paints = layerPaints(layer, () => ink).map((paint) => ({ ...paint, isCut: isLine }));
    return withShape(layer, index, paints);
  });
}

// Numeric values of Skia's PaintStyle, StrokeCap, StrokeJoin and BlendMode enums (types-only import).
const STYLE_FILL = 0;
const STYLE_STROKE = 1;
const CAP_BUTT = 0;
const CAP_ROUND = 1;
const JOIN_ROUND = 1;
const BLEND_CLEAR = 0;

/** Draws the mark into a size x size square at the canvas origin. */
export function drawMark(
  skia: SkiaApi,
  canvas: SkCanvas,
  art: { readonly ops: readonly MarkOp[]; readonly size: number },
): void {
  canvas.save();
  canvas.scale(art.size / BRAND_GRID, art.size / BRAND_GRID);
  for (const op of art.ops) {
    const path = skia.Path.MakeFromSVGString(op.d);
    if (path === null) throw new Error(`Bad brand mark path: ${op.d}`);
    const paint = skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(skia.Color(op.color));
    paint.setStyle(op.style === 'fill' ? STYLE_FILL : STYLE_STROKE);
    paint.setStrokeWidth(op.width);
    paint.setStrokeCap(op.cap === 'round' ? CAP_ROUND : CAP_BUTT);
    paint.setStrokeJoin(JOIN_ROUND);
    if (op.isCut) paint.setBlendMode(BLEND_CLEAR);
    canvas.save();
    if (op.rotate !== undefined) canvas.rotate(op.rotate.deg, op.rotate.cx, op.rotate.cy);
    canvas.drawPath(path, paint);
    canvas.restore();
  }
  canvas.restore();
}
