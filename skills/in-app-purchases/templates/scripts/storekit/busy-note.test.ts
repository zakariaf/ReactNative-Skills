// scripts/storekit/busy-note.test.ts
import { busyNote } from './busy-note.ts';

describe('busyNote', () => {
  it('stays quiet up to twice the cores', () => {
    expect(busyNote(24, 12)).toBeNull();
  });

  it('names the load and the limit on a busy Mac', () => {
    expect(busyNote(450, 12)).toContain('load average 450 on 12 cores');
    expect(busyNote(450, 12)).toContain('below 24');
  });
});
