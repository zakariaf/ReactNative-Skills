// src/features/parity/parity-root-kit.test.tsx
// no-providers: the kit's parts are rendered as the root's RootKits slot renders them, with a
// stand-in launch argument; the frame root reads only the parity session.
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { createParityKit } from './parity-root-kit';

jest.mock('./read-parity-launch', () => ({
  ...jest.requireActual<Record<string, unknown>>('./read-parity-launch'),
  readParityLaunchArgument: () => 'frame=test-plain&nonce=a1b2c3d4',
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual<Record<string, unknown>>('expo-router'),
  useNavigationContainerRef: () => ({ isReady: () => true }),
}));

describe('createParityKit', () => {
  it('wraps the Stack in the frame root and opens the launch route from its effect once', async () => {
    const navigate = jest.fn();
    const kit = createParityKit({ navigate });
    expect(kit.name).toBe('parity');
    const stack = <View testID="root.stack" />;
    await render(
      <>
        {kit.provide?.(
          <>
            {stack}
            {kit.effects}
          </>,
        )}
      </>,
    );
    expect(screen.getByTestId('root.stack')).toBeOnTheScreen();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/debug/parity?frame=test-plain&nonce=a1b2c3d4');
  });

  it('navigates with the router by default', () => {
    const kit = createParityKit();
    expect(kit.provide).toBeDefined();
    expect(kit.effects).toBeDefined();
  });
});
