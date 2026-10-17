# The checker and the generator

`scripts/check-deep-links.mjs` proves the rules on the app's own code; `scripts/write-well-known.mjs`
writes (and with `--check` verifies) the hosted files. Both are zero-dependency Node scripts on check-lib;
the repo root is the optional positional argument (default `.`).

## Contents

1. Running them
2. When the check does not apply
3. Rules, what each one catches and the fix
4. The gate-behaviour replay
5. Configuration
6. write-well-known.mjs
7. Self-test

## 1. Running them

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-deep-links.mjs .             # every rule
node ${CLAUDE_SKILL_DIR}/scripts/check-deep-links.mjs . --release   # also placeholder hosts, team id, bundle ids
node ${CLAUDE_SKILL_DIR}/scripts/write-well-known.mjs .             # write <wellKnownDir>/<host>/...
node ${CLAUDE_SKILL_DIR}/scripts/write-well-known.mjs . --check     # CI: fail on missing or stale files
```

The checker evaluates the app config for development, preview and production with `APP_VARIANT` and
`EXPO_PUBLIC_APP_VARIANT` set (a child Node process with type stripping, as Expo does), so the dependencies
the config imports must be installed. It loads `LINK_ROUTES` and `routeIncomingLink` as plain TypeScript
(type stripping, tsconfig aliases): both must stay free of React Native and Expo imports.

## 2. When the check does not apply

- `NOT APPLICABLE: expo-router is not in package.json` — a React Navigation app; follow
  react-navigation-linking.md.
- `NOT APPLICABLE: the app takes no input from links: ...` — no `+native-intent`, no
  `contracts/deep-links.json`, no allow-list, no `associatedDomains` or App Links filter, no dynamic route,
  no `useLocalSearchParams`/`useGlobalSearchParams`, and no route other than `/` while the config
  registers a scheme or verified host. Such an app serves only its first screen, so a link can open
  nothing else. `one-listener` and `open-redirect` run first and can still fail.
- Expo Router opens **every** route file for a link, static ones included: an app with a scheme and a
  static `src/app/settings/delete-account.tsx` takes link input (`<scheme>://settings/delete-account`
  opens it from any web page or app), so the check applies and fails `intent-gate` until the gate is in.
  `_layout`, `+not-found`, `+html`, `+native-intent`, `+middleware`, `_sitemap` and `+api` files serve no
  screen and do not count.

Neither case prints SKIP lines: every file the checker reads is this skill's own target. A passing run
prints `check-deep-links: <n> link facts checked, 0 problems` and `RESULT: PASS`.

## 3. Rules, what each one catches and the fix

