// src/ui/animation/lottie-moment.test.tsx
// no-providers: the moment reads only the reduce-motion preference and the animation stage, which
// each test passes itself; lottie-react-native is the root mock in __mocks__/.
import { act, render, screen } from '@testing-library/react-native';
import * as LottieModule from 'lottie-react-native';
import { AppState } from 'react-native';

import { systemA11yStore } from '@/ui/a11y/system-a11y-store';
import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import { AnimationStageProvider } from './animation-stage';
import { LottieMoment } from './lottie-moment';

import type { LottieMomentProps } from './lottie-moment';
import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';
import type { AnimationObject } from 'lottie-react-native';
import type { ReactNode } from 'react';

// The module the component imported is the root mock; its extras are read through the same import
// (jest.requireMock hands back a separate instance of a root mock).
const lottie = LottieModule as unknown as { lottieViewMethods: Record<'play', jest.Mock> };

const LIST_COMPLETED = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 45,
  w: 200,
  h: 200,
  assets: [],
  layers: [],
} satisfies AnimationObject;

const celebration: LottieMomentProps = {
  source: LIST_COMPLETED,
  plays: 2,
  still: 1,
  weight: 'heavy',
  isActive: true,
  decorative: true,
  style: null,
  testID: 'tasks.list-completed',
  onError: jest.fn(),
};

type ScreenProps = { readonly preference: ReduceMotionPreference; readonly children: ReactNode };

function Screen({ preference, children }: ScreenProps): ReactNode {
  return (
    <ReduceMotionPreferenceContext value={preference}>
      <AnimationStageProvider>{children}</AnimationStageProvider>
    </ReduceMotionPreferenceContext>
  );
}

async function show(
  props: LottieMomentProps,
  preference: ReduceMotionPreference = 'off',
): Promise<void> {
  await render(
    <Screen preference={preference}>
      <LottieMoment {...props} />
    </Screen>,
  );
}

// Decorative moments are hidden from screen readers, so queries include hidden elements.
const HIDDEN = { includeHiddenElements: true } as const;
const lottieProps = () => screen.getByTestId('lottie.view', HIDDEN).props;

async function finishOnePlay(): Promise<void> {
  const finish = lottieProps()['onAnimationFinish'] as (isCancelled: boolean) => void;
  await act(() => {
    finish(false);
  });
}

describe('LottieMoment', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  });

  it('plays a bounded number of times, then rests on the end frame and reports it', async () => {
    const onFinish = jest.fn();
    await show({ ...celebration, onFinish });
    expect(lottieProps()).toMatchObject({ autoPlay: true, loop: false });

    await finishOnePlay();
    expect(lottie.lottieViewMethods.play).toHaveBeenCalledTimes(1);

    await finishOnePlay();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(lottieProps()).toMatchObject({ autoPlay: false, progress: 1 });
  });

  it('shows the still frame when motion is reduced or a test build holds motion still', async () => {
    await show({ ...celebration, still: 0.5 }, 'on');
    expect(lottieProps()).toMatchObject({ autoPlay: false, loop: false, progress: 0.5 });
  });

  it('follows the phone switch when the app has no preference', async () => {
    systemA11yStore.setState({ isReduceMotionOn: true });
    await show(celebration, 'system');
    expect(lottieProps()).toMatchObject({ autoPlay: false });
  });

  it('holds still in the background', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    await show(celebration);
    expect(lottieProps()).toMatchObject({ autoPlay: false });
  });

  it('draws nothing under reduced motion when its still is hidden', async () => {
    await show({ ...celebration, still: 'hidden' }, 'on');
    expect(screen.queryByTestId('lottie.view', HIDDEN)).toBeNull();
  });

  it('hides decorative art from VoiceOver and TalkBack', async () => {
    await show(celebration);
    expect(screen.queryByTestId('tasks.list-completed')).toBeNull();
    expect(screen.getByTestId('tasks.list-completed', HIDDEN).props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
  });

  it('holds a second heavy moment still while the first one plays', async () => {
    await render(
      <Screen preference="off">
        <LottieMoment {...celebration} />
        <LottieMoment {...celebration} testID="tasks.second-celebration" />
      </Screen>,
    );
    const views = screen.getAllByTestId('lottie.view', HIDDEN);
    expect(views.map((view) => view.props['autoPlay'] as boolean)).toStrictEqual([true, false]);
  });
});
