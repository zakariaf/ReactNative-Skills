// src/services/session/sign-out-step-factories.test.ts
import { queryCacheStep, storeResetStep } from './sign-out-step-factories';

describe('queryCacheStep', () => {
  it('cancels running queries before it clears the cache', async () => {
    const order: string[] = [];
    const step = queryCacheStep({
      cancelQueries: () => {
        order.push('cancel');
        return Promise.resolve();
      },
      clear: () => {
        order.push('clear');
      },
    });

    await step.run();

    expect([step.name, order]).toStrictEqual(['query-cache', ['cancel', 'clear']]);
  });
});

describe('storeResetStep', () => {
  it('runs the reset under the given name', async () => {
    const reset = jest.fn();
    const step = storeResetStep('account-store', reset);

    await step.run();

    expect(step.name).toBe('account-store');
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
