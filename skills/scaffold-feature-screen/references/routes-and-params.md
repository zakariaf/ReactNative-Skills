# Routes and params

How a scaffolded feature meets Expo Router: the route id, the URL, the header title, dynamic params
and the invalid-link state, and the contract entries. Layouts, guards, modals, tabs and the not-found
route belong to navigation-and-routing; links from outside the app to deep-links-and-universal-links.

## Contents

- Route ids and hrefs
- The route file
- The header title: route or layout
- Dynamic routes: parse the params at the edge
- Ids that are not slugs
- The invalid-link state and its way out
- The contracts
- Verified router facts

## Route ids and hrefs

A route id is the route file's path under the routes folder without the extension (the same id
navigation-and-routing's contract uses). The URL drops `(group)` folders and a final `index`:

| `--route` | File | URL (href) | Scaffold group |
|---|---|---|---|
| `(app)/notes` | `src/app/(app)/notes.tsx` | `/notes` | static |
| `(app)/settings/index` | `src/app/(app)/settings/index.tsx` | `/settings` | static |
| `(app)/notes/[noteId]` | `src/app/(app)/notes/[noteId].tsx` | `/notes/<noteId>` | dynamic |
| `(app)/lists/[listId]` | `src/app/(app)/lists/[listId].tsx` | `/lists/<listId>` | dynamic |

The generator writes static routes and dynamic routes whose **last** segment is one
`[camelCaseParam]` (naming-conventions: URL segments kebab-case, params camelCase, because the param
name is the key of `useLocalSearchParams()`). It refuses a bracket in the middle
(`(app)/[listId]/notes`), catch-all routes (`[...rest]`), layouts and `+` files: those have shapes a
template cannot guess, so write them by hand after the templates and let `check-feature.mjs` prove the
result. A static route and its dynamic child live side by side (`notes.tsx` and `notes/[noteId].tsx`).

## The route file

```tsx
// src/app/(app)/notes/[noteId].tsx
import { Stack } from 'expo-router';

import { NoteDetailScreen } from '@/features/note-detail/note-detail-screen';
import { useNoteDetailModel } from '@/features/note-detail/use-note-detail-model';

export default function NoteDetailRoute(): React.JSX.Element {
  const model = useNoteDetailModel();
  return (
    <>
      <Stack.Screen options={{ title: model.title }} />
      <NoteDetailScreen model={model} />
    </>
  );
}
```

It imports router components (`Stack`) and the feature's two files, nothing else. It does not call
`useLocalSearchParams`: the model reads the params, so the route test and the model test see the
same code path.

This is stricter than architecture-and-boundaries' `route-thin`, which allows a route to read router
params and pass them down as props. This unit follows navigation-and-routing (the model hook parses
the params) and the house layout, where the model hook is the only code that reads navigation:
params read in the route reach the view unparsed, and the model test, which renders the hook inside
a router, never sees them. `check-feature.mjs` therefore fails a route that calls
`useLocalSearchParams` (`params-in-model`) even where `check-boundaries` passes it.

## The header title: route or layout

Two places can set a screen's header options, and both are documented for SDK 57: a
`<Stack.Screen name="notes" options={...} />` in the parent layout, or `<Stack.Screen options={...} />`
rendered inside the route. The scaffold uses the route form because the title is a translated value
the model already holds; a layout would need its own `useT()` and its own key per screen. Static
options that never change (`presentation`, `headerShown`, gesture settings) belong in the layout,
as navigation-and-routing says. architecture-and-boundaries' layout reference puts the title on the
group layout's `<Stack.Screen>` too; that suits a static title, while a translated one from the model
stays in the route, as here. Expo Router 57 also ships an alpha composition API
(`<Stack.Title>`, `<Stack.Header>`, `<Stack.Toolbar>`, available since SDK 55); it is
interchangeable with the options form, and the scaffold keeps the stable options form.

A route under a `Tabs` layout (`(tabs)/notes`) sets its options with `<Tabs.Screen options>` instead
of `<Stack.Screen>`; change the import after generating. A tab's own stack (a `_layout.tsx` with a
`Stack` inside the tab folder) keeps `Stack.Screen`.

## Dynamic routes: parse the params at the edge

Every Expo Router route is a URL. A deep link, a notification, a shared link or a typo can open
`/notes/<anything>`; a repeated query key (`?noteId=a&noteId=b`) arrives as an array; and the type
argument of `useLocalSearchParams<{ noteId: string }>()` is a cast that checks nothing at run time.
So the model hook parses:

