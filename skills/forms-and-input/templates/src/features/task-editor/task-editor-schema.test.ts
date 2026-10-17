// src/features/task-editor/task-editor-schema.test.ts
// no-providers: the schema is pure. Every message the schema can produce is a catalog key; the
// last test proves each one exists in every catalog.
import * as v from 'valibot';

import ar from '@/i18n/catalogs/ar.json';
import en from '@/i18n/catalogs/en.json';

import {
  EMPTY_TASK_EDITOR,
  ESTIMATE_MAX_MINUTES,
  TASK_TITLE_MAX,
  taskEditorSchema,
  titleKeyOf,
} from './task-editor-schema';

import type { TaskEditorInput } from './task-editor-schema';

const SCHEMA = taskEditorSchema(['Buy milk']);

function messagesOf(input: Partial<TaskEditorInput>): readonly string[] {
  const result = v.safeParse(SCHEMA, { ...EMPTY_TASK_EDITOR, title: 'Call Sam', ...input });
  return result.success ? [] : result.issues.map((issue) => issue.message);
}

describe('taskEditorSchema', () => {
  it('trims and hands on a valid draft, estimate as a number', () => {
    const result = v.parse(SCHEMA, { title: '  Call Sam ', notes: ' ', estimateMinutes: '45' });

    expect(result).toStrictEqual({ title: 'Call Sam', notes: '', estimateMinutes: 45 });
  });

  it('needs a title that is more than spaces', () => {
    expect(messagesOf({ title: '   ' })).toStrictEqual(['task-editor.title.required']);
  });

  it('bounds the title at its storage limit', () => {
    expect(messagesOf({ title: 'a'.repeat(TASK_TITLE_MAX) })).toStrictEqual([]);
    expect(messagesOf({ title: 'a'.repeat(TASK_TITLE_MAX + 1) })).toStrictEqual([
      'task-editor.title.too-long',
    ]);
  });

  it('refuses a title an open task already has, whatever its case and spacing', () => {
    expect(messagesOf({ title: ' buy   MILK' })).toStrictEqual(['task-editor.title.duplicate']);
    expect(titleKeyOf(' Buy  Milk ')).toBe('buy milk');
  });

  it('reads an estimate typed in Arabic-Indic digits', () => {
    const result = v.parse(SCHEMA, {
      ...EMPTY_TASK_EDITOR,
      title: 'Call Sam',
      estimateMinutes: '٣٠',
    });

    expect(result.estimateMinutes).toBe(30);
  });

  it('keeps an empty estimate as null and refuses words and out-of-range minutes', () => {
    expect(v.parse(SCHEMA, { ...EMPTY_TASK_EDITOR, title: 'Call Sam' }).estimateMinutes).toBeNull();
    expect(messagesOf({ estimateMinutes: 'soon' })).toStrictEqual([
      'task-editor.estimate.not-a-number',
    ]);
    expect(messagesOf({ estimateMinutes: String(ESTIMATE_MAX_MINUTES + 1) })).toStrictEqual([
      'task-editor.estimate.out-of-range',
    ]);
  });

  it('produces only messages that exist in every catalog', () => {
    const produced = [
      ...messagesOf({ title: '' }),
      ...messagesOf({ title: 'a'.repeat(TASK_TITLE_MAX + 1) }),
      ...messagesOf({ title: 'Buy milk' }),
      ...messagesOf({ notes: 'a'.repeat(2001) }),
      ...messagesOf({ estimateMinutes: 'x' }),
      ...messagesOf({ estimateMinutes: '0' }),
    ];

    expect(produced).toHaveLength(6);
    for (const key of produced) {
      expect(Object.hasOwn(en, key) && Object.hasOwn(ar, key)).toBe(true);
    }
  });
});
