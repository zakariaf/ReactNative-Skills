# Test recipes

The four tests every scaffolded feature ships with, what each proves, and how to grow the feature
test-first afterwards. The render helpers and Jest projects are unit-and-component-tests'; the
pressable audit is accessibility-as-code's; the per-state view-test rule is screen-contracts'.

## Contents

- The four tests
- The view test
- The model test
- The route test
- The params test
- Growing test-first
- Running them

## The four tests

| Test | Renders | Proves | Never |
|---|---|---|---|
| `<f>-screen.test.tsx` | the view with a hand-built model, `renderWithProviders` | every state's layout and testIDs, handlers fire, the pressable audit | providers' data, a router |
| `use-<f>-model.test.tsx` | the hook (or a probe route) with the app's `I18nProvider` | real catalog texts, the state for each input, handlers' effects | layout |
| `<f>-navigation.test.tsx` | the real route file in Expo Router's in-memory router, `renderRouterWithProviders` | URL → route → params → model → view once, the cold-start way out | a mocked router |
| `<f>-params.test.ts` | nothing (a pure function) | accepted and rejected param shapes | React |

## The view test

```tsx
function modelWith(state: NoteDetailState, onGoHome: () => void = jest.fn()): NoteDetailModel {
  return { title: 'Screen title', state, body: 'Screen body', invalidLinkText: 'This link opens nothing.',
    goHomeLabel: 'Go home', onGoHome, isReducedMotion: false };
}

it('shows why and the way out in the invalid-link state', async () => {
  await renderWithProviders(<NoteDetailScreen model={modelWith({ kind: 'invalid-link' })} />);

  expect(screen.getByTestId('note-detail.invalid-link-text')).toHaveTextContent('This link opens nothing.');
  expect(screen.getByRole('button', { name: 'Go home' })).toBeOnTheScreen();
  expect(screen.queryByTestId('note-detail.body')).not.toBeOnTheScreen();
  expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
});
```

- The model is plain values: the view test never needs catalogs, stores or a router, so it is fast
  and proves the view reads nothing else (a view that calls `useT()` would throw here).
- One `it` per state, its name containing the state id (`invalid-link`), because screen-contracts'
  `state-untested` looks for it; every block that renders ends with the pressable audit.
- Texts in the view test are deliberately not the catalog's: the view shows whatever it is given.

## The model test

The model reads copy through `useT()`, which needs the app's `I18nProvider` with the source catalog
and an `onError` that throws (a missing key fails the test). The canonical test tree carries no
catalogs, so the test puts the provider inside the providers `createProvidersWrapper` builds:

```tsx
function i18nWrapper(): (props: { readonly children: ReactNode }) => ReactNode {
  const { wrapper: Providers } = createProvidersWrapper();
  return function I18nWrapper({ children }) {
    return (
      <Providers>
        <I18nProvider language="en" digits="automatic" onError={failOnError}>{children}</I18nProvider>
      </Providers>
    );
  };
}
```

A model that reads params needs a router: the dynamic template mounts a `ModelProbe` route that
calls the hook and records each model, opens it with `renderRouterWithProviders(ROUTES, { initialUrl })`
and asserts `latest().state`. Handlers are called inside `act()` and their effect is asserted where
it lands (the pathname after `onGoHome`, a store's state, a fake's call log), never by spying on the
hook.

## The route test

```tsx
const ROUTES = {
  _layout: TestLayout,                   // the app's I18nProvider around a plain <Stack>
  index: HomeStandIn,                    // '/' for the way out
  '(app)/notes/[noteId]': NoteDetailRoute, // the real route file's default export
};

it('leaves a dead link for the first screen with nothing to go back to', async () => {
  const user = userEvent.setup();
  const view = await renderRouterWithProviders(ROUTES, { initialUrl: '/notes/Not%20An%20Id' });

  await user.press(screen.getByRole('button', { name: 'Go to the first screen' }));

  expect(await screen.findByText('Home')).toBeOnTheScreen();
  expect(view.getPathname()).toBe('/');
  expect(router.canGoBack()).toBe(false);
});
```

- It lives in the feature (`src/features/<f>/<f>-navigation.test.tsx`), never in `src/app`, which
  Expo Router bundles whole.
- `renderRouterWithProviders` (unit-and-component-tests), never Expo Router's `renderRouter` directly:
  with RNTL 14 its matchers throw and it leaves fake timers on.
- The route keys are route ids; a stand-in for `index` gives the way out a target. Stand-in hrefs a
  test pushes that typed routes do not know are cast in the test only (`as Href`), never in app code.

## The params test

```ts
it.each([
  ['a missing id', {}],
  ['an empty id', { noteId: '' }],
  ['a repeated key (an array)', { noteId: ['item-1', 'item-2'] }],
  ['a path inside the id', { noteId: '../settings' }],
  ['an id of 65 characters', { noteId: 'a'.repeat(65) }],
])('rejects %s', (_label, raw) => {
  expect(parseNoteDetailParams(raw)).toStrictEqual({ ok: false, error: { kind: 'invalid-route-params' } });
});
```

Keep the boundary examples (exactly 64 accepted, 65 rejected): they are what kills mutants of the
limit (unit-and-component-tests' mutation score). Change them with the schema.

## Growing test-first

The scaffold renders a skeleton. Each next behaviour starts as a failing test:

1. **Read data by id.** In the model test, pass the fake repository or seed the store through the
   test app (`createProvidersWrapper({ services })`), open a valid id, expect `state` to be
   `{ kind: 'ready', note }`. Then read it in the model. Example: `examples/list-detail/`.
2. **A state the contract lists** (`loading`, `empty`, `error`, `not-found`). Add it to the pure state
   chooser's test first, then to the union, the view test (one block named for it) and the view.
3. **A handler.** In the model test call it inside `act()` and assert where its effect lands; in the
   view test press the control and assert the handler was called once.
4. **A new text.** Add the key to the source catalog and every other catalog in the same change, then
   to the model test's expectation; `check-feature.mjs` fails a key a catalog lacks.

## Running them

```sh
npx jest src/features/note-detail --ci --maxWorkers=2                 # the unit project
npx jest src/features/note-detail --ci --selectProjects unit android  # paths first: --selectProjects takes every word after it
```

A test that exercises Android behaviour (the hardware back button) is `<unit>.android.test.tsx`, run
by the `android` project; never overwrite `Platform.OS` (unit-and-component-tests).
