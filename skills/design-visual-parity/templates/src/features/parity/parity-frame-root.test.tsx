// src/features/parity/parity-frame-root.test.tsx
import { act, screen } from '@testing-library/react-native';

import { useFrameRequest } from '@/hooks/use-frame-request';
import { SOURCE_LANGUAGE } from '@/i18n/languages';
import { AppText } from '@/ui/app-text';
import { renderWithProviders } from '@test/render-with-providers';

import { ParityFrameRoot } from './parity-frame-root';
import { endParitySession, startParitySession } from './parity-session';

import type { ParityPlanTable } from './parity-plans';
import type { ParityRequest } from './parity-request';
import type { ReactNode } from 'react';

// A plan table of the test's own: the app replaces PARITY_PLANS with its frames, and these tests keep
// passing whatever frames it plans.
const PLANS = {
  'test-dialog': {
    root: 'test-dialog.scrim',
    href: '/test',
    state: 'test-dialog-open',
    data: 'design',
    tall: false,
    probe: null,
  },
} as const satisfies ParityPlanTable;

const REQUEST: ParityRequest = {
  frame: 'test-dialog',
  plan: PLANS['test-dialog'],
  theme: 'light',
  language: SOURCE_LANGUAGE,
  date: '2026-10-01',
  scrollY: undefined,
  probe: null,
  nonce: 'c0ffee12',
};

function StateProbe(): ReactNode {
  return <AppText testID="parity.frame-state">{useFrameRequest()?.state ?? 'none'}</AppText>;
}

describe('ParityFrameRoot', () => {
  afterEach(() => {
    endParitySession();
  });

  it('draws nothing extra in a normal start', async () => {
    await renderWithProviders(
      <ParityFrameRoot>
        <StateProbe />
      </ParityFrameRoot>,
    );

    expect(screen.getByTestId('parity.frame-state')).toHaveTextContent('none');
    expect(screen.queryByTestId(/^parity\.launch\./)).toBeNull();
  });

  it("hands the launch's frame state to the screens and draws its marker", async () => {
    await renderWithProviders(
      <ParityFrameRoot>
        <StateProbe />
      </ParityFrameRoot>,
    );
    await act(() => {
      startParitySession(REQUEST);
    });

    expect(screen.getByTestId('parity.frame-state')).toHaveTextContent('test-dialog-open');
    expect(screen.getByTestId('parity.launch.c0ffee12')).toBeOnTheScreen();
  });
});
