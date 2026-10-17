// src/services/error-log/memory-error-log-adapter.test.ts
import { createMemoryErrorLogAdapter } from './memory-error-log-adapter';

describe('createMemoryErrorLogAdapter', () => {
  it('lists entries newest first with their time and source', () => {
    let nowMs = 10;
    const log = createMemoryErrorLogAdapter({ clock: { nowMs: () => nowMs } });
    log.record('startup', new Error('first'));
    nowMs = 20;
    log.record('network', 'second');

    expect(log.entries()).toStrictEqual([
      { atMs: 20, source: 'network', message: 'second' },
      { atMs: 10, source: 'startup', message: 'first' },
    ]);
  });

  it('keeps only the newest entries up to the limit', () => {
    const log = createMemoryErrorLogAdapter({
      clock: { nowMs: () => 0 },
      limit: 2,
    });
    log.record('service', 'a');
    log.record('service', 'b');
    log.record('service', 'c');

    expect(log.entries().map((entry) => entry.message)).toStrictEqual(['c', 'b']);
  });

  it('records a value whose text cannot be read without throwing', () => {
    const log = createMemoryErrorLogAdapter({ clock: { nowMs: () => 0 } });
    const hostile = {
      toString: (): string => {
        throw new Error('no text');
      },
    };
    log.record('render', hostile);

    expect(log.entries()).toStrictEqual([
      { atMs: 0, source: 'render', message: 'unprintable error' },
    ]);
  });

  it('returns a copy, so callers cannot change the log', () => {
    const log = createMemoryErrorLogAdapter({ clock: { nowMs: () => 0 } });
    log.record('i18n', 'missing key');
    const first = log.entries();
    log.record('i18n', 'another');

    expect(first).toHaveLength(1);
  });
});
