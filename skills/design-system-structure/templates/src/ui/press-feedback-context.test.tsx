// src/ui/press-feedback-context.test.tsx
// no-providers: some cases prove the hooks' defaults outside their provider; the others pass the
// provider under test as their own wrapper.
import { renderHook } from '@testing-library/react-native';

import {
  PressFeedbackProvider,
  usePressFeedback,
  usePressFeedbackPlaysSound,
} from './press-feedback-context';

import type { ReactNode } from 'react';

describe('usePressFeedback', () => {
  it('is silent outside the provider', async () => {
    const { result } = await renderHook(() => usePressFeedback());

    expect(() => {
      result.current();
    }).not.toThrow();
  });

  it("runs the provider's feedback on a press", async () => {
    const onPress = jest.fn();
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <PressFeedbackProvider onPress={onPress}>{props.children}</PressFeedbackProvider>
    );
    const { result } = await renderHook(() => usePressFeedback(), { wrapper });

    result.current();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('usePressFeedbackPlaysSound', () => {
  it('is false outside the provider and for a provider without a sound', async () => {
    const { result: outside } = await renderHook(() => usePressFeedbackPlaysSound());
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <PressFeedbackProvider onPress={jest.fn()}>{props.children}</PressFeedbackProvider>
    );
    const { result: silent } = await renderHook(() => usePressFeedbackPlaysSound(), { wrapper });

    expect(outside.current).toBe(false);
    expect(silent.current).toBe(false);
  });

  it('is true when the provider plays a sound', async () => {
    const wrapper = (props: { readonly children: ReactNode }): ReactNode => (
      <PressFeedbackProvider onPress={jest.fn()} playsSound>
        {props.children}
      </PressFeedbackProvider>
    );
    const { result } = await renderHook(() => usePressFeedbackPlaysSound(), { wrapper });

    expect(result.current).toBe(true);
  });
});
