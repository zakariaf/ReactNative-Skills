// src/features/__FEATURE__/canvas/draw-__SURFACE__.ts
'worklet';

import { cellRect } from '@/canvas/canvas-layout';
import { drawFittedText } from '@/canvas/draw-text';
import { sampleParticle } from '@/canvas/timeline/particles';
import { fxEntry, isPlaying } from '@/canvas/timeline/sample';

import { CHANGE_ENTITY, cellEntity } from './canvas-ids';

import type { CanvasToken } from './canvas-palettes';
import type { __SURFACE_PASCAL__View } from './to-view';
import type { CanvasTarget, Rect } from '@/canvas/canvas-layout';
import type { DrawFrame } from '@/canvas/canvas-types';
import type { SkCanvas } from '@shopify/react-native-skia';

type Frame = DrawFrame<__SURFACE_PASCAL__View, CanvasToken>;

const CORNER = 0.16;
const INSET = 0.06;
const MARK_SCALE = 0.42;
const BURST_COUNT = 18;
/** A turning cell never gets thinner than this share of its height (it stays visible). */
const MIN_FLIP = 0.06;
/** Width of a done cell's edge, as a share of the cell. */
const EDGE = 0.05;

function inset(rect: Rect, share: number): Rect {
  const by = rect.width * share;
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: rect.width - 2 * by,
    height: rect.height - 2 * by,
  };
}

/** The whole grid's rectangle (first cell to last), or null before the canvas has a size. */
function gridRect(frame: Frame): Rect | null {
  const { cols, rows } = frame.view;
  const first = cellRect(frame.layout, { regionId: 'grid', col: 0, row: 0 });
  const last = cellRect(frame.layout, { regionId: 'grid', col: cols - 1, row: rows - 1 });
  if (first === null || last === null) return null;
  const x = Math.min(first.x, last.x);
  return { x, y: first.y, width: cols * first.width, height: last.y + last.height - first.y };
}

/** Done cells carry a shape (the unit check mark) as well as a colour: never colour alone. */
function drawMark(canvas: SkCanvas, frame: Frame, rect: Rect): void {
  const mark = frame.kit.paths['mark'];
  const size = rect.width * MARK_SCALE;
  frame.kit.fill.setColor(frame.colors.color.mark);
  if (mark === undefined) {
    canvas.drawCircle(rect.x + rect.width / 2, rect.y + rect.height / 2, size / 2, frame.kit.fill);
    return;
  }
  canvas.save();
  canvas.translate(rect.x + (rect.width - size) / 2, rect.y + (rect.height - size) / 2);
  canvas.scale(size, size);
  canvas.drawPath(mark, frame.kit.fill);
  canvas.restore();
}

/** One day; a flip track turns it over: |v| is its height, the sign which face shows. */
function drawCell(canvas: SkCanvas, frame: Frame, index: number): void {
  const { view, colors, kit, fx } = frame;
  const col = index % view.cols;
  const rect = cellRect(frame.layout, {
    regionId: 'grid',
    col,
    row: Math.floor(index / view.cols),
  });
  if (rect === null) return;
  const turn = fxEntry(fx, 'flip', cellEntity(index))?.values[0] ?? 1;
  const isDoneNow = view.cells[index] === 1;
  const isDoneShown = turn < 0 ? !isDoneNow : isDoneNow;
  const face = inset(rect, INSET);
  const height = face.height * Math.max(MIN_FLIP, Math.abs(turn));
  const shown = { ...face, y: face.y + (face.height - height) / 2, height };
  const corner = rect.width * CORNER;
  kit.fill.setColor(isDoneShown ? colors.color.done : colors.color.cell);
  canvas.drawRRect({ rect: shown, rx: corner, ry: corner }, kit.fill);
  if (!isDoneShown) return;
  // The edge keeps a done cell apart from its neighbours at any palette (canvas-contrast.json).
  kit.stroke.setColor(colors.color.edge);
  kit.stroke.setStrokeWidth(Math.max(1, rect.width * EDGE));
  canvas.drawRRect({ rect: shown, rx: corner, ry: corner }, kit.stroke);
  if (Math.abs(turn) > 0.5) drawMark(canvas, frame, face);
}

