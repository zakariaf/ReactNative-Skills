// src/features/root-navigator/background-flush.test.ts
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { isLeavingForeground, runFlushers } from './background-flush';

describe('isLeavingForeground', () => {
  it.each([
    ['active', 'inactive', true],
    ['active', 'background', true],
    ['active', 'unknown', true],
    ['inactive', 'background', false],
    ['inactive', 'active', false],
    ['background', 'active', false],
    ['active', 'active', false],
  ])('flushes on %s -> %s: %s', (previous, next, shouldFlush) => {
    expect(isLeavingForeground(previous, next)).toBe(shouldFlush);
  });
});

describe('runFlushers', () => {
  it('runs every flusher in order', () => {
    const calls: string[] = [];
    runFlushers(
      [
        { name: 'draft', flush: () => calls.push('draft') },
        { name: 'queue', flush: () => calls.push('queue') },
      ],
      createFakeErrorLog(),
    );
    expect(calls).toStrictEqual(['draft', 'queue']);
  });

  it('records a flusher that throws and still runs the rest', () => {
    const errorLog = createFakeErrorLog();
    const after = jest.fn();
    runFlushers(
      [
        {
          name: 'draft',
          flush: () => {
            throw new Error('disk full');
          },
        },
        { name: 'queue', flush: after },
      ],
      errorLog,
    );
    expect(after).toHaveBeenCalledTimes(1);
    expect(errorLog.recorded).toHaveLength(1);
    expect(errorLog.recorded[0]?.source).toBe('storage');
  });
});
