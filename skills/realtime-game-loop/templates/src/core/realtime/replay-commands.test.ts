// src/core/realtime/replay-commands.test.ts
import { commandLog, replayCommands } from './replay-commands';

type Recorder = { readonly seen: number[] };

const step = (sim: Recorder, command: number): void => {
  sim.seen.push(command);
};

describe('replay helpers', () => {
  it('extracts (tick, command) changes from drained event triples', () => {
    expect(commandLog([1, 4, 0, 2, 9, 3, 1, 0, 7], 1)).toStrictEqual([
      { command: 4, tick: 0 },
      { command: 0, tick: 7 },
    ]);
  });

  it('ignores a trailing partial triple', () => {
    expect(commandLog([1, 4], 1)).toStrictEqual([]);
  });

  it('feeds each command from its tick until the next change', () => {
    const sim = replayCommands({ sim: { seen: [] }, step, ticks: 5 }, [
      { tick: 1, command: 3 },
      { tick: 3, command: 1 },
    ]);
    expect(sim.seen).toStrictEqual([0, 3, 3, 1, 1]);
  });
});
