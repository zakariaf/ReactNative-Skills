// src/services/apple-sign-in/fake-apple-sign-in.test.tsx
// no-providers: the fake's stand-in button reads only its props.
import { render, screen } from '@testing-library/react-native';

import { err } from '@/core/result';

import { createFakeAppleSignIn } from './fake-apple-sign-in';

describe('createFakeAppleSignIn', () => {
  it('answers what the test scripted and rejects anything unscripted', async () => {
    const apple = createFakeAppleSignIn({ isAvailable: false });
    apple.answerSignIn(err({ kind: 'cancelled' }));

    const isAvailable = await apple.isAvailable();
    const first = await apple.signIn();

    expect([isAvailable, first]).toStrictEqual([
      false,
      { ok: false, error: { kind: 'cancelled' } },
    ]);
    await expect(apple.signIn()).rejects.toThrow('no answer was scripted');
  });

  it('reports the credential state and calls revoke listeners until unsubscribed', async () => {
    const apple = createFakeAppleSignIn();
    const revoked: string[] = [];
    const unsubscribe = apple.onRevoked(() => revoked.push('revoked'));

    apple.setCredentialState('revoked');
    apple.revoke();
    unsubscribe();
    apple.revoke();

    await expect(apple.credentialState('user')).resolves.toStrictEqual({
      ok: true,
      value: 'revoked',
    });
    expect(revoked).toStrictEqual(['revoked']);
  });

  it('renders a stand-in button and presses it for the test', async () => {
    const apple = createFakeAppleSignIn();
    const onPress = jest.fn();

    const wasPressedBefore = apple.pressButton();
    await render(<apple.Button onPress={onPress} scheme="light" cornerRadius={10} height={44} />);
    const wasPressed = apple.pressButton();

    expect(screen.getByTestId('apple-sign-in.button')).toBeOnTheScreen();
    expect([wasPressedBefore, wasPressed, onPress.mock.calls.length]).toStrictEqual([
      false,
      true,
      1,
    ]);
  });
});
