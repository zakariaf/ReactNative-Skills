// scripts/build/ready-signal.test.ts
import { readyReason } from './ready-signal.ts';

describe('readyReason', () => {
  it('is ready as soon as the marker holds the expected text', () => {
    const probe = { attempt: 1, marker: 'screen=home', contains: 'home', screenUnchanged: false };
    expect(readyReason(probe)).toBe('marker');
  });

  it('gives the first screen longer when the marker exists without the text', () => {
    const pending = { marker: 'screen=onboarding', contains: 'home' };
    expect(readyReason({ ...pending, attempt: 10, screenUnchanged: true })).toBeNull();
    expect(readyReason({ ...pending, attempt: 16, screenUnchanged: false })).toBeNull();
    expect(readyReason({ ...pending, attempt: 16, screenUnchanged: true })).toBe('stable-screen');
  });

  it('falls back to a still screen after 3 s without a marker', () => {
    const none = { marker: null, contains: null };
    expect(readyReason({ ...none, attempt: 2, screenUnchanged: true })).toBeNull();
    expect(readyReason({ ...none, attempt: 6, screenUnchanged: false })).toBeNull();
    expect(readyReason({ ...none, attempt: 6, screenUnchanged: true })).toBe('stable-screen');
  });
});
