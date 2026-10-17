# Stick input for simulations

How a continuous one-thumb stick (a real-time arena chase, a steering control) becomes integer
commands a fixed-step simulation can record and replay. Read this before adding continuous input to a
canvas. realtime-game-loop owns the loop that consumes the commands.

## Why integers

A real-time simulation must replay bit-exactly from a recorded `(tick, command)` log, on every device
and in Jest. Floats from gestures (a drag angle, a velocity) would put device-dependent values into the
simulation. So the gesture side quantises the drag into one of 17 integer commands and the simulation
only ever sees that integer.

## The command table

- `0` = idle (no finger, or inside the 12 pt dead zone).
- `k` = 1 to 16 = the unit vector `(cos((k-1)·22.5°), sin((k-1)·22.5°))` in canvas coordinates, where y
  points down: 1 = right, 5 = down, 9 = left, 13 = up.
- The 16 vectors are precomputed once with Node and committed as literals (`STICK_DIRECTIONS` in
  `src/canvas/gestures/stick-command.ts`); no `Math.cos`/`Math.sin` at runtime (their results differ
  between JavaScript engines, so the determinism rules ban them).
- `stickCommand(dx, dy)` picks the direction with the largest dot product with the drag vector: no
  `atan2`, and every command is within 11.25° of the drag.
- The simulation keeps the same table in the same order; when one side changes, both change in one
  commit and the replay tests run again.

## The gesture

`makeStickGesture(command)` in `use-canvas-gestures.ts` (still the only gesture module):

```ts
export function makeStickGesture(command: SharedValue<number>): PanGesture {
  return Gesture.Pan()
    .withTestId('canvas.stick')
    .minDistance(0)
    .onUpdate((event) => {
      const next = stickCommand(event.translationX, event.translationY);
      if (next !== command.get()) command.set(next);   // write only on change
    })
    .onFinalize(() => {
      command.set(STICK_IDLE);                          // lifted, failed or cancelled
    });
}
```

- A plain builder (no hooks inside), so a screen can call it during render and pass
  `input={{ gesture: makeStickGesture(command), pointer }}` to the canvas.
- The command lives in a shared value on the UI thread; the loop reads it once per frame and records
  each change as an input event `(tick, command)`. Nothing goes through React or JS per frame.
- A pan anywhere on the canvas drives the stick (the drag vector is relative to where the finger went
  down), so the thumb never has to find a small control, and no hit-targets test is needed.
- A stick surface declares `"input": "stick"` in `contracts/canvas-input.json`, or sits beside a `sim/`
  folder (`src/games/<game-id>/sim/`): the checker then asks for no intent function.

## Tests

- `stick-command.test.ts`: the dead zone, the four axes (1, 5, 9, 13), and a fast-check property that
  every command is an integer 1 to 16 within 11.25° of the drag.
- `use-canvas-gestures.test.tsx` (`makeStickGesture`): a drag that turns from down to right writes
  `[5, 1, 0]`: each new command once, then 0 when the finger lifts.
- The simulation's replay tests (realtime-game-loop) prove the recorded commands reproduce the run.
