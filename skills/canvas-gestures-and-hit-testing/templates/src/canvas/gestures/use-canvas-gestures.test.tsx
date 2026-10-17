// src/canvas/gestures/use-canvas-gestures.test.tsx
// no-providers: the gesture hook takes its layout and callbacks as arguments and reads no store, catalog or service.
// Gesture tests need act(): the Worklets Jest mock delivers scheduleOnRN as a microtask.
import { act, render } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { CanvasGestureProbe } from './canvas-gesture-probe';
import { StickGestureProbe } from './stick-gesture-probe';

import type { CanvasLayout } from '@/canvas/canvas-layout';
import type { SharedValue } from 'react-native-reanimated';

const LAYOUT: CanvasLayout = {
  width: 400,
  height: 400,
  isMirrored: false,
  regions: [{ id: 'grid', x: 0, y: 0, cell: 50, cols: 8, rows: 8 }],
};

/** A pan from (25, 25) that moves by (dx, dy) and is released there (or cancelled). */
function pan(
  dx: number,
  dy: number,
  last: State = State.END,
): Parameters<typeof fireGestureHandler>[1] {
  const end = { x: 25 + dx, y: 25 + dy, translationX: dx, translationY: dy };
  return [
    { state: State.BEGAN, x: 25, y: 25, translationX: 0, translationY: 0 },
    { state: State.ACTIVE, x: 40, y: 25, translationX: 15, translationY: 0 },
    { state: State.ACTIVE, ...end },
    { state: last, ...end, velocityX: 0, velocityY: 0 },
  ];
}

/** A tap at (x, y). */
function tapAt(x: number, y: number): Parameters<typeof fireGestureHandler>[1] {
  return [
    { state: State.BEGAN, x, y },
    { state: State.ACTIVE, x, y },
    { state: State.END, x, y },
  ];
}

describe('useCanvasGestures', () => {
  it('turns a tap into a tap intent on the hit cell', async () => {
    const onIntent = jest.fn();
    await render(<CanvasGestureProbe layout={LAYOUT} panMode="drag" onIntent={onIntent} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.tap'), tapAt(175, 60));
    });
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'tap',
      target: { regionId: 'grid', col: 3, row: 1 },
      selected: null,
    });
  });

  it('reports a tap outside every region as a miss, never as an intent', async () => {
    const onIntent = jest.fn();
    const onMiss = jest.fn();
    const wide = { ...LAYOUT, width: 600 };
    await render(
      <CanvasGestureProbe layout={wide} panMode="drag" onIntent={onIntent} onMiss={onMiss} />,
    );
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.tap'), tapAt(560, 60));
    });
    expect(onMiss).toHaveBeenCalledTimes(1);
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('turns a drag into ONE drag-end intent from the start cell to the release cell', async () => {
    const onIntent = jest.fn();
    await render(<CanvasGestureProbe layout={LAYOUT} panMode="drag" onIntent={onIntent} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.pan'), pan(100, 150));
    });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'drag-end',
      from: { regionId: 'grid', col: 0, row: 0 },
      to: { regionId: 'grid', col: 2, row: 3 },
    });
  });

  it('emits nothing when the system cancels a drag', async () => {
    const onIntent = jest.fn();
    await render(<CanvasGestureProbe layout={LAYOUT} panMode="drag" onIntent={onIntent} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.pan'), pan(100, 150, State.CANCELLED));
    });
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('turns a swipe into ONE physical direction', async () => {
    const onIntent = jest.fn();
    await render(<CanvasGestureProbe layout={LAYOUT} panMode="swipe" onIntent={onIntent} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.pan'), pan(0, 120));
    });
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'swipe',
      direction: 'down',
      from: { regionId: 'grid', col: 0, row: 0 },
    });
  });

  it('reports hover changes, not every finger move', async () => {
    const onHover = jest.fn();
    await render(
      <CanvasGestureProbe layout={LAYOUT} panMode="drag" onIntent={jest.fn()} onHover={onHover} />,
    );
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.pan'), pan(100, 150));
    });
    expect(onHover.mock.calls).toStrictEqual([[{ regionId: 'grid', col: 2, row: 3 }]]);
  });

  it('lifts the hover and the drop target alike, so the preview cell is the drop cell', async () => {
    const onIntent = jest.fn();
    const onHover = jest.fn();
    await render(
      <CanvasGestureProbe
        layout={LAYOUT}
        panMode="drag"
        dragLiftPt={50}
        onIntent={onIntent}
        onHover={onHover}
      />,
    );
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.pan'), pan(100, 150));
    });
    // The finger ends in row 3 (y 175); the lifted pointer, its preview and the drop are in row 2.
    const lastHover: unknown = onHover.mock.calls.at(-1)?.[0];
    expect(lastHover).toStrictEqual({ regionId: 'grid', col: 2, row: 2 });
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'drag-end',
      from: { regionId: 'grid', col: 0, row: 0 },
      to: lastHover,
    });
  });

  it('turns a long press into a long-press intent on the held cell', async () => {
    const onIntent = jest.fn();
    await render(<CanvasGestureProbe layout={LAYOUT} panMode="none" onIntent={onIntent} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.long-press'), tapAt(60, 110));
    });
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'long-press',
      target: { regionId: 'grid', col: 1, row: 2 },
    });
  });
});

describe('makeStickGesture', () => {
  it('writes each new integer stick command once, and 0 when the finger lifts', async () => {
    const writes: number[] = [];
    let current = 0;
    /** Stands in for the loop's command shared value (mock shared values are frozen) and records writes. */
    const command = {
      get: () => current,
      set: (value: number) => {
        writes.push(value);
        current = value;
      },
    } as unknown as SharedValue<number>;
    await render(<StickGestureProbe command={command} />);
    await act(() => {
      fireGestureHandler(getByGestureTestId('canvas.stick'), [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: 0, translationY: 20 },
        { state: State.ACTIVE, translationX: 0, translationY: 40 },
        { state: State.ACTIVE, translationX: 40, translationY: 0 },
        { state: State.END, translationX: 40, translationY: 0 },
      ]);
    });
    expect(writes).toStrictEqual([5, 1, 0]);
  });
});
