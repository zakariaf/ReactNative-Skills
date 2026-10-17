# Where state lives

Most state bugs are state in the wrong home: server data copied into a store, a route mirrored in a
store, a form draft in global state, a setting cached in a component. This reference gives each kind of
state its home and says how to move an existing app's state there.

## Contents

- The decision, in order
- Server data
- Navigation
- One screen's UI state
- Form drafts
- Preferences and secrets
- OS state
- Local rows and cross-screen UI choices: the domain stores
- Sessions with undo
- Moving an existing app
- With React Navigation instead of Expo Router

## The decision, in order

Ask these in order; the first yes is the home.

| Question | Home | Owner skill |
|---|---|---|
| Does a server own it (it can change without this device)? | TanStack Query cache | networking-and-server-state |
| Is it where the user is (screen, params, back stack)? | Expo Router | navigation-and-routing |
| Is it a form being filled in? | react-hook-form | forms-and-input |
| Is it a token, a password, a key? | `expo-secure-store` behind a port | auth-and-secure-storage |
| Is it a user preference (theme, language, haptics)? | the settings store | settings-and-preferences |
| Does the phone own it (reduce motion, screen reader, app active)? | an OS-mirror store or a hook | accessibility-as-code, react-components-and-hooks |
| Does only one screen need it, and may it reset when the screen closes? | `useState` in the model hook | react-components-and-hooks |
| Is it a session the user edits with undo, and must survive a kill? | a per-session store | this skill (undoable-session.md) |
| Otherwise: rows the app keeps, or choices several screens share | a domain store | this skill |

## Server data

The cache already does what a store copy would do badly: deduplication, refetch on focus and
reconnect, stale times, retries, cancellation, optimistic updates. A store copy is a second truth that
the next refetch makes wrong, and an effect that copies `query.data` into a store renders twice and
races on fast navigation. Read `useQuery` in the model hook where the data is shown. What the user
chose about server data (a filter, a sort order, a selected id) is client state and may live in a store;
the data itself never does. Offline writes go through the outbox (persistence-and-migrations stores it;
networking-and-server-state syncs it), not a store.

An app on the `offline-only` profile (privacy-and-store-declarations) has no server data; everything
it keeps is local rows, and the rules here do not change.

## Navigation

Expo Router owns where the user is: the route, its params (`useLocalSearchParams`) and the back stack.
A store that mirrors "the current list id" goes stale the moment the user goes back with the Android
back button, predictive back or the iOS edge swipe, because the router changes without telling the
store. Pass ids as params and read them in the model hook. A deep link then works without any store.

## One screen's UI state

An open sheet, an expanded row, a text field's current value before submit: `useState` in the model hook
(or the component that owns it). It resets when the screen unmounts, which is usually right. Move it to a
memory-only store only when a second screen must see it.

## Form drafts

react-hook-form holds the draft, validates it with a valibot resolver, and hands a valid value to a store
method or repository on submit. A draft in a store re-renders every reader on every keystroke. A draft
that must survive a kill is written by the form's own save (forms-and-input decides when).

## Preferences and secrets

Preferences have one owner, the settings store of settings-and-preferences: hydrated before the first
frame from its storage port, persisted before published, with its own provider. Read it through its
hook; never keep a copy. Secrets never enter a store at all: a store's state is visible to every reader,
devtools and crash breadcrumbs. Keep tokens in `expo-secure-store` behind auth-and-secure-storage's port.

## OS state

The phone owns accessibility switches, the app's foreground state and the window size. Mirror them once
(accessibility-as-code's `src/ui/a11y/system-a11y-store.ts`, a module-level store listed in
`contracts/stores.json` `osMirrorStores`; the shared hooks `use-is-app-active` and `use-window-class` of
react-components-and-hooks) and read the mirror. Never persist them: the next launch reads the phone.

## Local rows and cross-screen UI choices: the domain stores

Rows the app keeps (lists and tasks) live in SQLite behind repositories; the domain store is the
in-memory, subscribable copy of those rows that screens read, hydrated synchronously when the store is
made and written through before every publish (store-pattern.md). A choice several screens share but the
app may forget (the filter chip) is a memory-only domain store with the `// memory-only:` marker.

Not every repository needs a store: a screen that reads rows nobody else shows and never changes them
can call the repository in its model hook. Add a store when two screens show the same rows, or when a
change must appear everywhere at once.

## Sessions with undo

A bulk edit, a multi-step editor, a drawing, a game: a per-session store over the undoable session
reducer, created when the session starts and dropped when it ends (undoable-session.md).

## Moving an existing app

- **Zustand `persist` middleware with AsyncStorage or MMKV.** Keep the store's shape; give it a factory
  and a port. Copy the old data once into SQLite (persistence-and-migrations: a one-time import listed in
  `contracts/persistence.json` `legacyImports`, guarded by a done flag), hydrate the new store from the
  repository, then delete the middleware and the old key. Ship the import before removing it.
- **A `create(...)` hook-store singleton.** Move the initializer into `create<Domain>Store(deps)`, add it
  to `createStores`, and replace `useXStore()` call sites with selectors.
- **React Context plus `useReducer` for app state.** The reducer moves as it is into `<domain>-reducer.ts`
  (add its cases table); the provider's state becomes a store; context keeps carrying only the stores.
  Every consumer that re-rendered on any change now selects what it shows.
- **Redux Toolkit.** A slice becomes a reducer plus a store; `createAsyncThunk` calls that fetch become
  TanStack Query queries and mutations; thunks that write locally become store methods over a
  repository; selectors move to `<domain>-selectors.ts` (memoized selectors that build objects become
  `useShallow` call sites). Move one slice at a time; both libraries can run side by side meanwhile.
- **MobX or another observable store.** Each observable class becomes a reducer (the logic) and a store
  (the state); computed values become selectors or pure functions in the model hook.

## With React Navigation instead of Expo Router

The same rule holds: the navigator owns the route and its params (`route.params`, typed through the
static API), and no store mirrors them. A screen reads its params in its model hook. The hardware back
button and gestures change the navigator only, so a mirrored copy would go stale there too.
