// src/services/apple-sign-in/expo-apple-sign-in-adapter.test.tsx
// no-providers: the adapter's button reads only its props (Apple's native button is automocked).
// Drives the adapter against Jest's automocks of expo-apple-authentication and expo-crypto (read
// with a typed requireMock): the hashed nonce goes to Apple, the raw one comes back for the server.
import { render } from '@testing-library/react-native';

import {
  APPLE_CANCELLED_CODE,
  appleFailureOf,
  createExpoAppleSignInAdapter,
} from './expo-apple-sign-in-adapter';

jest.mock('expo-apple-authentication');
jest.mock('expo-crypto');

type MockedApple = {
  readonly isAvailableAsync: jest.Mock<Promise<boolean>, []>;
  readonly signInAsync: jest.Mock<Promise<object>, [Record<string, unknown>]>;
  readonly getCredentialStateAsync: jest.Mock<Promise<number>, [string]>;
  readonly formatFullName: jest.Mock<string, [object]>;
  readonly addRevokeListener: jest.Mock<{ remove: jest.Mock }, [() => void]>;
  readonly AppleAuthenticationCredentialState: Readonly<Record<string, number>>;
  readonly AppleAuthenticationButtonStyle: Readonly<Record<string, number>>;
  readonly AppleAuthenticationButton: jest.Mock<null, [Record<string, unknown>]>;
};
type MockedCrypto = {
  readonly randomUUID: jest.Mock<string, []>;
  readonly digestStringAsync: jest.Mock<Promise<string>, [string, string]>;
};

const apple = jest.requireMock<MockedApple>('expo-apple-authentication');
const crypto = jest.requireMock<MockedCrypto>('expo-crypto');
const CREDENTIAL = {
  user: 'apple-user-1',
  identityToken: 'identity-jwt',
  authorizationCode: 'code-1',
  email: 'robin@privaterelay.appleid.com',
  fullName: { givenName: 'Robin', familyName: null },
};

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('createExpoAppleSignInAdapter', () => {
  beforeEach(() => {
    apple.isAvailableAsync.mockResolvedValue(true);
    crypto.randomUUID.mockReturnValue('raw-nonce');
    crypto.digestStringAsync.mockResolvedValue('hashed-nonce');
    apple.formatFullName.mockReturnValue('Robin');
  });

  it('sends the hashed nonce to Apple and returns the raw one with the credential', async () => {
    apple.signInAsync.mockResolvedValueOnce(CREDENTIAL);

    const signedIn = await createExpoAppleSignInAdapter().signIn();

    expect(signedIn).toStrictEqual({
      ok: true,
      value: {
        user: 'apple-user-1',
        identityToken: 'identity-jwt',
        authorizationCode: 'code-1',
        rawNonce: 'raw-nonce',
        fullName: 'Robin',
        email: 'robin@privaterelay.appleid.com',
      },
    });
    expect(apple.signInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'hashed-nonce' }),
    );
  });

  it('keeps a later sign-in without name or email, as Apple sends them once', async () => {
    apple.signInAsync.mockResolvedValueOnce({ ...CREDENTIAL, email: null, fullName: null });

    const signedIn = await createExpoAppleSignInAdapter().signIn();

    expect(signedIn.ok && [signedIn.value.fullName, signedIn.value.email]).toStrictEqual([
      null,
      null,
    ]);
  });

  it('reports a closed sheet as cancelled and a missing native sheet as unavailable', async () => {
    const adapter = createExpoAppleSignInAdapter();
    apple.signInAsync.mockRejectedValueOnce(codedError(APPLE_CANCELLED_CODE));
    const cancelled = await adapter.signIn();
    apple.isAvailableAsync.mockResolvedValueOnce(false);
    const unavailable = await adapter.signIn();

    expect([cancelled, unavailable]).toStrictEqual([
      { ok: false, error: { kind: 'cancelled' } },
      { ok: false, error: { kind: 'unavailable' } },
    ]);
  });

  it('maps the credential state and unsubscribes the revoke listener', async () => {
    const remove = jest.fn();
    apple.addRevokeListener.mockReturnValueOnce({ remove });
    apple.getCredentialStateAsync.mockResolvedValueOnce(
      apple.AppleAuthenticationCredentialState['REVOKED'] ?? -1,
    );
    const adapter = createExpoAppleSignInAdapter();

    const state = await adapter.credentialState('apple-user-1');
    adapter.onRevoked(() => undefined)();

    expect(state).toStrictEqual({ ok: true, value: 'revoked' });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('appleFailureOf', () => {
  it('turns any other rejection into a failure with its code', () => {
    expect(
      [codedError('ERR_REQUEST_FAILED'), new Error('boom'), null].map(appleFailureOf),
    ).toStrictEqual([
      { kind: 'failed', code: 'ERR_REQUEST_FAILED' },
      { kind: 'failed', code: 'ERR_UNKNOWN' },
      { kind: 'failed', code: 'ERR_UNKNOWN' },
    ]);
  });
});

describe('the adapter button', () => {
  it("renders Apple's button, black on light screens and white on dark ones", async () => {
    const { Button } = createExpoAppleSignInAdapter();
    const onPress = jest.fn();

    await render(<Button onPress={onPress} scheme="dark" cornerRadius={10} height={44} />);

    expect(apple.AppleAuthenticationButton).toHaveBeenLastCalledWith(
      expect.objectContaining({
        buttonStyle: apple.AppleAuthenticationButtonStyle['WHITE'],
        cornerRadius: 10,
        onPress,
      }),
      undefined,
    );
  });
});
