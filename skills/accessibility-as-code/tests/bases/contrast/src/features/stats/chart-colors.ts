// src/features/stats/chart-colors.ts
// The weekly progress chart's colours: series from Okabe-Ito (colour-blind safe), each line also
// carries a marker shape and a legend label, so colour is never the only cue.
export const CHART_COLORS = {
  light: {
    plot: '#FFFFFF',
    label: '#1F2937',
    grid: '#6B7280',
    series1: '#0072B2',
    series2: '#D55E00',
    series3: '#009E73',
    series4: '#CC79A7',
    band: '#0072B233',
    bandEdge: '#0072B2',
    marker: '#B35900',
    markerLabel: '#FFFFFF',
  },
  dark: {
    plot: '#111827',
    label: '#F3F4F6',
    grid: '#9CA3AF',
    series1: '#56B4E9',
    series2: '#E69F00',
    series3: '#F0E442',
    series4: '#CC79A7',
    band: '#56B4E933',
    bandEdge: '#56B4E9',
    marker: '#E69F00',
    markerLabel: '#111827',
  },
} as const;
