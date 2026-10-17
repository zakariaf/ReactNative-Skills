// src/ui/subtree-error-boundary.test.tsx
// no-providers: the boundary takes everything through props and reads no context.
import { act, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { SubtreeErrorBoundary } from './subtree-error-boundary';

import type { ReactNode } from 'react';

let shouldThrow = true;

function FlakyChart(): ReactNode {
  if (shouldThrow) throw new Error('chart exploded');
  return <View testID="tasks.weekly-chart" />;
}

describe('SubtreeErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    // React logs caught render errors to console.error; keep the test output readable.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows the fallback, keeps its siblings and records the error once', async () => {
    const onError = jest.fn();
    await render(
      <View>
        <View testID="tasks.summary" />
        <SubtreeErrorBoundary
          onError={onError}
          renderFallback={() => <View testID="tasks.weekly-chart-fallback" />}
        >
          <FlakyChart />
        </SubtreeErrorBoundary>
      </View>,
    );
    expect(screen.getByTestId('tasks.weekly-chart-fallback')).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.summary')).toBeOnTheScreen();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'chart exploded' }),
      expect.any(String),
    );
  });

  it('renders the children again only after the fallback calls reset', async () => {
    let reset: () => void = () => undefined;
    await render(
      <SubtreeErrorBoundary
        onError={jest.fn()}
        renderFallback={(doReset) => {
          reset = doReset;
          return <View testID="tasks.weekly-chart-fallback" />;
        }}
      >
        <FlakyChart />
      </SubtreeErrorBoundary>,
    );
    shouldThrow = false;
    expect(screen.getByTestId('tasks.weekly-chart-fallback')).toBeOnTheScreen();

    await act(() => {
      reset();
    });
    expect(screen.getByTestId('tasks.weekly-chart')).toBeOnTheScreen();
  });
});
