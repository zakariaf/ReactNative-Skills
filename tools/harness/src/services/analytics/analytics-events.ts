// src/services/analytics/analytics-events.ts
// The event catalog: the only events the app may send, each with a closed set of properties. It is
// plain data (check-analytics reads it without a compiler) and the types below derive the
// AnalyticsEvent union from it, so track({ name: 'task_created', props: { ... } }) is checked by tsc.
// A property is an enum member, a boolean, a bucketed count or a route pattern: never free text,
// never an id, never what the user typed. Every event change is a store-declaration review
// (contracts/analytics.json `collects`).

/** One member of a fixed list (lowercase words). */
type EnumProp = { readonly kind: 'enum'; readonly values: readonly string[] };
/** true or false. */
type BooleanProp = { readonly kind: 'boolean' };
/** A whole number from 0 to `max`; larger values are sent as `max` ("max or more"). */
type CountProp = { readonly kind: 'count'; readonly max: number };
/** A route pattern from expo-router's segments ('tasks/[id]'), never a concrete path. */
type RouteProp = { readonly kind: 'route' };

export type AnalyticsPropSpec = EnumProp | BooleanProp | CountProp | RouteProp;

/** Why the event exists (one line a reviewer and the privacy answers can read). */
export type AnalyticsEventSpec = {
  readonly purpose: string;
  readonly props: Readonly<Record<string, AnalyticsPropSpec>>;
};

/** Every event the app may send. Names and property names are snake_case, at most 40 characters. */
export const ANALYTICS_EVENTS = {
  screen_view: {
    purpose: 'Which screens people use, to plan navigation changes.',
    props: { screen: { kind: 'route' } },
  },
  task_created: {
    purpose: 'How tasks are created, to improve the editor.',
    props: {
      list_kind: { kind: 'enum', values: ['inbox', 'custom'] },
      has_due_date: { kind: 'boolean' },
      has_reminder: { kind: 'boolean' },
    },
  },
  task_completed: {
    purpose: 'Whether finished tasks were planned, to tune reminders.',
    props: {
      list_kind: { kind: 'enum', values: ['inbox', 'custom'] },
      days_open: { kind: 'count', max: 30 },
    },
  },
  reminder_scheduled: {
    purpose: 'Which reminder offsets people pick, to choose the defaults.',
    props: {
      lead_time: { kind: 'enum', values: ['at_time', 'ten_minutes', 'one_hour', 'one_day'] },
    },
  },
  paywall_viewed: {
    purpose: 'Where the Premium offer is seen, to place it where it helps.',
    props: { source: { kind: 'enum', values: ['settings', 'list_limit'] } },
  },
} as const satisfies Readonly<Record<string, AnalyticsEventSpec>>;

type Catalog = typeof ANALYTICS_EVENTS;

/** Every event name in the catalog. */
export type AnalyticsEventName = keyof Catalog;

type ValueOf<TSpec> = TSpec extends { readonly kind: 'enum'; readonly values: readonly (infer V)[] }
  ? V
  : TSpec extends { readonly kind: 'boolean' }
    ? boolean
    : TSpec extends { readonly kind: 'count' }
      ? number
      : string;

type PropsOf<TName extends AnalyticsEventName> = {
  readonly [TKey in keyof Catalog[TName]['props']]: ValueOf<Catalog[TName]['props'][TKey]>;
};

/** One event as features pass it to AnalyticsPort.track(). */
export type AnalyticsEvent = {
  [TName in AnalyticsEventName]: { readonly name: TName; readonly props: PropsOf<TName> };
}[AnalyticsEventName];

/** True when `name` is in the catalog (the sanitizer's first check). */
export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.hasOwn(ANALYTICS_EVENTS, name);
}