```ts
// src/features/note-detail/note-detail-params.ts (the template, filled)
const PARAMS_SCHEMA = v.object({
  noteId: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)),
});

export function parseNoteDetailParams(raw: RawRouteParams): Result<NoteDetailParams, NoteDetailParamsFailure> {
  const parsed = v.safeParse(PARAMS_SCHEMA, raw);
  if (!parsed.success) return err({ kind: 'invalid-route-params' });
  return ok({ noteId: parsed.output.noteId });
}
```

- The schema key **equals the bracket name**; `check-feature.mjs` fails a parser that does not name
  every `[param]` of its route (`params-parser`).
- `v.object` ignores extra keys, so query params (`?utm=mail`) do not break a link; the test proves it.
- An array (a repeated key), an empty string, a path (`../settings`) and anything longer than the limit
  fail; the test lists each.
- Params stay ids and short plain values. The screen reads the note from its store, repository or
  query by id; never pass an object through the URL (it is visible, unbounded and stale on the next
  open).
- `useLocalSearchParams` (not `useGlobalSearchParams`) in a stack screen: it updates only while this
  route is focused, so a screen below does not re-render when another opens.

## Ids that are not slugs

The template accepts kebab slugs (`item-7`). Change the schema to the app's id shape, in the parser
and its test together:

```ts
// numeric database ids (the Tasks repository's list ids)
listId: v.pipe(v.string(), v.regex(/^[1-9]\d{0,11}$/u), v.transform(Number)),

// UUIDs
noteId: v.pipe(v.string(), v.uuid()),
```

The params type then says `listId: number`, and the model passes a number to the repository. A
complete example is `examples/list-detail/list-detail-params.ts` in this skill.

## The invalid-link state and its way out

A failed parse is a state of the screen, not a crash and not a redirect: the view shows one sentence
on why (never the URL itself, which can hold anything) and one button. The button calls
`router.dismissTo('/')`, or `dismissTo` the first screen that `contracts/navigation.json` names in
`home` when that is another plain href (the generator writes it into the model and into both tests'
stand-in route; a home it cannot write, such as one with a parameter, is a plan note to edit by hand):

- `dismissTo` "dismisses screens until the provided href is reached"; when the href is not in the
  stack it replaces the current screen with it (SDK 57 router reference). So with home below, the
  person returns to it; on a cold-start link, the dead link is replaced and Back cannot reopen it.
- `router.navigate('/')` and `push` stack a second home (navigation-and-routing's `go-back` rule);
  `router.replace('/')` deep in a stack leaves the screens below it.

When the id parses but names nothing (a deleted note), that is the screen's `not-found` or `empty`
state, built test-first as the screen grows (ui-states-and-feedback), with the same way out.

## The contracts

When the app keeps navigation-and-routing's route contract, the generator adds:

```json
"routes": ["(app)/index", "+not-found", "(app)/notes", "(app)/notes/[noteId]"],
"paramParsers": {
  "(app)/notes/[noteId]": "src/features/note-detail/note-detail-params.ts"
}
```

When the app keeps screen-contracts' screen contract, it appends the entry: `id`, `name` (the title),
`presentation: "route"`, `route`, `model`, `view`, the states (`default`, or `ready` plus
`invalid-link` with `drawn: false` and its why) and the elements with testIDs, roles, components and
copy keys. Review the entry against the design and extend it before the screen grows
(screen-contracts' workflow). `check-feature.mjs` checks the entries exist and point at the right files
(`nav-contract`, `screen-contract`); the owners' checkers check everything else.

## Verified router facts

- On 2026-10-14 against the SDK 57 docs (`docs.expo.dev/versions/v57.0.0/sdk/router/`, `/router/advanced/stack/`):
  `useLocalSearchParams` returns the focused route's params and updates only while focused;
  `dismissTo` dismisses until the href, else replaces the current screen; `<Stack.Screen options>`
  inside a route and the composition API are both supported.
- In the reference app (expo-router 57.0.24, `experiments.typedRoutes: true`), the template tests prove:
  a valid id opens the ready state; `Not%20An%20Id` opens the invalid-link state; its way out leaves
  `router.canGoBack()` false on a cold start; the parser rejects an array (a repeated key), an empty id
  and a path (the parser test).
- Re-verify after an SDK upgrade: read the router reference for the new version, run
  `npx jest src/features/<a scaffolded feature> --ci`, and rerun this skill's selftest.
