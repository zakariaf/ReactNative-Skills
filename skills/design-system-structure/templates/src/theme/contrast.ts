// src/theme/contrast.ts
export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/** '#RRGGBB' -> channels 0..1. A contrast ratio needs opaque colours, so #RRGGBBAA is refused. */
export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`Not an opaque #RRGGBB colour: ${hex}`);
  const [, r = '0', g = '0', b = '0'] = match;
  return { r: parseInt(r, 16) / 255, g: parseInt(g, 16) / 255, b: parseInt(b, 16) / 255 };
}

/** sRGB transfer function, WCAG 2.2 definition (threshold 0.04045). */
export function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
