// src/ui/animation/rive-moment.test.tsx
// no-providers: the moment reads only the reduce-motion preference, which each test passes itself;
// @rive-app/react-native is the root mock in __mocks__/.
import * as RiveModule from '@rive-app/react-native';
import { render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import { RiveMoment } from './rive-moment';

import type { RiveMomentProps } from './rive-moment';
import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';

// The module the component imported is the root mock; its call log is read through the same import
// (jest.requireMock hands back a separate instance of a root mock).
const rive = RiveModule as unknown as { riveViewCalls: ('play' | 'pause')[] };

const MASCOT = 7; // a Metro asset number, as require() of a bundled .riv returns

const mascot: RiveMomentProps = {
  source: MASCOT,
  stateMachineName: 'Idle',
  frameRate: 30,
  still: 'first-frame',
  weight: 'light',
  isActive: true,
  decorative: false,
  label: 'Nothing to do yet',
  style: null,
  testID: 'tasks.empty-mascot',
  onError: jest.fn(),
};

async function show(
  props: RiveMomentProps,
  preference: ReduceMotionPreference = 'off',
): Promise<void> {
  await render(
    <ReduceMotionPreferenceContext value={preference}>
      <RiveMoment {...props} />
    </ReduceMotionPreferenceContext>,
  );
}

const riveProps = () => screen.getByTestId('rive.view').props;

describe('RiveMoment', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    rive.riveViewCalls.length = 0;
  });

  it('plays the state machine while active, capped at its frame rate', async () => {
    await show(mascot);
    expect(riveProps()).toMatchObject({ autoPlay: true, stateMachineName: 'Idle', frameRate: 30 });
    expect(rive.riveViewCalls).toStrictEqual(['play']);
  });

  it('pauses on its first frame when the screen is not active', async () => {
    await show({ ...mascot, isActive: false });
    expect(riveProps()).toMatchObject({ autoPlay: false });
    expect(rive.riveViewCalls).toStrictEqual(['pause']);
  });

  it('pauses when motion is reduced or a test build holds motion still', async () => {
    await show(mascot, 'on');
    expect(rive.riveViewCalls).toStrictEqual(['pause']);
  });

  it('draws nothing while still when its still is hidden', async () => {
    await show({ ...mascot, still: 'hidden' }, 'on');
    expect(screen.queryByTestId('rive.view')).toBeNull();
  });

  it('reads as one image with its label when informative', async () => {
    await show(mascot);
    expect(screen.getByRole('image', { name: 'Nothing to do yet' })).toBeOnTheScreen();
  });
});
