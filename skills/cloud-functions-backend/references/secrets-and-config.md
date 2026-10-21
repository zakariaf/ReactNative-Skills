# Secrets and configuration

Where a function's keys and settings live, how they reach exactly the functions that need them, and what the emulator uses instead. The template `functions/src/config/secrets.ts` declares the secrets; each function binds its own.

## Contents

- Secrets: declare, bind, read
- Why never process.env
- Non-secret configuration
- The emulator
- Human steps
- Leak response

## Secrets: declare, bind, read

```ts
// functions/src/config/secrets.ts
import { defineSecret } from 'firebase-functions/params';
export const SUMMARY_API_KEY = defineSecret('SUMMARY_API_KEY');

// functions/src/tasks/summarize-list.ts
defineCallable({ name: 'summarizeList', secrets: [SUMMARY_API_KEY], consumeAppCheckToken: true, /* ... */
  handler: async (payload, context) => {
    const outcome = await deps.provider.summarize(payload.taskTitles, SUMMARY_API_KEY.value());
  },
});
```

- **Declared once** in `config/secrets.ts`, so the list of secrets a project needs is one file.
- **Bound per function.** Only functions that list a secret in `secrets` get its value at runtime ("Secret parameters must be bound to individual functions that should have access to them", Firebase's "Configure your environment" page, read on 2026-10-21). A health check binds none; a webhook handler binds only its webhook secret. A compromised or buggy function then cannot read keys it never needed.
- **Read inside the handler**, with `.value()`. At deploy time `.value()` throws ("Cannot access the value of secret ... during function deployment", firebase-functions 7.4.0 `lib/esm/params/types.mjs`), so a module-scope read breaks the deploy.
- An unbound secret's `.value()` returns an empty string and logs a warning (same source, verified 2026-10-21). The provider then answers 401 and the bug looks like a bad key. The checker's `env-secret` rule fails a `.value()` in a file whose function does not bind it.
- Pass the value into the provider adapter as an argument (the template's `summarize(titles, apiKey)`), so the adapter never reads the environment and its tests need no key.

## Why never process.env

Bound secrets do arrive as environment variables, so `process.env.SUMMARY_API_KEY` works in production. It is banned anyway (`env-secret`) because:

- the binding is no longer visible in code: delete `secrets: [...]` and the read silently becomes `undefined`;
- a read at module scope runs during deploy analysis and in every test;
- an env name typed twice drifts from the declared one, and tooling that lists a function's secrets (the deploy, the checker, a reviewer) cannot see it.

The runtime's own variables (`FUNCTIONS_EMULATOR`, `GCLOUD_PROJECT`, `K_SERVICE`) are not secrets and the checker leaves them alone.

## Non-secret configuration

- Values that differ per project but are not secret (a provider base URL, a feature limit) use `defineString`, `defineInt` or `defineBoolean` from `firebase-functions/params`. The CLI asks for missing values on deploy and saves them to `functions/.env.<project_ID>`, which may be committed (Firebase's docs suggest it may be useful in version control); `functions/.env` holds defaults for every project.
- Never put a secret in a `.env` file: they are plain text and usually committed. The checker's `literal-key` rule reads every committed `.env*` file of the functions folder (`*.local` files are skipped because they are git-ignored by convention; keep them so).
- Reserved names: do not use keys starting with `X_GOOGLE_`, `EXT_` or `FIREBASE_`, or names such as `GCP_PROJECT` and `PORT`, for params or secrets (same Firebase page).
- `functions.config()` is gone: firebase-functions 7 removed it (the v7.0.0 release notes, and `lib/v1/config.d.ts` in 7.4.0 types it as `never`), and Firebase's page says new deployments that use it fail after March 2027. Migrate every value to params.

## The emulator

- `functions/.secret.local` overrides secret values in the emulator ("you can override secrets values by setting up a `.secret.local` file", same page). It holds dummy values, is git-ignored, and lets integration tests run with no access to Secret Manager.
- `functions/.env.local` overrides params in the emulator and wins over `.env` and `.env.<project_ID>`.
- Add both to `.gitignore` together with the build output: `functions/lib/`, `functions/.secret.local`, `functions/.env.local`, `functions/*.local`.

## Human steps

- The developer sets each real secret in each project: `firebase functions:secrets:set SUMMARY_API_KEY --project <alias>`, then redeploys the functions that bind it (a new value needs a deploy to take effect). Agents never read, print, copy or set real secret values; they ask the developer when a secret's first consumer lands.
- Rotating a key is outward-facing: stop and ask.

## Leak response

A key that reached git, a log line or a client bundle is leaked for good, even after the commit is removed. Rotate it with the provider first, set the new value with `firebase functions:secrets:set`, redeploy, then remove the old value from history if the developer wants. The checker cannot see a key in Cloud Logging, so the log rules of the callable contract (no payloads, no provider output) are the prevention.