function drawRing(canvas: SkCanvas, frame: Frame, target: CanvasTarget): void {
  const rect = target.regionId === 'grid' ? cellRect(frame.layout, target) : null;
  if (rect === null) return;
  frame.kit.stroke.setColor(frame.colors.color.hint);
  frame.kit.stroke.setStrokeWidth(Math.max(2, rect.width * 0.08));
  const ring = inset(rect, INSET / 2);
  canvas.drawRRect(
    { rect: ring, rx: rect.width * CORNER, ry: rect.width * CORNER },
    frame.kit.stroke,
  );
}

/** The screen's highlight: a ring around each hinted day and the selected one. */
function drawHighlight(canvas: SkCanvas, frame: Frame): void {
  for (const target of frame.highlight.hinted) drawRing(canvas, frame, target);
  if (frame.highlight.selected !== null) drawRing(canvas, frame, frame.highlight.selected);
}

/** Every day done: a fading glow, then particles from the grid's centre (full motion only). */
function drawGoal(canvas: SkCanvas, frame: Frame, grid: Rect): void {
  const { kit, colors, fx } = frame;
  const glow = fxEntry(fx, 'glow', CHANGE_ENTITY);
  if (isPlaying(glow)) {
    kit.fill.setColor(colors.color.glow);
    kit.fill.setAlphaf((glow.values[0] ?? 0) * 0.6);
    canvas.drawRRect({ rect: grid, rx: 12, ry: 12 }, kit.fill);
    kit.fill.setAlphaf(1);
  }
  const burst = fxEntry(fx, 'burst', CHANGE_ENTITY);
  if (!isPlaying(burst)) return;
  const spec = {
    seed: frame.view.cols * 31 + frame.view.rows,
    x: grid.x + grid.width / 2,
    y: grid.y + grid.height / 2,
    count: BURST_COUNT,
    minSpeed: 80,
    maxSpeed: 260,
    gravity: 420,
    lifeMs: 700,
  };
  kit.fill.setColor(colors.color.glow);
  for (let i = 0; i < spec.count; i += 1) {
    const particle = sampleParticle(spec, i, burst.ageMs);
    kit.fill.setAlphaf(particle.alpha);
    canvas.drawCircle(particle.x, particle.y, grid.width * 0.012, kit.fill);
  }
  kit.fill.setAlphaf(1);
}

/** The streak grew: its localised number pops in the middle of the grid. */
function drawStreak(canvas: SkCanvas, frame: Frame, grid: Rect): void {
  const streak = fxEntry(frame.fx, 'streak', CHANGE_ENTITY);
  const font = frame.kit.numberFont;
  if (!isPlaying(streak) || font === null) return;
  const size = (Math.min(grid.width, grid.height) / 2) * (streak.values[0] ?? 1);
  const rect = {
    x: grid.x + (grid.width - size) / 2,
    y: grid.y + (grid.height - size) / 2,
    width: size,
    height: size,
  };
  // The label sits on a plate of its declared ground ('label' on 'cell' in canvas-contrast.json).
  frame.kit.fill.setColor(frame.colors.color.cell);
  canvas.drawRRect({ rect, rx: size * CORNER, ry: size * CORNER }, frame.kit.fill);
  frame.kit.fill.setColor(frame.colors.color.label);
  drawFittedText(canvas, { text: frame.view.streakText, rect }, { font, paint: frame.kit.fill });
}

/** Pure worklet: reads only its arguments, allocates no Skia objects, reads no clock. */
export function draw__SURFACE_PASCAL__(canvas: SkCanvas, frame: Frame): void {
  canvas.drawColor(frame.colors.color.background);
  for (let i = 0; i < frame.view.cells.length; i += 1) drawCell(canvas, frame, i);
  drawHighlight(canvas, frame);
  const grid = gridRect(frame);
  if (grid === null) return;
  drawGoal(canvas, frame, grid);
  drawStreak(canvas, frame, grid);
}
