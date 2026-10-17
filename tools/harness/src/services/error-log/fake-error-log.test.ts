// src/services/error-log/fake-error-log.test.ts
import { createFakeErrorLog } from './fake-error-log';

describe('createFakeErrorLog', () => {
  it('keeps every recorded error with its source and time', () => {
    const error = new Error('disk full');
    const log = createFakeErrorLog({ nowMs: () => 42 });
    log.record('storage', error);

    expect(log.recorded).toStrictEqual([{ atMs: 42, source: 'storage', error }]);
  });

  it('lists entries newest first with the message text', () => {
    const log = createFakeErrorLog();
    log.record('startup', new Error('first'));
    log.record('service', 'second');

    expect(log.entries()).toStrictEqual([
      { atMs: 0, source: 'service', message: 'second' },
      { atMs: 0, source: 'startup', message: 'first' },
    ]);
  });
});
