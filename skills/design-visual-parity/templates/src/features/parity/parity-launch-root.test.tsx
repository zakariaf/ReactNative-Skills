// src/features/parity/parity-launch-root.test.tsx
import { screen, waitFor } from '@testing-library/react-native';

import { SOURCE_LANGUAGE } from '@/i18n/languages';
import { renderWithProviders } from '@test/render-with-providers';

import { PARITY_FIXTURE } from './parity-fixture';
import { ParityLaunchRoot } from './parity-launch-root';
import { endParitySession } from './parity-session';

import type { ParityAppliers } from './parity-launch';
import type { ParityPlanTable } from './parity-plans';

// A plan table of the test's own: the app replaces PARITY_PLANS with its frames, and these tests keep
// passing whatever frames it plans.
const PLANS = {
  'test-plain': {
    root: 'test.screen',
    href: '/test',
    state: null,
    data: 'design',
    tall: false,
    probe: null,
  },
} as const satisfies ParityPlanTable;

const APPLIERS: ParityAppliers = {
  consent: () => Promise.resolve(),
  overrides: () => Promise.resolve(),
  data: () => Promise.resolve(),
  settings: () => Promise.resolve('applied'),
};

const PARAMS = {
  frame: 'test-plain',
  theme: 'dark',
  lang: SOURCE_LANGUAGE,
  date: PARITY_FIXTURE.day,
  motion: 'still',
  nonce: 'a1b2c3d4',
} as const;

describe('ParityLaunchRoot', () => {
  afterEach(() => {
    endParitySession();
  });

  it("replaces itself with the frame's route", async () => {
    const navigate = jest.fn();

    await renderWithProviders(
      <ParityLaunchRoot params={PARAMS} appliers={APPLIERS} navigate={navigate} plans={PLANS} />,
    );

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/test');
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('parity.error')).toBeNull();
  });

  it('shows the error screen, naming the bad parameter, for a refused launch', async () => {
    const navigate = jest.fn();

    await renderWithProviders(
      <ParityLaunchRoot
        params={{ ...PARAMS, frame: 'home' }}
        appliers={APPLIERS}
        navigate={navigate}
        plans={PLANS}
      />,
    );

    expect(await screen.findByTestId('parity.error')).toHaveAccessibleName(
      'parity-bad-value frame=home',
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
