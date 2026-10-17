// src/features/tasks/use-progress-grid-input.ts
// The screen side of touch. The feature's model hook (use-tasks-model.ts) calls it with the
// player's layout (useSurfacePlayer().layout, the layout the picture draws with), the state and the
// store's dispatch, and hands `input` and `highlight` to <SurfaceCanvas>. The selection lives here,
// in React state: the store, undo and persistence never see it.
import { useState } from 'react';

import { isSameTarget } from '@/canvas/canvas-layout';
import { useCanvasGestures } from '@/canvas/gestures/use-canvas-gestures';
import { intentToAction, SELECT_REGIONS } from '@/features/tasks/canvas/intent-to-action';

import type { CanvasLayout, CanvasTarget } from '@/canvas/canvas-layout';
import type { CanvasHighlight } from '@/canvas/canvas-types';
import type { CanvasIntent } from '@/canvas/gestures/canvas-intent';
import type { CanvasGestures } from '@/canvas/gestures/use-canvas-gestures';
import type { ProgressGridAction, ProgressGridState } from '@/features/tasks/canvas/canvas-model';
import type { DerivedValue } from 'react-native-reanimated';

export type ProgressGridInputArgs = {
  readonly layout: DerivedValue<CanvasLayout>;
  readonly state: ProgressGridState;
  readonly dispatch: (action: ProgressGridAction) => void;
  /** progressGridSurface.dragLiftPt ?? 0 */
  readonly dragLiftPt: number;
};

export type ProgressGridInput = {
  readonly input: CanvasGestures;
  readonly highlight: CanvasHighlight;
};

export function useProgressGridInput(args: ProgressGridInputArgs): ProgressGridInput {
  const [selected, setSelected] = useState<CanvasTarget | null>(null);
  const handleIntent = (intent: CanvasIntent): void => {
    // A tap inside a select region only selects (tapping the same target again clears it).
    if (intent.kind === 'tap' && SELECT_REGIONS.includes(intent.target.regionId)) {
      setSelected(isSameTarget(selected, intent.target) ? null : intent.target);
      return;
    }
    const action = intentToAction(
      args.state,
      intent.kind === 'tap' ? { ...intent, selected } : intent,
    );
    if (action !== null || intent.kind === 'drag-end') setSelected(null);
    if (action !== null) args.dispatch(action);
  };
  const input = useCanvasGestures(args.layout, {
    panMode: 'none',
    dragLiftPt: args.dragLiftPt,
    onIntent: handleIntent,
    onMiss: () => {
      setSelected(null);
    },
  });
  return { input, highlight: { selected, hinted: [] } };
}
