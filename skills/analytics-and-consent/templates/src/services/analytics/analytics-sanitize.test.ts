// src/services/analytics/analytics-sanitize.test.ts
import { isRoutePattern, sanitizeEvent } from './analytics-sanitize';

describe('sanitizeEvent', () => {
  it('passes a catalog event with exactly its declared values', () => {
    expect(
      sanitizeEvent({
        name: 'task_created',
        props: { list_kind: 'custom', has_due_date: false, has_reminder: true },
      }),
    ).toStrictEqual({
      ok: true,
      name: 'task_created',
      props: { list_kind: 'custom', has_due_date: false, has_reminder: true },
    });
  });

  it('drops an event that is not in the catalog', () => {
    expect(sanitizeEvent({ name: 'task_title_typed', props: {} }).ok).toBe(false);
    expect(sanitizeEvent({ name: 'toString', props: {} }).ok).toBe(false);
  });

  it('drops an event whose value is free text, the wrong type or missing', () => {
    const base = { list_kind: 'inbox', has_due_date: true, has_reminder: false };
    expect(
      sanitizeEvent({ name: 'task_created', props: { ...base, list_kind: 'Buy milk' } }).ok,
    ).toBe(false);
    expect(
      sanitizeEvent({ name: 'task_created', props: { ...base, has_due_date: 'yes' } }).ok,
    ).toBe(false);
    expect(sanitizeEvent({ name: 'task_created', props: { list_kind: 'inbox' } }).ok).toBe(false);
  });

  it('removes undeclared properties', () => {
    const result = sanitizeEvent({
      name: 'paywall_viewed',
      props: { source: 'settings', email: 'someone@example.com' },
    });
    expect(result).toStrictEqual({
      ok: true,
      name: 'paywall_viewed',
      props: { source: 'settings' },
    });
  });

  it('clamps counts into their bucket and refuses negative or fractional counts', () => {
    const event = (days: number) =>
      sanitizeEvent({ name: 'task_completed', props: { list_kind: 'inbox', days_open: days } });
    expect(event(400)).toStrictEqual({
      ok: true,
      name: 'task_completed',
      props: { list_kind: 'inbox', days_open: 30 },
    });
    expect(event(-1).ok).toBe(false);
    expect(event(1.5).ok).toBe(false);
  });
});

describe('isRoutePattern', () => {
  it('accepts route patterns and refuses concrete paths', () => {
    expect(['index', 'tasks/[id]', 'lists/[...path]', '+not-found'].every(isRoutePattern)).toBe(
      true,
    );
    expect(
      ['tasks/42', '(app)/tasks', 'search/milk?q=1', '', 'a'.repeat(101)].some(isRoutePattern),
    ).toBe(false);
  });
});
