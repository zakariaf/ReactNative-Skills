// src/ui/parity-launch-marker.test.tsx
// no-providers: the marker reads only the frame request, which each test provides.
import { render, screen } from '@testing-library/react-native';

import { FrameRequestProvider } from '@/hooks/use-frame-request';

import { ParityLaunchMarker } from './parity-launch-marker';

describe('ParityLaunchMarker', () => {
  it("draws the launch's marker inside a parity launch", async () => {
    await render(
      <FrameRequestProvider request={{ state: null, scrollY: undefined, nonce: '3f9a0c1d2e4b' }}>
        <ParityLaunchMarker />
      </FrameRequestProvider>,
    );

    expect(screen.getByTestId('parity.launch.3f9a0c1d2e4b')).toBeOnTheScreen();
  });

  it('draws nothing in a normal start', async () => {
    await render(<ParityLaunchMarker />);

    expect(screen.queryByTestId(/^parity\.launch\./)).toBeNull();
  });
});
