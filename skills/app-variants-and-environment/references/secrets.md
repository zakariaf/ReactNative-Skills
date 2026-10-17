# Secrets

What counts as a secret in an Expo app, where each kind lives, what ends up inside the binary, and what
to do after a leak. Verified on 2026-10-03 against the Expo SDK 57 packages (`@expo/config`
`getConfig`), the Expo environment-variable docs and EAS CLI 24.10.0. The repository-wide secret audit
and the store privacy answers belong to `privacy-and-store-declarations`; this file covers the
environment surface: variables, env files, eas.json and the app config.

## Contents

- Public by design versus secret
- Where each secret lives
- Runtime secrets: API routes
- What ships inside the app
- The canary check (secret-config)
- Committed files: eas.json and env files
- .gitignore
- What the checkers look for
- After a leak (human steps)

## Public by design versus secret

Anything inside the app binary is public: a JS bundle (plain or Hermes bytecode) keeps string literals
readable, and the native files (Info.plist, AndroidManifest.xml, resources) unpack with standard tools.

| Value | Kind | Why |
|---|---|---|
| `EXPO_PUBLIC_APP_VARIANT`, an API base URL | public | describes the build |
| Google Maps or Places API key restricted to the app id and signing certificate | public by design | the restriction protects it, not secrecy; list it in `publicEnvAllow` when its name says KEY or TOKEN |
| Sentry DSN, AdMob app and unit ids, a Firebase web config | public by design | meant to ship in clients |
| A Mapbox public token (`pk.`), a Stripe publishable key (`pk_live_`, `pk_test_`), a Supabase anon key, a RevenueCat public SDK key | public by design | each provider ships it in clients and enforces access on its servers; their secret counterparts (`sk.`, `sk_live_`, the service-role key) never ship |
| Paid or LLM API keys: OpenAI (`sk-`, `sk-proj-`), Anthropic (`sk-ant-`), Gemini, Mistral, Groq, Replicate, Hugging Face, ElevenLabs, Deepgram, Twilio, SendGrid, ... | secret | every request bills your account and none can be restricted to the app; anyone who unpacks the bundle can spend your quota. The app calls an API route that holds the key |
| `SENTRY_AUTH_TOKEN`, `NPM_TOKEN`, `EXPO_TOKEN` | secret | grants write access to an account |
| App Store Connect API key (`.p8`), Play service-account JSON, upload keystore and passwords | secret | publishes or signs as you |
| A payment provider's secret key (Stripe `sk_live_`, and `sk_test_`/`rk_test_` too: full access to test-mode data), a backend admin key, a Supabase service-role key | secret | full access to user data; belongs on a server, never in a build |

The rule of thumb: if a value lets someone act as you or as your backend, it is a secret, and the app
must not need it. An app that needs a secret to call an API needs a server in between.

## Where each secret lives

| Secret | Home | Read by |
|---|---|---|
| Build-time secrets (Sentry upload token, private npm token) | EAS variables with `secret` visibility in the environments that need them; GitHub Actions secrets for jobs that run on GitHub | the build step or tool, from its own environment |
| Secret files (`google-services.json` with restricted keys, a service-account JSON) | EAS file variables (`eas env:set --type file --visibility secret`); the config reads the path: `process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'` | the config writes the path; the file never enters git |
| Store credentials | EAS-managed credentials (`eas credentials`), or files outside the repo for the local lane | EAS Submit, `ios-release-testflight`, `android-release-play` |
| Runtime secrets the app needs (an LLM key, a payment secret) | EAS variables with `sensitive` visibility, deployed with the API routes (`eas deploy --environment production`); EAS Hosting cannot deploy `secret` ones | the API route, from `process.env` at request time |
| Local copies for development | `.env.local` (git-ignored), written by `eas env:pull` | Expo CLI on the developer's machine |

Secret-visibility variables never leave EAS servers: `eas env:pull` and `eas update` cannot read them
(Expo docs), which is the point. A tool that needs a secret during `eas update` (a source-map upload
after the update) uses a `sensitive` variable through `eas env:exec`.

## Runtime secrets: API routes

A key the app needs while it runs (to call an LLM, to create a payment) cannot live in the app.
In an Expo app the default home is an Expo Router API route, a server file inside the routes folder:

```ts
// src/app/api/summarize+api.ts (runs on the server, never in the bundle)
export async function POST(request: Request): Promise<Response> {
  const { text } = (await request.json()) as { text: string };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.SUMMARY_MODEL, input: `Summarize: ${text}` }),
  });
  return Response.json(await response.json());
}
```

- The name has no `EXPO_PUBLIC_` prefix, and the value is a sensitive EAS variable in the environment
  you deploy (`eas env:set --name OPENAI_API_KEY --environment production --visibility sensitive`).
