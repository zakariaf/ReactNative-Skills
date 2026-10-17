// src/features/insights/canvas/draw-chart.ts
'worklet';

import { cellRect } from '@/canvas/canvas-layout';
import { drawFittedText } from '@/canvas/draw-text';
import { fxEntry, isPlaying } from '@/canvas/timeline/sample';

import type { CanvasToken } from './canvas-palettes';
import type { WeeklyChartView } from './to-view';
import type { CanvasLayout, Rect } from '@/canvas/canvas-layout';
import type { DrawFrame } from '@/canvas/canvas-types';
import type { SkCanvas } from '@shopify/react-native-skia';

type Frame = DrawFrame<WeeklyChartView, CanvasToken>;

const BAR_INSET = 0.18;

/** The plot's bottom edge and height, from the 'bars' region. */
function plotOf(layout: CanvasLayout): { readonly bottom: number; readonly height: number } | null {
  const region = layout.regions.find((entry) => entry.id === 'bars');
  if (region === undefined || region.cell <= 0) return null;
  return { bottom: region.y + region.rows * region.cell, height: region.rows * region.cell };
}

/**
 * A bar's rectangle at a (possibly mid-tween) value: the bar tween reads its held `from` at moment 0.
 * Clamped to the plot: a falling bar from last week may stand above this week's scale.
 */
function barRect(frame: Frame, day: number, value: number): Rect | null {
  const slot = cellRect(frame.layout, { regionId: 'bars', col: day, row: 0 });
  const plot = plotOf(frame.layout);
  if (slot === null || plot === null) return null;
  const height = Math.min(1, Math.max(0, value) / frame.view.scaleMax) * plot.height;
  const inset = slot.width * BAR_INSET;
  return { x: slot.x + inset, y: plot.bottom - height, width: slot.width - 2 * inset, height };
}

function drawBars(canvas: SkCanvas, frame: Frame): void {
  const { kit, colors, fx, view } = frame;
  for (let day = 0; day < view.done.length; day += 1) {
    const value = fxEntry(fx, 'bar', day)?.values[0] ?? view.done[day] ?? 0;
    const rect = barRect(frame, day, value);
    if (rect === null || rect.height <= 0) continue;
    kit.fill.setColor(colors.color.bar);
    canvas.drawRRect({ rect, rx: rect.width / 4, ry: rect.width / 4 }, kit.fill);
    // An effect, not a tween of something visible: it waits for its track.
    const flash = fxEntry(fx, 'flash', day);
    if (!isPlaying(flash)) continue;
    kit.fill.setColor(colors.color.flash);
    kit.fill.setAlphaf(flash.values[0] ?? 0);
    canvas.drawRRect({ rect, rx: rect.width / 4, ry: rect.width / 4 }, kit.fill);
    kit.fill.setAlphaf(1);
  }
}

function drawGoal(canvas: SkCanvas, frame: Frame): void {
  const plot = plotOf(frame.layout);
  const first = cellRect(frame.layout, { regionId: 'bars', col: 0, row: 0 });
  const last = cellRect(frame.layout, { regionId: 'bars', col: 6, row: 0 });
  if (plot === null || first === null || last === null) return;
  const y = plot.bottom - (frame.view.goal / frame.view.scaleMax) * plot.height;
  frame.kit.stroke.setColor(frame.colors.color.goal);
  frame.kit.stroke.setStrokeWidth(2);
  canvas.drawLine(
    Math.min(first.x, last.x),
    y,
    Math.max(first.x, last.x) + first.width,
    y,
    frame.kit.stroke,
  );
}

function drawLabels(canvas: SkCanvas, frame: Frame): void {
  const font = frame.kit.numberFont;
  if (font === null) return;
  frame.kit.fill.setColor(frame.colors.color.label);
  for (let day = 0; day < frame.view.labels.length; day += 1) {
    const rect = cellRect(frame.layout, { regionId: 'labels', col: day, row: 0 });
    const text = frame.view.labels[day];
    if (rect === null || text === undefined) continue;
    drawFittedText(canvas, { text, rect, maxShare: 0.6 }, { font, paint: frame.kit.fill });
  }
}

/** The selected day: a ring around its whole column (a tap anywhere in the column selects it). */
function drawSelection(canvas: SkCanvas, frame: Frame): void {
  const selected = frame.highlight.selected;
  const plot = plotOf(frame.layout);
  if (selected?.regionId !== 'bars' || plot === null) return;
  const slot = cellRect(frame.layout, { regionId: 'bars', col: selected.col, row: 0 });
  if (slot === null) return;
  frame.kit.stroke.setColor(frame.colors.color.ring);
  frame.kit.stroke.setStrokeWidth(2);
  const rect = { x: slot.x, y: plot.bottom - plot.height, width: slot.width, height: plot.height };
  canvas.drawRRect({ rect, rx: 8, ry: 8 }, frame.kit.stroke);
}

/** Pure worklet: reads only its arguments, allocates no Skia objects, reads no clock. */
export function drawChart(canvas: SkCanvas, frame: Frame): void {
  canvas.drawColor(frame.colors.color.background);
  drawGoal(canvas, frame);
  drawBars(canvas, frame);
  drawSelection(canvas, frame);
  drawLabels(canvas, frame);
}
