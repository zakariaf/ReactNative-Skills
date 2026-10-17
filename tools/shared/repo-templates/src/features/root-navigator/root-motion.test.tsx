// src/features/root-navigator/root-motion.test.tsx
// no-providers: RootMotion renders MotionConfig, which reads only the module-level systemA11yStore,
// or a stand-in kit's motion slot; the saved preference above it is the plain context
// PreferencesRoot provides, and no app provider is involved.
import { render, screen } from '@testing-library/react-native';
import { use } from 'react';
import { View } from 'react-native';

import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import { RootMotion } from './root-motion';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { MotionConfigProps } from '@/ui/a11y/motion-config';

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<Record<string, unknown>>('react-native-reanimated'),
  // The real one warns once per mount in development builds; the mode itself is MotionConfig's test.
  ReducedMotionConfig: jest.fn(() => null),
}));

/** Carries the preference the nearest MotionConfig provides as its accessibility label. */
function PreferenceProbe(): React.JSX.Element {
  return <View testID="root.preference" accessibilityLabel={use(ReduceMotionPreferenceContext)} />;
}

describe('RootMotion', () => {
  it('is the plain MotionConfig with "system" when nothing provides a saved preference', async () => {
    await render(
      <RootMotion kits={[{ name: 'quiet' }]}>
        <PreferenceProbe />
      </RootMotion>,
    );
    expect(screen.getByTestId('root.preference')).toHaveAccessibleName('system');
  });

  it('is the plain MotionConfig with the saved preference provided above it', async () => {
    await render(
      <ReduceMotionPreferenceContext value="off">
        <RootMotion kits={[]}>
          <PreferenceProbe />
        </RootMotion>
      </ReduceMotionPreferenceContext>,
    );
    expect(screen.getByTestId('root.preference')).toHaveAccessibleName('off');
  });

  it("renders the first kit's motion slot in MotionConfig's place, with the preference above", async () => {
    const seen: MotionConfigProps['preference'][] = [];
    const still: RootKit = {
      name: 'still',
      motion: ({ preference, children }) => {
        seen.push(preference);
        return <View testID="root.kit-motion">{children}</View>;
      },
    };
    const later: RootKit = { name: 'later', motion: () => <View testID="root.later-motion" /> };
    await render(
      <ReduceMotionPreferenceContext value="on">
        <RootMotion kits={[still, later]}>
          <View testID="root.stack" />
        </RootMotion>
      </ReduceMotionPreferenceContext>,
    );
    expect(screen.getByTestId('root.kit-motion')).toBeOnTheScreen();
    expect(screen.getByTestId('root.stack')).toBeOnTheScreen();
    expect(screen.queryByTestId('root.later-motion')).toBeNull();
    expect(seen).toStrictEqual(['on']);
  });
});
