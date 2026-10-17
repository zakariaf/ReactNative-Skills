// src/services/crash-reporter/fake-crash-reporter.test.ts
import { FAKE_PENDING_LIMIT, createFakeCrashReporter } from './fake-crash-reporter';

const RENDER = { source: 'render', isFatal: false } as const;

describe('createFakeCrashReporter', () => {
  it('sends nothing before consent and everything that waited once granted', async () => {
    const reporter = createFakeCrashReporter();
    reporter.addBreadcrumb({ category: 'navigation', message: '(app)/index' });
    reporter.captureException(new Error('boom'), RENDER);
    expect(reporter.sent).toHaveLength(0);
    expect(reporter.status()).toBe('waiting');
    await expect(reporter.flush()).resolves.toBe(false);

    reporter.setConsent(true);

    expect(reporter.status()).toBe('reporting');
    expect(reporter.sent).toStrictEqual([{ error: new Error('boom'), context: RENDER }]);
    expect(reporter.breadcrumbs).toStrictEqual([
      { category: 'navigation', message: '(app)/index' },
    ]);
    await expect(reporter.flush()).resolves.toBe(true);
  });

  it('drops what waited and everything after a refusal', () => {
    const reporter = createFakeCrashReporter();
    reporter.captureException(new Error('early'), RENDER);
    reporter.setConsent(false);
    reporter.captureException(new Error('late'), RENDER);
    expect(reporter.sent).toHaveLength(0);
    expect(reporter.status()).toBe('off');
    expect(reporter.consents).toStrictEqual([false]);
  });

  it('stays off without a configured DSN, whatever the choice', () => {
    const reporter = createFakeCrashReporter({ isConfigured: false });
    reporter.setConsent(true);
    reporter.captureException(new Error('boom'), RENDER);
    expect(reporter.status()).toBe('off');
    expect(reporter.sent).toHaveLength(0);
  });

  it('stays off for the run after a refusal once reporting started', () => {
    const reporter = createFakeCrashReporter();
    reporter.setConsent(true);
    reporter.setConsent(false);
    reporter.setConsent(true);
    reporter.captureException(new Error('after'), RENDER);
    expect(reporter.status()).toBe('off');
    expect(reporter.sent).toHaveLength(0);
    expect(reporter.consents).toStrictEqual([true, false, true]);
  });

  it('starts after a refusal given before reporting ever started', () => {
    const reporter = createFakeCrashReporter();
    reporter.setConsent(false);
    reporter.setConsent(true);
    reporter.captureException(new Error('later'), RENDER);
    expect(reporter.status()).toBe('reporting');
    expect(reporter.sent).toHaveLength(1);
  });

  it('keeps only the newest FAKE_PENDING_LIMIT items while waiting', () => {
    const reporter = createFakeCrashReporter();
    for (let index = 0; index < FAKE_PENDING_LIMIT + 5; index += 1) {
      reporter.captureException(new Error(`e${String(index)}`), RENDER);
    }
    reporter.setConsent(true);
    expect(reporter.sent).toHaveLength(FAKE_PENDING_LIMIT);
    expect(reporter.sent[0]?.error).toStrictEqual(new Error('e5'));
  });
});
