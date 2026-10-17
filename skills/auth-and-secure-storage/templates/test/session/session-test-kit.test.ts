// test/session/session-test-kit.test.ts
import { createSessionTestKit, TEST_ACCOUNT, TEST_NOW_MS } from './session-test-kit';

describe('createSessionTestKit', () => {
  it('starts signed out unless asked to seed a session', async () => {
    const signedOut = createSessionTestKit();
    const signedIn = createSessionTestKit({ isSignedIn: true });

    await expect(signedOut.session.restore()).resolves.toStrictEqual({
      status: 'signed-out',
      reason: null,
    });
    await expect(signedIn.session.restore()).resolves.toStrictEqual({
      status: 'signed-in',
      account: TEST_ACCOUNT,
    });
    expect(signedIn.clock.nowMs()).toBe(TEST_NOW_MS);
  });
});
