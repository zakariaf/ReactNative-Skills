// src/games/__GAME_ID__/canvas/draw-arena.ts
'worklet';

import { ARENA, bodyCount } from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';

import type { CanvasToken } from './canvas-palettes';
import type { SimFrame } from '@/canvas/realtime/record-sim';
import type { __GAME_PASCAL__Sim } from '@/games/__GAME_ID__/sim/__GAME_ID__-sim';
import type { SkCanvas } from '@shopify/react-native-skia';

type Frame = SimFrame<__GAME_PASCAL__Sim, CanvasToken>;

const PLAYER_RADIUS = 18;
const ENTITY_RADIUS = 12;
const RING_WIDTH = 4;

/**
 * Pure worklet: reads the live sim in place and scales the square world to the canvas, with a
 * margin of one player radius so a body on the arena edge is never clipped. Free-form worlds need
 * no layout regions. Over ~100 identical sprites, draw them as one atlas call instead.
 */
export function drawArena(canvas: SkCanvas, frame: Frame): void {
  const { sim, colors, kit } = frame;
  const scale = Math.min(frame.width, frame.height) / (ARENA + 2 * PLAYER_RADIUS);
  const offsetX = (frame.width - ARENA * scale) / 2;
  const offsetY = (frame.height - ARENA * scale) / 2;
  canvas.drawColor(colors.color.background);
  const count = bodyCount(sim);
  kit.fill.setColor(colors.color.enemy);
  for (let e = 1; e < count; e += 1) {
    const x = offsetX + (sim.body[e * 4] ?? 0) * scale;
    const y = offsetY + (sim.body[e * 4 + 1] ?? 0) * scale;
    canvas.drawCircle(x, y, ENTITY_RADIUS * scale, kit.fill);
  }
  const playerX = offsetX + (sim.body[0] ?? 0) * scale;
  const playerY = offsetY + (sim.body[1] ?? 0) * scale;
  kit.fill.setColor(colors.color.player);
  canvas.drawCircle(playerX, playerY, PLAYER_RADIUS * scale, kit.fill);
  kit.stroke.setColor(colors.color.ring);
  kit.stroke.setStrokeWidth(RING_WIDTH * scale);
  canvas.drawCircle(playerX, playerY, (PLAYER_RADIUS - RING_WIDTH / 2) * scale, kit.stroke);
}
