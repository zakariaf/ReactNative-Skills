// test/a11y/contrast-contract.test.ts
import {
  asContract,
  colorSetsOf,
  composite,
  contractPathOf,
  contrastProblems,
  distinctProblems,
  parseJsonc,
  thresholdsOf,
} from './contrast-contract';
import { categoricalProblems } from './cvd';

import type { ContrastPalette } from './contrast-contract';

const CHART = {
  light: {
    plot: '#FFFFFF',
    label: '#1F2937',
    grid: '#6B7280',
    band: '#0072B233',
    bandEdge: '#0072B2',
    series1: '#0072B2',
    series2: '#D55E00',
    series3: '#009E73',
    series4: '#CC79A7',
  },
};

const PALETTE: ContrastPalette = {
  name: 'chart',
  file: 'src/features/stats/chart-colors.ts',
  sets: ['light'],
  base: 'plot',
  edge: 'bandEdge',
  text: [['label', 'plot']],
  graphics: [['grid', 'plot']],
  shapes: [['band', 'plot']],
  distinct: [['series1', 'series2', 'series3', 'series4']],
};

function withLight(overrides: Readonly<Record<string, string>>): typeof CHART {
  return { light: { ...CHART.light, ...overrides } };
}

describe('the contrast contract reader', () => {
  it('refuses a misspelt key at every level, because it would turn its checks off', () => {
    expect(() => asContract({ palettes: [{ ...PALETTE, grapics: [] }] })).toThrow(
      'palettes[0] has the unknown key "grapics"',
    );
    expect(() => asContract({ palettes: [], exception: [] })).toThrow(
      'the contract has the unknown key "exception"',
    );
    expect(() => asContract({ palettes: [], exceptions: [{ palette: 'chart', why: '' }] })).toThrow(
      'exceptions[0] has the unknown key "why"',
    );
  });

  it('raises the WCAG floors from the gates, never lowers them', () => {
    expect(thresholdsOf({ a11y: { textContrastMin: 7, nonTextContrastMin: 2 } })).toStrictEqual({
      text: 7,
      nonText: 3,
      cvd: 0.07,
    });
    expect(thresholdsOf(undefined)).toStrictEqual({ text: 4.5, nonText: 3, cvd: 0.07 });
  });

  it('finds the contract where check-contrast.mjs finds it', () => {
    const config = parseJsonc(
      '{\n  // moved with the other QA files\n  "contrastContract": "qa/contrast.json",\n}',
    );
    expect(contractPathOf(config)).toBe('qa/contrast.json');
    expect(contractPathOf({ contractsDir: 'qa/contracts' })).toBe('qa/contracts/contrast.json');
    expect(contractPathOf(undefined)).toBe('contracts/contrast.json');
  });
});

describe('the contrast contract helpers', () => {
  it('accepts a readable, colour-blind-safe chart palette', () => {
    const sets = colorSetsOf(PALETTE, CHART);
    expect(contrastProblems(PALETTE, sets)).toStrictEqual([]);
    expect(distinctProblems(PALETTE, sets)).toStrictEqual([]);
  });

  it('names the pair and the ratio of faint text', () => {
    const sets = colorSetsOf(PALETTE, withLight({ label: '#A8AFBB' }));
    expect(contrastProblems(PALETTE, sets)).toStrictEqual([
      'light: label on plot is 2.21:1 < 4.5:1',
    ]);
  });

  it('flags a filled shape that stands off neither its edge nor its ground', () => {
    const sets = colorSetsOf(PALETTE, withLight({ bandEdge: '#9FC4DD' }));
    expect(contrastProblems(PALETTE, sets)).toStrictEqual([
      'light: band on plot has no 3:1 edge or ground',
    ]);
  });

  it('leaves out a failure the contract records as an exception', () => {
    const sets = colorSetsOf(PALETTE, withLight({ grid: '#D1D5DB' }));
    const exception = {
      palette: 'chart',
      set: 'light',
      fg: 'grid',
      bg: 'plot',
      reason: 'decorative grid; values are labelled',
      approvedBy: 'design review',
    };
    expect(contrastProblems(PALETTE, sets)).toHaveLength(1);
    expect(contrastProblems(PALETTE, sets, { exceptions: [exception] })).toStrictEqual([]);
  });

  it('holds the pairs to a gate that quality-gates.json raises', () => {
    const min = thresholdsOf({ a11y: { nonTextContrastMin: 5 } });
    expect(contrastProblems(PALETTE, colorSetsOf(PALETTE, CHART), { min })).toStrictEqual([
      'light: grid on plot is 4.83:1 < 5:1',
      'light: band on plot has no 5:1 edge or ground',
    ]);
  });

  it('composites a translucent colour over its ground', () => {
    expect(composite('#0072B233', '#FFFFFF')).toBe('#cce3f0');
  });

  it('accepts Okabe-Ito and rejects a red/green series set', () => {
    expect(
      categoricalProblems(['#E69F00', '#56B4E9', '#009E73', '#0072B2', '#D55E00']),
    ).toStrictEqual([]);
    expect(categoricalProblems(['#D62728', '#2CA02C', '#1F77B4', '#FF7F0E'])).toContain(
      'protanopia: closest pair 0.007 < 0.07',
    );
  });
});
