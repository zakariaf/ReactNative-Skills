// wcag.mjs: WCAG 2.2 contrast and colour-vision-deficiency (CVD) maths, the same formulas as the
// app's src/theme/contrast.ts and test/a11y/cvd.ts templates. Not an entry point.

export function parseHex(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!match) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return { r: parseInt(match[1], 16) / 255, g: parseInt(match[2], 16) / 255, b: parseInt(match[3], 16) / 255 };
}

/** sRGB transfer function, WCAG 2.2 definition (threshold 0.04045). */
export function toLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Machado, Oliveira & Fernandes (2009), severity 1.0. */
const MACHADO = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const LINEAR_TO_LMS = [0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005];
const LMS_TO_OKLAB = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766];

const multiply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const clamp01 = (v) => v.map((c) => Math.min(1, Math.max(0, c)));

export const DEFICIENCIES = ['protanopia', 'deuteranopia', 'tritanopia'];

export function simulatedOklab(hex, deficiency) {
  const { r, g, b } = parseHex(hex);
  const linear = [toLinear(r), toLinear(g), toLinear(b)];
  const seen = deficiency === 'none' ? linear : clamp01(multiply(MACHADO[deficiency], linear));
  const [l, m, s] = multiply(LINEAR_TO_LMS, seen);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]);
}

/** Smallest OKLab distance between any two colours as seen with the deficiency (0.02 = 1 JND). */
export function minPairwiseDistance(colors, deficiency) {
  const points = colors.map((hex) => simulatedOklab(hex, deficiency));
  let min = Number.POSITIVE_INFINITY;
  let pair = null;
  points.forEach((a, i) => {
    points.slice(i + 1).forEach((b, k) => {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < min) {
        min = d;
        pair = [colors[i], colors[i + 1 + k]];
      }
    });
  });
  return { distance: min, pair };
}

/** #RRGGBBAA (or #RRGGBB) drawn over an opaque #RRGGBB ground, as the opaque colour the eye sees. */
export function composite(hex, ground) {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex));
  if (!match) throw new Error(`Not a #RRGGBB(AA) colour: ${hex}`);
  if (match[2] === undefined) return `#${match[1]}`;
  const alpha = parseInt(match[2], 16) / 255;
  const fg = parseHex(`#${match[1]}`);
  const bg = parseHex(ground);
  const channel = (a, b) => Math.round((a * alpha + b * (1 - alpha)) * 255).toString(16).padStart(2, '0');
  return `#${channel(fg.r, bg.r)}${channel(fg.g, bg.g)}${channel(fg.b, bg.b)}`;
}

/** 3.5 just-noticeable differences in OKLab: Okabe-Ito passes (0.076), red/green sets fail (0.007). */
export const MIN_CVD_DISTANCE = 0.07;
