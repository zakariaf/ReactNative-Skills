// src/ui/a11y/system-a11y-store.test.ts
import { AccessibilityInfo } from 'react-native';

import { readUnlessWeb, systemA11yStore, watchSystemA11y } from './system-a11y-store';

type Listener = (isOn: boolean) => void;

type FirstReads = {
  readonly motion: Promise<boolean>;
  readonly reader: Promise<boolean>;
  readonly boldText: Promise<boolean>;
};

/** Replaces the OS listeners and the first reads; returns the captured listeners. */
function fakeOs(first: FirstReads): {
  readonly listeners: Map<string, Listener>;
  readonly removed: string[];
} {
  const listeners = new Map<string, Listener>();
  const removed: string[] = [];
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((name, listener) => {
    listeners.set(name, listener);
    return { remove: () => removed.push(name) };
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(first.motion);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockReturnValue(first.reader);
  jest.spyOn(AccessibilityInfo, 'isBoldTextEnabled').mockReturnValue(first.boldText);
  return { listeners, removed };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('watchSystemA11y', () => {
  beforeEach(() => {
    systemA11yStore.setState({
      isReduceMotionOn: false,
      isScreenReaderOn: false,
      isBoldTextOn: false,
    });
  });

  it('reads each OS switch once, then follows its changes', async () => {
    const os = fakeOs({
      motion: Promise.resolve(true),
      reader: Promise.resolve(false),
      boldText: Promise.resolve(true),
    });
    const stop = watchSystemA11y(jest.fn());
    await settle();
    expect(systemA11yStore.getState()).toStrictEqual({
      isReduceMotionOn: true,
      isScreenReaderOn: false,
      isBoldTextOn: true,
    });

    os.listeners.get('screenReaderChanged')?.(true);
    os.listeners.get('reduceMotionChanged')?.(false);
    os.listeners.get('boldTextChanged')?.(false);
    expect(systemA11yStore.getState()).toStrictEqual({
      isReduceMotionOn: false,
      isScreenReaderOn: true,
      isBoldTextOn: false,
    });

    stop();
    expect(os.removed).toStrictEqual([
      'reduceMotionChanged',
      'screenReaderChanged',
      'boldTextChanged',
    ]);
  });

  it('keeps a change event that arrives before the slower first read', async () => {
    let resolveMotion: (isOn: boolean) => void = () => undefined;
    const os = fakeOs({
      motion: new Promise<boolean>((resolve) => {
        resolveMotion = resolve;
      }),
      reader: Promise.resolve(false),
      boldText: Promise.resolve(false),
    });
    watchSystemA11y(jest.fn());
    os.listeners.get('reduceMotionChanged')?.(true);
    resolveMotion(false);
    await settle();
    expect(systemA11yStore.getState().isReduceMotionOn).toBe(true);
  });

  it('writes nothing and reports nothing once stopped', async () => {
    const failure = new Error('read after stop');
    fakeOs({
      motion: Promise.resolve(true),
      reader: Promise.reject(failure),
      boldText: Promise.resolve(true),
    });
    const onError = jest.fn();
    const stop = watchSystemA11y(onError);
    stop();
    await settle();
    expect(systemA11yStore.getState()).toStrictEqual({
      isReduceMotionOn: false,
      isScreenReaderOn: false,
      isBoldTextOn: false,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failed first read and keeps the defaults', async () => {
    const failure = new Error('no accessibility service');
    fakeOs({
      motion: Promise.reject(failure),
      reader: Promise.resolve(false),
      boldText: Promise.resolve(false),
    });
    const onError = jest.fn();
    watchSystemA11y(onError);
    await settle();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(systemA11yStore.getState().isReduceMotionOn).toBe(false);
  });
});

describe('readUnlessWeb', () => {
  it('reads the switch on iOS and Android', async () => {
    const read = jest.fn(() => Promise.resolve(true));
    await expect(readUnlessWeb('ios', read)).resolves.toBe(true);
    await expect(readUnlessWeb('android', read)).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers off on the web without calling react-native-web, which cannot tell', async () => {
    const read = jest.fn(() => Promise.resolve(true));
    await expect(readUnlessWeb('web', read)).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});
