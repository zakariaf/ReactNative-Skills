// src/games/__GAME_ID__/canvas/canvas-palettes.ts
import palettes from './canvas-palettes.json' with { type: 'json' };

import type { PaletteSet } from '@/canvas/draw-kit';

/** Semantic colour tokens of the arena; the values live in canvas-palettes.json. */
export type CanvasToken = keyof typeof palettes.light;

/** light and dark, checked against the PaletteSet shape (a missing token is a type error). */
export const CANVAS_PALETTES: PaletteSet<CanvasToken> = palettes;
