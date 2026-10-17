// src/features/insights/canvas/to-view.ts
import type { WeeklyChartState } from './canvas-model';
import type { ViewFormat } from '@/canvas/canvas-types';

export type WeeklyChartView = {
  readonly done: readonly number[];
  /** The value the top of the plot stands for (never below the goal, never 0). */
  readonly scaleMax: number;
  readonly goal: number;
  /** Each day's count, digits already localised. */
  readonly labels: readonly string[];
};

export function toView(state: WeeklyChartState, format: ViewFormat): WeeklyChartView {
  const scaleMax = Math.max(1, state.goal, ...state.done);
  return {
    done: state.done,
    scaleMax,
    goal: state.goal,
    labels: state.done.map((count) => format.formatNumber(count)),
  };
}
