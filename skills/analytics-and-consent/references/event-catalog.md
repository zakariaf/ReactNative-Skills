# The event catalog: typed events without personal data

`templates/src/services/analytics/analytics-events.ts` is the only list of events the app may send.
tsc checks every `track()` call against it, `analytics-sanitize.ts` checks again at run time, and
check-analytics reads it as data.

## Contents

- Shape
- Property kinds (and why there is no free text)
- Names and limits
- Personal data: what never goes into an event
- Screen views with Expo Router
- Where track() is called
- Changing the catalog
- Tests

## Shape

```ts
export const ANALYTICS_EVENTS = {
  task_created: {
    purpose: 'How tasks are created, to improve the editor.',
    props: {
      list_kind: { kind: 'enum', values: ['inbox', 'custom'] },
      has_due_date: { kind: 'boolean' },
    },
  },
} as const satisfies Readonly<Record<string, AnalyticsEventSpec>>;
```

`AnalyticsEvent` is derived from it (a discriminated union on `name`), so
`analytics.track({ name: 'task_created', props: { list_kind: 'inbox', has_due_date: true } })`
compiles and `list_kind: 'Groceries'` does not. Keep the object plain data: no spreads, no computed
keys, no imported constants (check-analytics `event-catalog` reads it without a compiler).

Every event has a `purpose`: one sentence naming the decision the event informs. An event nobody
can name a decision for is collection without a purpose (GDPR's purpose limitation; Apple asks for
purposes per data type) and is deleted instead.

## Property kinds (and why there is no free text)

| Kind | Sent as | Use for |
|---|---|---|
| `enum` | one of `values` (lowercase words) | categories: which list, which source, which option |
| `boolean` | true / false | "has a due date", "used the template" |
| `count` | a whole number from 0 to `max` (larger sent as `max`) | sizes and durations, bucketed so a value cannot single out a person |
| `route` | a route pattern (`tasks/[id]`) | `screen_view` only |

There is no `string` kind on purpose. A free string is where task titles, search terms, email
addresses and error messages with personal data end up, usually by accident months later. If a value
seems to need free text, it is user content: either it is not analytics, or it becomes an enum of the
few values that matter.

The sanitizer drops an event whose value does not match its spec, removes undeclared properties,
clamps counts and refuses negative or fractional ones (check-analytics-behaviour `sanitize`).

## Names and limits

The portable limits are Google Analytics 4's, the strictest of the common vendors (support.google.com
answers 9267744 and 13316687, read 2026-10-14), enforced by check-analytics `event-name` and
`event-props`:

- names start with a letter, use lowercase letters, digits and underscores (snake_case); case
  sensitive, so lowercase only;
- event and property names at most 40 characters; at most 25 properties per event; values at most 100
  characters;
- never a vendor-reserved name: `session_start`, `first_open`, `app_update`, `error`,
  `notification_open` (the full list is `events.reservedNames` in assets/analytics-facts.json;
  `screen_view` is not reserved); never the reserved prefixes `firebase_`,
  `google_`, `ga_` or `$` (PostHog's own properties).

Name events `object_action` in the past tense (`task_created`, `reminder_scheduled`,
`paywall_viewed`): one event per user action, the variation in properties.

## Personal data: what never goes into an event

check-analytics `event-pii` fails an event or property whose name (or one of its `_` parts) is a
personal-data word: email, phone, name, title, text, note, message, query, search, address, location,
latitude, ip, password, token, any `id` (user, account, device, install, task), advertising ids,
birthday, url, path. The list is `events.piiWords` in the facts table.

- **No ids of the app's records.** A task id joins analytics to the user's own data. Send what kind
  of thing happened, not to which record.
- **No user content.** Titles, notes, search terms, file names.
- **No identity.** The SDK's anonymous install id is the only identifier (declared as `device-id`).
  An account id is sent only when the contract says `identifies: true` and the declarations say
  linked (store-declarations.md); never an email or a name.
- **No exact times or places.** Durations as bucketed counts; no location.
- **No error messages.** They contain paths and user input; crash reporting has its own scrubbing
  (crash-reporting-and-observability).

## Screen views with Expo Router

`useScreenViews(onScreen)` (`templates/src/hooks/use-screen-views.ts`) reports
`screenNameFromSegments(useSegments())`: the file route pattern with groups removed (`(app)`,
`tasks`, `[id]` becomes `tasks/[id]`). Expo's own screen-tracking guide sends `usePathname()` and the
params; this skill does not, because a concrete path carries record ids and whatever the URL holds
(search terms, tokens from a deep link). check-analytics `screen-pathname` fails screen tracking
that reads `usePathname`, `useGlobalSearchParams` or `useLocalSearchParams`, any `track()` whose
arguments mention a path, a URL or params, `usePathname()` in any file that also calls `track()`,
and a search-param value that reaches a `track()` argument by its own name
(`const { id } = useLocalSearchParams(); track({ ..., props: { screen: id } })`). `useSegments` is
exported by expo-router 57 (`build/hooks/useSegments.d.ts`, read 2026-10-14). An event about an
incoming link carries only the gate's decision kind and the matched route pattern
(deep-links-and-universal-links' `LinkDecision.path`), never the URL or its values: a link may carry
a token.

Limits, by design: the checker is a text heuristic. A param copied into another variable first
(`const where = id; track({ ... where })`) is not followed, and reading search params for the
screen's own work in a model that also tracks is fine. The run-time guard has a limit too:
`sanitizeEvent` accepts a `route` value whose segments look like route segments, so a concrete slug
path such as `notes/my-note-title` passes as if it were a pattern. That is why `route` props come
only from `screenNameFromSegments(useSegments())`, never from a path the code assembled; the review
and the checker hold that line, the sanitizer cannot.

The analytics root kit mounts it once, beside the root Stack (`ScreenViews` in
`analytics-root-kit.tsx`, through app-startup-and-bootstrap's effects slot): the hook calls
`onScreen` once per route change through `useEffectEvent`, so a new callback each render does not
re-send. The gate drops the events until the user said yes.

When multi-package or with React Navigation's static API: report the route name from the navigation
state's `onStateChange` with the same rule (the route's name, never its params).

## Where track() is called

- From the model hook's handler that did the work (`examples/use-tasks-model.ts`), after it
  succeeded, once. Never in render, never in an effect that re-runs on every change.
- With the event name written out as a literal (`track({ name: 'task_created', ... })`):
  check-analytics `track-literal` fails a computed name and a name outside the catalog, so a
  reviewer can find every place an event is sent with one search.
- Views never call it: they receive handlers from the model (screen-contracts, react-components-and-hooks).

## Changing the catalog

A catalog change is a privacy change:

1. Add or change the event and its purpose; keep the kinds closed.
2. If it collects a new kind of data (search history, purchases, a user id), add the data type to
   `contracts/analytics.json` `collects` and raise `ANALYTICS_CONSENT_VERSION`
   (consent-gate.md): users are asked again before it is sent.
3. Update App Store Connect's App Privacy answers and Play's Data safety form if `collects` changed
   (store-declarations.md).
4. Run both checkers.

Renaming an event breaks the vendor's dashboards and funnels: add the new event, keep the old one for
one release, then delete it.

## Tests

`analytics-events.test.ts` (names, purposes, type-level enum check with `@ts-expect-error`),
`analytics-sanitize.test.ts` (unknown events, free text, wrong types, missing values, extra
properties, clamping, route patterns), `screen-name.test.ts`, `use-screen-views.test.tsx` (once per
screen, the pattern not the path).
