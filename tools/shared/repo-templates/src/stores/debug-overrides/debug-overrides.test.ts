// src/stores/debug-overrides/debug-overrides.test.ts
import {
  DEFAULT_DEBUG_OVERRIDES,
  decodeDebugOverrides,
  encodeDebugOverrides,
} from './debug-overrides';

describe('debug overrides', () => {
  it('decodes nothing stored as the defaults', () => {
    expect(decodeDebugOverrides(null)).toStrictEqual({ ok: true, value: DEFAULT_DEBUG_OVERRIDES });
  });

  it('keeps every switch through a round trip', () => {
    const overrides = {
      today: '2030-02-28',
      isOffline: true,
      motion: 'still',
      isCanvasProbeOn: true,
    } as const;

    expect(decodeDebugOverrides(encodeDebugOverrides(overrides))).toStrictEqual({
      ok: true,
      value: overrides,
    });
  });

  it.each([
    ['text that is not JSON', '{'],
    [
      'a day that is not a date key',
      '{"today":"2030-2-1","isOffline":false,"motion":"system","isCanvasProbeOn":false}',
    ],
    [
      'an unknown motion value',
      '{"today":null,"isOffline":false,"motion":"fast","isCanvasProbeOn":false}',
    ],
  ])('refuses %s', (_name, text) => {
    expect(decodeDebugOverrides(text)).toStrictEqual({
      ok: false,
      error: { kind: 'debug-overrides-unreadable' },
    });
  });
});
