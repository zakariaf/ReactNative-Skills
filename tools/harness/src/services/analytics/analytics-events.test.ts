// src/services/analytics/analytics-events.test.ts
// The catalog's own hygiene, as tests (check-analytics enforces the same rules on the source).
import { ANALYTICS_EVENTS, isAnalyticsEventName } from './analytics-events';

import type { AnalyticsEvent } from './analytics-events';

const SNAKE_CASE = /^[a-z][a-z0-9_]{0,39}$/;

describe('ANALYTICS_EVENTS', () => {
  it('names events and properties in snake_case within 40 characters', () => {
    for (const [name, spec] of Object.entries(ANALYTICS_EVENTS)) {
      expect(name).toMatch(SNAKE_CASE);
      for (const key of Object.keys(spec.props)) expect(key).toMatch(SNAKE_CASE);
    }
  });

  it('gives every event a purpose', () => {
    for (const spec of Object.values(ANALYTICS_EVENTS))
      expect(spec.purpose.length).toBeGreaterThan(10);
  });

  it('knows its own names and nothing inherited', () => {
    expect(isAnalyticsEventName('screen_view')).toBe(true);
    expect(isAnalyticsEventName('constructor')).toBe(false);
  });

  it('types events from the catalog', () => {
    const event: AnalyticsEvent = { name: 'reminder_scheduled', props: { lead_time: 'one_hour' } };
    // @ts-expect-error: a value outside the enum does not compile
    const wrong: AnalyticsEvent = { name: 'reminder_scheduled', props: { lead_time: 'tomorrow' } };
    expect([event.name, wrong.name]).toStrictEqual(['reminder_scheduled', 'reminder_scheduled']);
  });
});
