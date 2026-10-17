// test/a11y/cvd.ts
// Colour-vision-deficiency maths for tests: Machado, Oliveira & Fernandes (2009) at severity 1.0
// on linear sRGB, distance in OKLab (Ottosson 2020). One just-noticeable difference is about 0.02.
import { parseHex, toLinear } from '@/theme/contrast';

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Vector = readonly [number, number, number];
export type Deficiency = 'protanopia' | 'deuteranopia' | 'tritanopia';

export const DEFICIENCIES: readonly Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia'];

/** 3.5 JND: Okabe-Ito passes (0.076 at its closest), red/green sets fail (0.007). */
export const MIN_CVD_DISTANCE = 0.07;

const MACHADO: Readonly<Record<Deficiency, Matrix>> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
  ],
};
const LINEAR_TO_LMS: Matrix = [
  0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619,
  0.2817188376, 0.6299787005,
];
const LMS_TO_OKLAB: Matrix = [
  0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371,
  0.7827717662, -0.808675766,
];

function multiply(m: Matrix, [x, y, z]: Vector): Vector {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

function clamp01(v: Vector): Vector {
  return [
    Math.min(1, Math.max(0, v[0])),
    Math.min(1, Math.max(0, v[1])),
    Math.min(1, Math.max(0, v[2])),
  ];
}

function toOklab(linear: Vector): Vector {
  const [l, m, s] = multiply(LINEAR_TO_LMS, linear);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]);
}

/** '#RRGGBB' as a person with the deficiency sees it, in OKLab. */
export function simulatedOklab(hex: string, deficiency: Deficiency | 'none'): Vector {
  const { r, g, b } = parseHex(hex);
  const linear: Vector = [toLinear(r), toLinear(g), toLinear(b)];
  return toOklab(deficiency === 'none' ? linear : clamp01(multiply(MACHADO[deficiency], linear)));
}

/** Smallest OKLab distance between any two of the colours, as seen with the deficiency. */
export function minPairwiseDistance(
  colors: readonly string[],
  deficiency: Deficiency | 'none',
): number {
  const points = colors.map((hex) => simulatedOklab(hex, deficiency));
  let min = Number.POSITIVE_INFINITY;
  for (const [i, a] of points.entries()) {
    for (const b of points.slice(i + 1)) {
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return min;
}

/** One message per deficiency under which two of the colours come closer than the minimum. */
export function categoricalProblems(
  colors: readonly string[],
  min: number = MIN_CVD_DISTANCE,
): readonly string[] {
  return DEFICIENCIES.map(
    (deficiency) => [deficiency, minPairwiseDistance(colors, deficiency)] as const,
  )
    .filter(([, distance]) => distance < min)
    .map(
      ([deficiency, distance]) =>
        `${deficiency}: closest pair ${distance.toFixed(3)} < ${String(min)}`,
    );
}
