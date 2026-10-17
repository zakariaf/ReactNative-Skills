// src/features/timer/canvas/canvas-palettes.ts
import palettes from './canvas-palettes.json' with { type: 'json' };

import type { PaletteSet } from '@/canvas/draw-kit';

export type CanvasToken = keyof typeof palettes.light;

export const CANVAS_PALETTES: PaletteSet<CanvasToken> = palettes;