| Rule | Catches | Fix |
|---|---|---|
| `intent-gate` | no `src/app/+native-intent.*`; no `redirectSystemPath` export (or a re-export to a missing file); a module that never calls `routeIncomingLink`; a `return` whose expression mentions `path` (bare, `event.path`, `decision.path`), whole or in a branch (`return event.initial ? LINK_FALLBACK : event.path`); what `routeIncomingLink(...)` is given and a returned function are not counted | copy the template intent file and `src/features/deep-links/` |
| `intent-total` | `async`, `await`, `.then(` or `fetch(` in the module that defines `redirectSystemPath`; no `attempt(` or `try {` | keep the decision synchronous; resolve short links in a landing route |
| `one-listener` | a `'url'` listener, `getInitialURL()`, `getLinkingURL()`, `useLinkingURL()`, `useURL()`, `parseInitialURLAsync()` or `legacy_subscribe` in app code | delete it; list the route and read params in the screen model |
| `open-redirect` | `openURL(` / `openBrowserAsync(` / `openAuthSessionAsync(` whose argument refers to a value derived from `useLocalSearchParams()`/`useGlobalSearchParams()` in the same file: the returned object, a destructured name (`const { returnTo } = ...`), and every binding whose first expression mentions the hook call or a derived name, followed to a fixed point: an alias (`const target = search.url`, `String(search.url)`, `search['url']`), the route's parser (`parseHelpParams(raw)`, `parseHelpParams(useLocalSearchParams())`: a valibot `v.url()` field passes any URL, so `parsed.value.returnTo` is still the link's), a narrowing (`typeof raw.next === 'string' ? raw.next : ''`). Accepted: the whole argument is one call of a helper imported from a `config` folder (`openURL(taskWebUrl(id))` with `taskWebUrl` from `@/config/links`) | open only URLs the app builds (`src/config`); see the limits below |
| `link-routes` | the allow-list missing, not loadable in Node, without `LINK_ROUTES`, or unsound: a non-URL segment (group, catch-all, capitals), a dynamic segment without a known kind, a stray `params` key, `query: 'any'` outside a test-build route, a gated route without `open()`, a duplicate path, a query key named like a path param (`query: ['listId']` on `/lists/[listId]`: `open()` would get the unchecked query text) | fix the entry |
| `link-route-exists` | an allow-listed path that no file of `src/app` serves (groups and `index` folded away) | fix the path or remove the entry |
| `link-test-only` | a debug route (the navigation contract's `debugRoutes`, or `/debug/...`) without `testBuildOnly: true` | add it |
| `link-secret` | a query key or param named like a secret on a route without `verifiedOnly`, word by word (camelCase, snake_case, kebab-case): a word `token`, `secret`, `password`, `passwd`, `otp`, `magic` or `session`, or the pairs `api key`, `reset code`, `auth code` (`sessionToken`, `otpCode`, `reset_code`, `apiKey`). A name whose last word is `id` names a record, not a secret (`sessionId` on `/sessions/[sessionId]`, `tokenId`), and words inside other words do not count (`footprint`). On a route whose path names an auth step (a path word `reset`, `recover`, `password`, `verify`, `confirm`, `magic`, `login`, `signin`, `sign`, `auth`, `invite`, `activate`), a bare `code` or a name ending in the word `code` is the provider's one-time code and a secret too (`/reset-password?code=`, `oobCode`, `verificationCode`, `confirmationCode`); everyday codes stay exempt everywhere (`countryCode`, `currencyCode`, `languageCode`, `postalCode`, `zipCode`, `promoCode`) | mark it `verifiedOnly` and send it only as an https link of a verified host |
| `pending-link` | a gate named by a route with no `useLinkGate('<gate>', …)` or no `useOpenPendingLink('<gate>')` in app code | report the guard from its owner; open the waiting link from the first screen behind it |
| `gate-behaviour` | the replay (section 4) found a wrong answer, an href outside the list, or a throw | use the template gate, or fix what the message names |
| `link-contract` | `contracts/deep-links.json` invalid JSON or keys: hosts not bare, a bad web path, no 10-character `appleTeamId` or no fingerprints for a variant with hosts; verified hosts in the config with no contract | fix the contract (`templates/contracts/deep-links.schema.json`) |
| `native-links` | for one variant: an `applinks:` entry with a scheme, path or port, `?mode=` in production, entitlement hosts ≠ contract hosts; an http(s) intent filter without `autoVerify`, without `VIEW`, `BROWSABLE` and `DEFAULT`, or with a custom scheme inside; a verified filter with no `path`/`pathPrefix`/`pathPattern` (Android then opens the app for every page of the host) or paths ≠ `webPaths` as pathPatterns (`/tasks/*` → `/tasks/.*`); filter hosts ≠ contract hosts; an empty `ios.associatedDomains` array (prebuild still writes the entitlement: leave the key out for a variant without hosts) | build both from `linkNativeConfig(readLinkContract(projectRoot), variant)` |
| `web-paths` | hosts without web paths; a web path that matches no listed route; a `verifiedOnly` route no web path reaches | fix `webPaths` or the table |
| `well-known` | a host's AASA or assetlinks.json missing, not JSON, different from what the contract and the config give, or over 128 KB; a folder for a host no longer listed | run `write-well-known.mjs` and deploy |
| `ship-placeholder` (`--release`) | an `example.com` host, an `__UNFILLED__` value, or a `com.example.*` production bundle id or package | use the real values |

## 4. The gate-behaviour replay

The checker imports the app's `routeIncomingLink` and calls it with the production policy: the production
config's schemes and verified hosts, the loaded `LINK_ROUTES`, `isTestBuild: false`. Samples per kind:
`slug` `link-check-1`, `uuid` `0b6f4a8e-7c1d-4e2f-9a3b-5c6d7e8f9a0b`, `int` `42` (a route with another kind
is replayed only by the junk round). Scenarios:

- `<scheme>://` → `home`.
- Each route through the custom scheme with its first query key set to `a%26b` plus `utm_source`: `open`
  with exactly `<path>?<key>=a%26b` (re-encoded, the unknown key dropped). Gated routes: `deferred` with
  the gate closed, `open` with it open. `verifiedOnly` routes: refused through the scheme, `open` through
  `https://<host>`. `testBuildOnly` routes: refused in production, `open` in a test build (with `query: 'any'`
  every pair passes).
- For a route with query keys: a repeated key and a control character → refused.
- For a dynamic route: `..%2Fsettings` and malformed `%E0%A4%A` in the segment → refused.
- A foreign scheme, `javascript:alert(1)`, an unverified https host, an unlisted path, a 5,000-character URL,
  and with a verified host user info, a port and two lookalike hosts (`evil<host>`, the classic
  `endsWith` bug, and `<host>.link-check.invalid`, a `startsWith` or `includes` bug) → refused. With a
  wildcard `*.<root>` host, `evil<root>` (no dot before the root) → refused.
- 60 deterministic junk strings (half behind the scheme): no throw, and any `open` href matches a listed
  route.

Each wrong answer is one `FAIL <gateModule>:1 [gate-behaviour] "<url>" gave <answer>; expected <answer>` line.

### What open-redirect does not see

`open-redirect` follows a link's params through the `const`/`let`/`var` bindings of one file. It does not
see a value that reaches the opener through props, a function parameter, a store, a ref, a reassignment
(`url = params.next`), an array destructuring or another module (a screen passes `returnTo` to a
`<ReturnButton url={returnTo} />` that calls `openURL(url)`; a model puts it in a Zustand store that another
screen opens). Its config-helper exemption trusts the helper's name and folder, not its body: a
`src/config` helper that returns its argument unchanged is an open redirect the checker accepts.
Those are review items: any `openURL`, `openBrowserAsync` or `openAuthSessionAsync` whose argument is not
built in `src/config` from the app's own origin needs a reviewer to trace where it comes from. A URL the
app builds from its own origin plus a param (`openURL(\`https://tasks.example.com/tasks/${params.id}\`)`)
is flagged although its host is fixed: parse the param first (`const id = parseTaskId(params.taskId)`,
the screen model's job anyway) and build the URL in a `src/config` helper from the parsed value
(`openURL(taskWebUrl(id))`, which `open-redirect` accepts), which also keeps the host in one place.

### What the checker does not prove (the template tests do)

- **Rule 5, the refused-link answers.** That a refused or crashed cold link returns `LINK_FALLBACK` and a
  warm one returns `null` (never `/`) is proven by `redirect-system-path.test.ts`, not by the checker:
  `redirectSystemPath` imports the error net and the services, so the checker cannot load it in Node.
  Keep that test (and its cold and warm cases) when changing the module.
- **Returns `intent-gate` cannot read.** A concise arrow body (`export const redirectSystemPath = (e) =>
  e.path`), a path laundered through a local variable (`const raw = event.path; return raw`) or a helper
  of another module. The template keeps one `return` per answer, so a reviewer sees them all.

## 5. Configuration

Paths follow `resolveLayout()` (`src/`, `src/app`, `contracts/`). `rn-skills.config.json` may move this
skill's files:

```json
{
  "deepLinks": {
    "routesModule": "src/features/deep-links/link-routes.ts",
    "gateModule": "src/core/links/route-incoming-link.ts",
    "contract": "contracts/deep-links.json"
  }
}
```

`PARAM_KINDS` is read from `link-route.ts` beside the gate module (default `slug`, `uuid`, `int`). The
navigation contract (`contracts/navigation.json`, navigation-and-routing) gives `debugRoutes`.

**When multi-package:** run each script once per app, with the app folder as the root; each app has its
own config, contract, allow-list and well-known folder.

## 6. write-well-known.mjs

Needs a valid contract with at least one host and an `appleTeamId` (exit 2 otherwise: nothing to write).
For each host folder (a wildcard `*.example.com` is served from `example.com`) it writes the AASA (one
`details` entry: `appIDs` of every variant using the host, one component per web path) and assetlinks.json
(one statement per variant: package and fingerprints), formatted the way Prettier prints JSON (printWidth
from `.prettierrc.json`), and compares as JSON, so reformatting is harmless. It never deletes a folder; the
checker reports stale ones. `--check` writes nothing and fails with `well-known-drift`.

## 7. Self-test

`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs` assembles every case from the shipped templates plus
`tests/bases/app` (a fixture app with six link routes, two verified hosts and installed-skill folders that
plant link bugs, which must stay silent): the good app passes, each `bad-*` case fails for its own rule,
`pass-*` cases print their NOT APPLICABLE fact or pass a scheme-only app, and `error-*` cases exit 2.
