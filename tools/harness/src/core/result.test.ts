// src/core/result.test.ts
import { attempt, attemptAsync, err, ok } from './result';

import type { Result } from './result';

type ParseFailure = { readonly kind: 'not-a-number'; readonly raw: string };

const toParseFailure = (thrown: unknown): ParseFailure => ({
  kind: 'not-a-number',
  raw: thrown instanceof Error ? thrown.message : 'unknown',
});

function parseCount(raw: string): Result<number, ParseFailure> {
  const count = Number(raw);
  return Number.isInteger(count) ? ok(count) : err({ kind: 'not-a-number', raw });
}

describe('result', () => {
  it('wraps a value and a failure in the two shapes callers narrow on', () => {
    expect(ok(3)).toStrictEqual({ ok: true, value: 3 });
    expect(err({ kind: 'not-a-number', raw: 'x' })).toStrictEqual({
      ok: false,
      error: { kind: 'not-a-number', raw: 'x' },
    });
  });

  it('narrows on ok so the value and the failure are typed', () => {
    const parsed = parseCount('12a');

    expect(parsed.ok ? parsed.value : parsed.error.kind).toBe('not-a-number');
    expect(parseCount('12')).toStrictEqual({ ok: true, value: 12 });
  });

  it('converts a synchronous throw into a failure and keeps a returned value', () => {
    const failing = attempt(() => {
      throw new Error('bad input');
    }, toParseFailure);

    expect(failing).toStrictEqual({ ok: false, error: { kind: 'not-a-number', raw: 'bad input' } });
    expect(attempt(() => 7, toParseFailure)).toStrictEqual({ ok: true, value: 7 });
  });

  it('resolves a rejection as a failure instead of rejecting', async () => {
    const rejected = await attemptAsync(() => Promise.reject(new Error('offline')), toParseFailure);

    expect(rejected).toStrictEqual({ ok: false, error: { kind: 'not-a-number', raw: 'offline' } });
    await expect(
      attemptAsync(() => Promise.resolve('done'), toParseFailure),
    ).resolves.toStrictEqual({ ok: true, value: 'done' });
  });

  it('converts a throw that happens before the task returns its promise', async () => {
    const startsBroken = (): Promise<number> => {
      throw new Error('not ready');
    };

    await expect(attemptAsync(startsBroken, toParseFailure)).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'not-a-number', raw: 'not ready' },
    });
  });

  it('passes the thrown value to the mapper unchanged, cause included', () => {
    const original = new Error('disk full', { cause: { code: 13 } });
    const seen: unknown[] = [];
    attempt(
      () => {
        throw original;
      },
      (thrown) => {
        seen.push(thrown);
        return { kind: 'not-a-number', raw: '' };
      },
    );

    expect(seen).toStrictEqual([original]);
    expect(seen[0]).toBe(original);
  });
});
