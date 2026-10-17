// src/features/debug/debug-links.test.ts
import { DEBUG_LINK_PARAMS, parseDebugLink } from './debug-links';

describe('parseDebugLink', () => {
  it('reads every parameter into one request', () => {
    expect(
      parseDebugLink({
        date: '2030-02-28',
        offline: '1',
        motion: 'still',
        probe: '1',
        lang: 'ar',
        theme: 'dark',
        open: 'tasks',
      }),
    ).toStrictEqual({
      ok: true,
      value: {
        today: '2030-02-28',
        isOffline: true,
        motion: 'still',
        isCanvasProbeOn: true,
        language: 'ar',
        theme: 'dark',
        open: 'tasks',
      },
    });
  });

  it('turns date=real into the real calendar and accepts an empty link', () => {
    expect(parseDebugLink({ date: 'real' })).toStrictEqual({ ok: true, value: { today: null } });
    expect(parseDebugLink({})).toStrictEqual({ ok: true, value: {} });
  });

  it.each([
    [{ dark: '1' }, { kind: 'debug-link-unknown-param', param: 'dark' }],
    [{ offline: ['1', '0'] }, { kind: 'debug-link-repeated-param', param: 'offline' }],
    [{ offline: 'yes' }, { kind: 'debug-link-bad-value', param: 'offline', value: 'yes' }],
    [{ date: '2030-2-28' }, { kind: 'debug-link-bad-value', param: 'date', value: '2030-2-28' }],
    [{ lang: 'xx' }, { kind: 'debug-link-bad-value', param: 'lang', value: 'xx' }],
  ])('refuses %j', (params, error) => {
    expect(parseDebugLink(params)).toStrictEqual({ ok: false, error });
  });

  it('accepts every listed value of every parameter', () => {
    for (const [param, spec] of Object.entries(DEBUG_LINK_PARAMS)) {
      const values = spec.kind === 'date' ? ['real', '2030-01-01'] : spec.values;
      for (const value of values) expect(parseDebugLink({ [param]: value }).ok).toBe(true);
    }
  });
});
