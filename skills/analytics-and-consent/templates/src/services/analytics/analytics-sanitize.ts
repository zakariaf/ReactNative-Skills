// src/services/analytics/analytics-sanitize.ts
// The runtime half of the catalog: tsc already rejects an event that is not in it, but a cast, a
// JavaScript caller or a value computed at run time can still slip through. Nothing that does not
// match ANALYTICS_EVENTS exactly ever reaches the SDK: an unknown event or a wrong value drops the
// event, an undeclared property is removed, a count is clamped into its bucket.
import { ANALYTICS_EVENTS, isAnalyticsEventName } from './analytics-events';

import type { AnalyticsPropSpec } from './analytics-events';
import type { AnalyticsProps, AnalyticsValue } from './analytics-port';

/** An event as it arrives at the gate (typed callers send AnalyticsEvent; anything is checked). */
export type RawAnalyticsEvent = {
  readonly name: string;
  readonly props: Readonly<Record<string, unknown>>;
};

/** What may leave the device, or why nothing does. */
export type SanitizedEvent =
  | { readonly ok: true; readonly name: string; readonly props: AnalyticsProps }
  | { readonly ok: false; readonly reason: string };

/** A route pattern: lowercase words, [param], [...rest] or +not-found, joined by '/'. */
const ROUTE_SEGMENT = /^(?:[a-z][a-z0-9_-]*|\[(?:\.\.\.)?[A-Za-z][A-Za-z0-9_]*\]|\+not-found)$/;
const ROUTE_MAX_LENGTH = 100;

/** True for 'index', 'tasks/[id]', 'settings/privacy'; false for 'tasks/42' or '(app)/tasks'. */
export function isRoutePattern(value: string): boolean {
  if (value.length === 0 || value.length > ROUTE_MAX_LENGTH) return false;
  return value.split('/').every((segment) => ROUTE_SEGMENT.test(segment));
}

function checkValue(spec: AnalyticsPropSpec, value: unknown): AnalyticsValue | null {
  switch (spec.kind) {
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? value : null;
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'count':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
      return Math.min(value, spec.max);
    case 'route':
      return typeof value === 'string' && isRoutePattern(value) ? value : null;
  }
}

/** Checks one event against the catalog and returns exactly the values that may be sent. */
export function sanitizeEvent(event: RawAnalyticsEvent): SanitizedEvent {
  if (!isAnalyticsEventName(event.name)) {
    return { ok: false, reason: `event ${event.name} is not in the catalog` };
  }
  const specs: Readonly<Record<string, AnalyticsPropSpec>> = ANALYTICS_EVENTS[event.name].props;
  const props: Record<string, AnalyticsValue> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = checkValue(spec, event.props[key]);
    if (value === null) {
      return { ok: false, reason: `${event.name}.${key} does not match its ${spec.kind} spec` };
    }
    props[key] = value;
  }
  return { ok: true, name: event.name, props };
}
