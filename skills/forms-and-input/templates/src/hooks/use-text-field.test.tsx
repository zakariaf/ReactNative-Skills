// src/hooks/use-text-field.test.tsx
// A real form (useForm + the valibot resolver) with three bound fields. Fake elements stand in
// for the inputs' refs, so the focus chain and shouldFocusError are observed exactly where
// react-hook-form calls focus() (setFocus defers it with setTimeout: run the timers).
import { valibotResolver } from '@hookform/resolvers/valibot';
import { act, renderHook } from '@testing-library/react-native';
import { useForm } from 'react-hook-form';
import * as v from 'valibot';

import { createFormTestWrapper } from '@test/forms/i18n-form-wrapper';

import { useTextField } from './use-text-field';

const SCHEMA = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty('forms.field.invalid')),
  email: v.pipe(v.string(), v.trim(), v.email('Invalid email')),
  about: v.string(),
});
type Values = v.InferInput<typeof SCHEMA>;

function useThreeFields(onSubmit: () => void) {
  const form = useForm<Values>({
    resolver: valibotResolver(SCHEMA),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', about: '' },
  });
  return {
    form,
    name: useTextField(form, 'name', { kind: 'name', next: 'email' }),
    email: useTextField(form, 'email', { kind: 'email', onSubmit }),
    about: useTextField(form, 'about', { kind: 'multiline' }),
  };
}

async function renderFields(onSubmit: () => void = jest.fn()) {
  return renderHook(() => useThreeFields(onSubmit), { wrapper: createFormTestWrapper().wrapper });
}

function fakeInput(): { focus: jest.Mock } {
  return { focus: jest.fn() };
}

describe('useTextField', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores typed text through onChangeText, never an event object', async () => {
    const { result } = await renderFields();

    await act(() => {
      result.current.name.onChangeText('Sam');
    });

    expect(result.current.name.value).toBe('Sam');
    expect(result.current.form.getValues('name')).toBe('Sam');
  });

  it('stays quiet until the first blur, then shows the translated error', async () => {
    const { result } = await renderFields();
    await act(async () => {
      result.current.name.onChangeText('');
      await jest.runAllTimersAsync();
    });
    expect(result.current.name.error).toBeNull();

    await act(async () => {
      result.current.name.onBlur();
      await jest.runAllTimersAsync();
    });

    expect(result.current.name.error).toBe('Check this field');
  });

  it("shows the generic text for an error without a key, never valibot's English default", async () => {
    const { result } = await renderFields();

    await act(async () => {
      result.current.email.onChangeText('not-an-address');
      result.current.email.onBlur();
      await jest.runAllTimersAsync();
    });

    expect(result.current.email.error).toBe('Check this field');
  });

  it('moves focus to the next field from the return key, keeping the keyboard up', async () => {
    const { result } = await renderFields();
    const email = fakeInput();
    await act(() => {
      result.current.email.ref(email);
    });

    expect(result.current.name).toMatchObject({ enterKeyHint: 'next', submitBehavior: 'submit' });
    await act(async () => {
      result.current.name.onSubmitEditing?.();
      await jest.runAllTimersAsync();
    });

    expect(email.focus).toHaveBeenCalledTimes(1);
  });

  it('submits from the last field and makes new lines in a multiline field', async () => {
    const onSubmit = jest.fn();
    const { result } = await renderFields(onSubmit);

    result.current.email.onSubmitEditing?.();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.email).toMatchObject({
      enterKeyHint: 'done',
      submitBehavior: 'blurAndSubmit',
    });
    expect(result.current.about).toMatchObject({
      enterKeyHint: 'enter',
      submitBehavior: 'newline',
    });
    expect(result.current.about.onSubmitEditing).toBeUndefined();
  });

  it('lets a refused submit focus the first invalid field', async () => {
    const { result } = await renderFields();
    const name = fakeInput();
    const email = fakeInput();
    await act(() => {
      result.current.name.ref(name);
      result.current.email.ref(email);
    });

    await act(async () => {
      await result.current.form.handleSubmit(jest.fn())();
      await jest.runAllTimersAsync();
    });

    expect(name.focus).toHaveBeenCalled();
    expect(email.focus).not.toHaveBeenCalled();
  });
});
