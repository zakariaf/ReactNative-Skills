// src/features/parity/parity-launch-bridge.test.tsx
// no-providers: the bridge renders nothing and reads only its launch-argument source and readiness.
import { act, render } from '@testing-library/react-native';

import { ParityLaunchBridge } from './parity-launch-bridge';

const QUERY = 'frame=test-plain&nonce=a1b2c3d4';

describe('ParityLaunchBridge', () => {
  it('opens the launch route once when the build was launched with -parity', async () => {
    const navigate = jest.fn();
    const readArgument = (): string => QUERY;
    const isReady = (): boolean => true;

    const { rerender } = await render(
      <ParityLaunchBridge navigate={navigate} readArgument={readArgument} isReady={isReady} />,
    );
    await rerender(
      <ParityLaunchBridge navigate={navigate} readArgument={readArgument} isReady={isReady} />,
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(`/debug/parity?${QUERY}`);
  });

  it('waits for the navigator before it navigates', async () => {
    jest.useFakeTimers();
    try {
      const navigate = jest.fn();
      const readiness = { isReady: false };
      const isReady = (): boolean => readiness.isReady;

      await render(
        <ParityLaunchBridge navigate={navigate} readArgument={() => QUERY} isReady={isReady} />,
      );
      expect(navigate).not.toHaveBeenCalled();

      readiness.isReady = true;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20);
      });

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(`/debug/parity?${QUERY}`);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing in a normal start', async () => {
    const navigate = jest.fn();

    await render(
      <ParityLaunchBridge navigate={navigate} readArgument={() => null} isReady={() => true} />,
    );

    expect(navigate).not.toHaveBeenCalled();
  });
});
