// src/features/task-editor/use-task-editor-model.test.tsx
// The model over a real form and the real catalogs; save is a fake that records drafts. Fake
// inputs stand in for the fields' refs to observe where focus goes.
import { act, renderHook } from '@testing-library/react-native';

import { err, ok } from '@/core/result';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';
import { createFormTestWrapper } from '@test/forms/i18n-form-wrapper';

import { useTaskEditorModel } from './use-task-editor-model';

import type { SaveTask, TaskEditorDeps } from './use-task-editor-model';
import type { Result } from '@/core/result';

function deps(
  save: SaveTask = jest.fn(() => Promise.resolve(ok(undefined))),
): TaskEditorDeps & { onSaved: jest.Mock } {
  return { openTitles: ['Buy milk'], save, onSaved: jest.fn() };
}

async function renderModel(given: TaskEditorDeps) {
  const { wrapper } = createFormTestWrapper({ services: { errorLog: createFakeErrorLog() } });
  return renderHook(() => useTaskEditorModel(given), { wrapper });
}

async function submit(onSubmit: () => void): Promise<void> {
  await act(async () => {
    onSubmit();
    await jest.runAllTimersAsync();
  });
}

describe('useTaskEditorModel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('labels every field and chains title to notes', async () => {
    const { result } = await renderModel(deps());

    expect(result.current.title).toMatchObject({
      label: 'Title',
      kind: 'sentence',
      enterKeyHint: 'next',
    });
    expect(result.current.notes).toMatchObject({ label: 'Notes', kind: 'multiline' });
    expect(result.current.estimate).toMatchObject({ kind: 'integer', enterKeyHint: 'done' });
    expect(result.current.submitLabel).toBe('Add task');
  });

  it('refuses an empty title, says why, focuses it and saves nothing', async () => {
    const given = deps();
    const { result } = await renderModel(given);
    const title = { focus: jest.fn() };
    await act(() => {
      result.current.title.ref(title);
    });

    await submit(result.current.onSubmit);

    expect(given.save).not.toHaveBeenCalled();
    expect(result.current.title.error).toBe('Give the task a title');
    expect(title.focus).toHaveBeenCalled();
  });

  it('saves the parsed draft, then clears the form', async () => {
    const given = deps();
    const { result } = await renderModel(given);
    await act(() => {
      result.current.title.onChangeText('  Call Sam ');
      result.current.estimate.onChangeText('٣٠');
    });

    await submit(result.current.onSubmit);

    expect(given.save).toHaveBeenCalledWith({ title: 'Call Sam', notes: '', estimateMinutes: 30 });
    expect(given.onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.title.value).toBe('');
  });

  it('keeps the next draft quiet until its first blur when the form stays open after a save', async () => {
    const given = deps();
    const { result } = await renderModel(given);
    await act(() => {
      result.current.title.onChangeText('Call Sam');
    });
    await submit(result.current.onSubmit);

    await act(async () => {
      result.current.title.onChangeText(' ');
      await jest.runAllTimersAsync();
    });
    expect(result.current.title.error).toBeNull();

    await act(async () => {
      result.current.title.onBlur();
      await jest.runAllTimersAsync();
    });
    expect(result.current.title.error).toBe('Give the task a title');
  });

  it('keeps everything typed when the save fails, and says so', async () => {
    const given = deps(jest.fn(() => Promise.resolve(err({ kind: 'storage-full' }))));
    const { result } = await renderModel(given);
    await act(() => {
      result.current.title.onChangeText('Call Sam');
    });

    await submit(result.current.onSubmit);

    expect(given.onSaved).not.toHaveBeenCalled();
    expect(result.current.title.value).toBe('Call Sam');
    expect(result.current.failure).toBe(
      'The task wasn’t saved. Your text is still here, so try again.',
    );
  });

  it('saves once when submit is pressed again while the save runs', async () => {
    let finish: (result: Result<void, { readonly kind: string }>) => void = () => undefined;
    const save = jest.fn(
      () =>
        new Promise<Result<void, { readonly kind: string }>>((resolve) => {
          finish = resolve;
        }),
    );
    const given = deps(save);
    const { result } = await renderModel(given);
    await act(() => {
      result.current.title.onChangeText('Call Sam');
    });

    await submit(result.current.onSubmit);
    await submit(result.current.onSubmit);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(true);
    await act(async () => {
      finish(ok(undefined));
      await jest.runAllTimersAsync();
    });
    expect(given.onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('refuses a title an open task already has', async () => {
    const given = deps();
    const { result } = await renderModel(given);
    await act(() => {
      result.current.title.onChangeText('buy milk');
    });

    await submit(result.current.onSubmit);

    expect(given.save).not.toHaveBeenCalled();
    expect(result.current.title.error).toBe('An open task already has this title');
  });
});
