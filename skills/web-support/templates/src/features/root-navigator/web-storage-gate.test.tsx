// src/features/root-navigator/web-storage-gate.test.tsx
import { act, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithProviders } from '@test/render-with-providers';

import { WebStorageGate } from './web-storage-gate';

type WarmUpResult = 'ready' | 'in-use-elsewhere' | 'unsupported';

type Deferred = {
  readonly promise: Promise<WarmUpResult>;
  readonly resolve: (result: WarmUpResult) => void;
  readonly reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve: (result: WarmUpResult) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<WarmUpResult>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const APP = <View testID="app-root.ready" />;
const OTHER_TAB = <View testID="app-root.other-tab" />;
const UNSUPPORTED = <View testID="app-root.unsupported" />;

describe('WebStorageGate', () => {
  it('renders the children on the first render when there is nothing to wait for', async () => {
    const onError = jest.fn();

    await renderWithProviders(
      <WebStorageGate
        warmUp={null}
        onError={onError}
        inUseElsewhere={OTHER_TAB}
        unsupported={UNSUPPORTED}
      >
        {APP}
      </WebStorageGate>,
    );

    expect(screen.getByTestId('app-root.ready')).toBeOnTheScreen();
    expect(onError).not.toHaveBeenCalled();
  });

  it('renders nothing until the warm-up resolves, then the children', async () => {
    const pending = deferred();
    const warmUp = jest.fn(() => pending.promise);

    await renderWithProviders(
      <WebStorageGate
        warmUp={warmUp}
        onError={jest.fn()}
        inUseElsewhere={OTHER_TAB}
        unsupported={UNSUPPORTED}
      >
        {APP}
      </WebStorageGate>,
    );
    expect(screen.queryByTestId('app-root.ready')).not.toBeOnTheScreen();

    await act(async () => {
      pending.resolve('ready');
      await pending.promise;
    });

    expect(screen.getByTestId('app-root.ready')).toBeOnTheScreen();
    expect(warmUp).toHaveBeenCalledTimes(1);
  });

  it('shows the other-tab notice while another tab holds the storage', async () => {
    const pending = deferred();

    await renderWithProviders(
      <WebStorageGate
        warmUp={() => pending.promise}
        onError={jest.fn()}
        inUseElsewhere={OTHER_TAB}
        unsupported={UNSUPPORTED}
      >
        {APP}
      </WebStorageGate>,
    );
    await act(async () => {
      pending.resolve('in-use-elsewhere');
      await pending.promise;
    });

    expect(screen.getByTestId('app-root.other-tab')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-root.ready')).not.toBeOnTheScreen();
  });

  it('shows the unsupported notice when the browser cannot run the storage', async () => {
    const pending = deferred();

    await renderWithProviders(
      <WebStorageGate
        warmUp={() => pending.promise}
        onError={jest.fn()}
        inUseElsewhere={OTHER_TAB}
        unsupported={UNSUPPORTED}
      >
        {APP}
      </WebStorageGate>,
    );
    await act(async () => {
      pending.resolve('unsupported');
      await pending.promise;
    });

    expect(screen.getByTestId('app-root.unsupported')).toBeOnTheScreen();
    expect(screen.queryByTestId('app-root.ready')).not.toBeOnTheScreen();
  });

  it('reports a failed warm-up and renders the children anyway', async () => {
    const pending = deferred();
    const onError = jest.fn();
    const failure = new Error('no SharedArrayBuffer');

    await renderWithProviders(
      <WebStorageGate
        warmUp={() => pending.promise}
        onError={onError}
        inUseElsewhere={OTHER_TAB}
        unsupported={UNSUPPORTED}
      >
        {APP}
      </WebStorageGate>,
    );
    await act(async () => {
      pending.reject(failure);
      await pending.promise.catch(() => undefined);
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(screen.getByTestId('app-root.ready')).toBeOnTheScreen();
  });
});