- On SDK 57, API routes need server output: `web.output: "server"` in `app.config.ts` (the template
  ships `"static"`; switch it when the first route arrives). Read in `@expo/cli` 57.0.27: the dev
  server serves routes only when `web.output` is `"server"` (`MetroBundlerDevServer.js`,
  `hasApiRoutes`), and `expo export` skips them otherwise with "Skipping export for API routes because
  `web.output` is not "server"" (`export/exportStaticAsync.js`); the SDK 57 `expo-router` plugin has
  no `apiRoutes` option. Expo's API-routes guide (read 2026-10-03) adds that from SDK 58,
  `web.output: "static"` with `["expo-router", { "apiRoutes": true }]` also exports routes beside
  prerendered HTML; recheck this when the app moves to SDK 58. Re-verify with
  `grep -n "Skipping export for API routes" node_modules/expo/node_modules/@expo/cli/build/src/export/exportStaticAsync.js`.
- Deploy with `npx expo export --platform web` (with the variant pair exported) and
  `eas deploy --environment production`. Locally, `npx expo start` serves the route with `.env.local`.
- The route is the place for the server's own protections: authenticate the user, rate-limit, cap
  input size. A route that forwards anything to the model is a public proxy to your bill.
- `check-env` exempts `+api` files, `+middleware` and the folders listed in `rn-skills.config.json`
  `serverDirs` (helpers only routes import, such as `src/server/llm-client.ts`) from `env-reader`:
  server code reads its real environment. It still reports an `EXPO_PUBLIC_` secret name there, and
  app code that imports from a `serverDirs` folder (`server-import`).
- Another backend you already run (your own API, a serverless function) works the same way; the rule is
  only that the key never reaches the app. Expo's official `eas-hosting` skill covers routes and
  hosting in depth.

## What ships inside the app

`expo-constants` embeds the **public app config** in every build (iOS `EXConstants.bundle/app.config`,
Android assets) and every update manifest. `@expo/config` builds it by removing only these keys
(read in the SDK 57 source of `getConfig({ isPublicConfig: true })`):

- `_internal`, `hooks`
- `ios.config`, `android.config` (whose values, such as a Maps key, still reach the native files)
- `updates.codeSigningCertificate`, `updates.codeSigningMetadata`

Everything else is embedded: `extra`, `plugins` with their options, names, ids, URLs. So a token passed
as a plugin option (`['@sentry/react-native/expo', { authToken: process.env.SENTRY_AUTH_TOKEN }]`) or
into `extra` ships to every user. Sentry's upload tooling reads `SENTRY_AUTH_TOKEN` from its own
environment, which keeps the token out of the config entirely.

## The canary check (secret-config)

`check-variants` proves the config never passes a secret through, without knowing any secret:

1. It collects the variable names the config can read: `process.env.X` and `env['X']` in
   `app.config.ts` and every local file it imports, the keys of every eas.json `env` block, and the
   names in the app folder's `.env*` files.
2. It keeps the secret-looking ones that are not `EXPO_PUBLIC_*` (see "What the checkers look for").
3. It evaluates the production config with each of them set to a unique canary such as
   `rnskills-canary-sentry_auth_token`.
4. It searches the public config (the keys above removed) for every canary and reports the path where
   one arrived: `plugins[1][1].authToken`.

It also reports an `extra` key named like a secret with a string value, and any string in the public
config that matches a secret value pattern (a PEM private key, a live payment secret, a token format).

**Limit:** the canary follows environment variables only. A config that reads a secret from a file
(`fs.readFileSync` into `extra` or a plugin option) is caught only when the value matches a secret
value pattern; keep secret files out of the config the same way.

## Committed files: eas.json and env files

- **eas.json `env`** is committed plain text, and Expo says it "should only be used for values that you
  would commit to your git repository". `secret-eas-env` reports a secret-looking name or value in any
  `build.<profile>.env`, `ios.env` or `android.env`. Move it with
  `eas env:set --name <NAME> --visibility secret --environment <environment>`.
- **Env files** that git would commit (not matched by `.gitignore`) hold names and comments only.
  `secret-env-file` reports a value for a secret-looking name, or a value that looks like a secret,
  in such a file. Git-ignored files (`.env.local`) may hold local secrets; their `EXPO_PUBLIC_*`
  entries are still checked by `public-env-secret`, because those values go into every local bundle.

## .gitignore

`secret-ignored` tests sample paths against the root `.gitignore` (and the app folder's, when
multi-package) with git's rules simplified: last match wins, `!` negates, a trailing `/` matches
folders, a `/` elsewhere anchors to the file's folder.

