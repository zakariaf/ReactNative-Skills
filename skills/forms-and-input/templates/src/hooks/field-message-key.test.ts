// src/hooks/field-message-key.test.ts
// no-providers: pure functions over the source catalog.
import { FALLBACK_FIELD_MESSAGE, fieldMessageKey, isMessageKey } from './field-message-key';

describe('fieldMessageKey', () => {
  it('is null for a field without an error', () => {
    expect(fieldMessageKey(undefined)).toBeNull();
  });

  it('keeps a message that is a catalog key', () => {
    expect(fieldMessageKey({ type: 'required', message: 'task-editor.title.required' })).toBe(
      'task-editor.title.required',
    );
  });

  it("falls back for valibot's English default and for prose", () => {
    const english = 'Invalid length: Expected !0 but received 0';

    expect(fieldMessageKey({ type: 'required', message: english })).toBe(FALLBACK_FIELD_MESSAGE);
    expect(fieldMessageKey({ type: 'conflict', message: 'Already taken' })).toBe(
      FALLBACK_FIELD_MESSAGE,
    );
  });

  it('falls back for an error without a message', () => {
    expect(fieldMessageKey({ type: 'required' })).toBe(FALLBACK_FIELD_MESSAGE);
  });
});

describe('isMessageKey', () => {
  it('knows the fallback key and refuses an inherited name', () => {
    expect(isMessageKey(FALLBACK_FIELD_MESSAGE)).toBe(true);
    expect(isMessageKey('toString')).toBe(false);
  });
});
