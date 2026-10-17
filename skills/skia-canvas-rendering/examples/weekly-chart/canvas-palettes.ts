// src/features/insights/canvas/canvas-palettes.ts
import palettes from './canvas-palettes.json' with { type: 'json' };

import type { PaletteSet } from '@/canvas/draw-kit';

/** Semantic colour tokens of the chart; the values live in canvas-palettes.json. */
export type CanvasToken = keyof typeof palettes.light;

export const CANVAS_PALETTES: PaletteSet<CanvasToken> = palettes;