| Must be ignored | Pattern to add | Why |
|---|---|---|
| `.env.local`, `.env.production.local` | `.env*.local` | local values and pulled secrets |
| `release.keystore`, `upload.jks` | `*.keystore`, `*.jks` | Android signing keys |
| `AuthKey_ABCDE12345.p8` | `*.p8` | App Store Connect API keys |
| `distribution.p12`, `profile.mobileprovision` | `*.p12`, `*.mobileprovision` | iOS signing material |
| `credentials.json` | `credentials.json` | only when a build profile uses `credentialsSource: "local"`: it holds keystore and certificate passwords |
| every `submit.*.android.serviceAccountKeyPath` and `submit.*.ios.ascApiKeyPath` inside the repo | that path | eas.json points at a key file |

The canonical `.gitignore` of this library ignores `.env*` and every signing pattern above. Add
`!.env.example` so the one committed env file can be committed, and `credentials.json` when local
credentials are used.

## What the checkers look for

A **secret-looking name** has one of these words (split on `_` and camelCase): SECRET, PRIVATE,
PASSWORD, PASSWD, PASSPHRASE, TOKEN, CREDENTIAL(S), SIGNING, KEYSTORE, WEBHOOK; or one of the pairs
SERVICE ROLE, SERVICE ACCOUNT, ADMIN KEY, MASTER KEY, ROOT KEY, ENCRYPTION KEY, HMAC KEY; or KEY (or APIKEY) together with a
server-only provider: OPENAI, ANTHROPIC, CLAUDE, GEMINI, GENAI, GOOGLEAI, VERTEX, MISTRAL, COHERE,
GROQ, XAI, DEEPSEEK, PERPLEXITY, OPENROUTER, TOGETHER, FIREWORKS, REPLICATE, HUGGINGFACE, STABILITY,
ELEVENLABS, DEEPGRAM, ASSEMBLYAI, PINECONE, TWILIO, SENDGRID, MAILGUN, RESEND, POSTMARK.

- Neighbouring words also count joined, so the split spellings match: `EXPO_PUBLIC_OPEN_AI_API_KEY`,
  `openAiApiKey`, `HUGGING_FACE`, `ELEVEN_LABS`, `ASSEMBLY_AI`, `DEEP_SEEK`, `OPEN_ROUTER`,
  `GOOGLE_AI`; `AZURE_OPENAI_KEY` and `EXPO_PUBLIC_GOOGLE_GENAI_KEY` match by their provider word.
- TOKEN and PRIVATE describe settings too: a name whose last word is URL, ENDPOINT, URI, INTERVAL,
  TTL, MS or ENABLED is the setting, not the secret (`EXPO_PUBLIC_AUTH_TOKEN_ENDPOINT`,
  `EXPO_PUBLIC_REFRESH_TOKEN_TTL`, `EXPO_PUBLIC_PRIVATE_BETA_ENABLED`). SECRET and PASSWORD never
  are.
- So `EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_CLAUDE_API_KEY` and `anthropicApiKey` are
  secret-looking, `EXPO_PUBLIC_OPENAI_MODEL` is not. `KEY` alone is not secret-looking: many public
  client keys carry it (Maps, Stripe publishable, Supabase anon, RevenueCat).
- Where names are read: app code and API routes, `src/**/*.d.ts`, the app config and every local file
  it imports (a name read only there, with its value only in an EAS environment, is still public:
  EAS shows plain-text variables to every project member and any app code reading it inlines it),
  every `.env*` file, and eas.json.

A **secret-looking value** matches one of: a PEM private key header, a Google service-account JSON,
an OpenAI key (`sk-`, `sk-proj-`, `sk-svcacct-`, `sk-admin-`), an Anthropic key (`sk-ant-`), a Stripe
secret or restricted key (live or test), a Hugging Face, Replicate or Groq token, an AWS access key id,
a GitHub, Slack, npm or Sentry token format, or a connection string with a password
(`postgres://user:password@host/db`, `mongodb+srv://...`, `redis://:password@host`; a loopback host
such as `localhost` or `127.0.0.1`, a docker-compose default in `.env.example`, and a `${VAR}` or
`<placeholder>` password do not count). A Google API key (`AIza...`) is not on the list: Maps
and Firebase keys of that form are public by design, so a paid Gemini key is caught by its name.

False positives are handled in the open: `rn-skills.config.json` key `publicEnvAllow` lists public
names that look secret, and the review records why each one is public.

## After a leak (human steps)

A secret that reached git history, a build, an update or a log is compromised; deleting the file does
not help. Stop and ask the developer before acting, then:

1. Revoke or rotate it at the provider (Sentry, npm, App Store Connect, Google Cloud, the payment
   provider). Only the developer can, in their accounts.
2. Store the new value in its proper home (an EAS secret variable, a CI secret).
3. Remove the old value from the files and rebuild; a value that shipped in a build stays in that build,
   so treat it as public even after rotation.
4. Check history for other copies: `git log -p -S '<a distinctive part of the value>'`.
