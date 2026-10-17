// src/ui/motion/celebration-burst.test.tsx
// no-providers: the burst reads only its props (a celebration built here with makeMutable), never
// the app's provider tree.
import { render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';

import { pieceProgress } from './burst-piece';
import { CelebrationBurst, pieceCountOf } from './celebration-burst';
import { CELEBRATION_LIMITS } from './motion-moments';

import type { CelebrationPlan } from './moment-config';
import type { Celebration } from './use-celebration';

const PLAN: CelebrationPlan = {
  delayMs: 100,
  durationMs: 300,
  staggerMs: 50,
  pieces: 6,
  totalMs: 650,
};
const COLORS = ['#3366FF', '#22AA66'] as const;

function celebrationOf(isReduced: boolean): Celebration {
  return {
    elapsedMs: makeMutable(PLAN.totalMs),
    plan: PLAN,
    isReduced,
    play: jest.fn(),
    skip: jest.fn(),
  };
}

describe('CelebrationBurst', () => {
  it('draws a layer that never takes a touch and that screen readers skip', async () => {
    await render(
      <CelebrationBurst celebration={celebrationOf(false)} colors={COLORS} testID="tasks.burst" />,
    );
    const layer = screen.getByTestId('tasks.burst', { includeHiddenElements: true });
    expect(layer).toHaveStyle({ pointerEvents: 'none' });
    expect(layer).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(layer.children).toHaveLength(PLAN.pieces);
  });

  it('draws nothing while motion is reduced', async () => {
    await render(
      <CelebrationBurst celebration={celebrationOf(true)} colors={COLORS} testID="tasks.burst" />,
    );
    expect(screen.queryByTestId('tasks.burst', { includeHiddenElements: true })).toBeNull();
  });
});

describe('pieceCountOf', () => {
  it('caps the pieces at the celebration limit', () => {
    expect(pieceCountOf(CELEBRATION_LIMITS.maxPieces + 10)).toBe(CELEBRATION_LIMITS.maxPieces);
    expect(pieceCountOf(-3)).toBe(0);
  });
});

describe('pieceProgress', () => {
  it('starts each piece one stagger after the one before', () => {
    expect(pieceProgress(100, 0, PLAN)).toBe(0);
    expect(pieceProgress(250, 0, PLAN)).toBe(0.5);
    expect(pieceProgress(150, 1, PLAN)).toBe(0);
    expect(pieceProgress(PLAN.totalMs, PLAN.pieces - 1, PLAN)).toBe(1);
  });
});
