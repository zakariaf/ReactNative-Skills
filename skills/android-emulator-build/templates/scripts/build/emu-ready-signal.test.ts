// scripts/build/emu-ready-signal.test.ts
import { emuReadyState, type EmuReadyProbe } from './emu-ready-signal.ts';

const SETTLED: EmuReadyProbe = {
  attempt: 6,
  alive: true,
  resumed: true,
  crashed: false,
  logMatched: null,
  screenUnchanged: true,
};

describe('emuReadyState', () => {
  it('is ready on a still screen after 3 s when no readyLog is configured', () => {
    expect(emuReadyState(SETTLED)).toStrictEqual({ kind: 'ready', reason: 'stable-screen' });
    expect(emuReadyState({ ...SETTLED, attempt: 5 })).toStrictEqual({ kind: 'wait' });
  });

  it('is ready as soon as the readyLog line appears', () => {
    expect(
      emuReadyState({ ...SETTLED, attempt: 2, logMatched: true, screenUnchanged: false }),
    ).toStrictEqual({
      kind: 'ready',
      reason: 'log',
    });
  });

  it('waits longer for a still screen while the readyLog line is pending', () => {
    expect(emuReadyState({ ...SETTLED, attempt: 15, logMatched: false })).toStrictEqual({
      kind: 'wait',
    });
    expect(emuReadyState({ ...SETTLED, attempt: 16, logMatched: false }).kind).toBe('ready');
  });

  it('counts no screen whose activity is not the app', () => {
    expect(emuReadyState({ ...SETTLED, attempt: 40, resumed: false })).toStrictEqual({
      kind: 'wait',
    });
  });

  it('fails at once on a crash report, and on a missing process after the grace period', () => {
    expect(emuReadyState({ ...SETTLED, crashed: true }).kind).toBe('failed');
    expect(emuReadyState({ ...SETTLED, attempt: 3, alive: false })).toStrictEqual({ kind: 'wait' });
    expect(emuReadyState({ ...SETTLED, attempt: 4, alive: false })).toStrictEqual({
      kind: 'failed',
      reason: 'the app process is not running',
    });
  });
});
