# Hosting and headers

Where the deployed site gets its response headers, rewrites for routes the export has no page for, and
what must never be published. The host is recorded in `contracts/web.json` `host`; `web-sqlite-setup`
checks the matching file. Deploying is outward-facing: **stop and ask the developer before any deploy**,
and never deploy a project they did not name.

Every snippet sends `Cross-Origin-Embedder-Policy: require-corp`, not `credentialless`. Expo's
expo-sqlite page shows `credentialless`, but Safari and every iOS browser (all WebKit) do not support it
(MDN browser-compat-data 8.1.6: `credentialless` safari and safari_ios `false`, the header itself since
Safari 15.2; verified 2026-10-16, re-verify with
`npm pack @mdn/browser-compat-data` and `http.headers.Cross-Origin-Embedder-Policy` in `data.json`), so an
iPhone visitor gets a page that is not isolated, no `SharedArrayBuffer`, and the storage gate's
"unsupported" notice. `require-corp` isolates in every browser; its cost is in sqlite-on-web.md
section 8. Both checkers fail `credentialless`.

## Contents

- 1. EAS Hosting
- 2. Netlify and Cloudflare Pages
- 3. Vercel
- 4. A server of your own
- 5. Rewrites
- 6. Caching
- 7. What never ships

## 1. EAS Hosting (`host: "eas-hosting"`)

Expo's host for Expo Router exports (`eas deploy`; Expo's `eas-hosting` skill is the API reference).
Response headers come from the expo-router plugin options, which `npx expo export` writes into
`dist/_expo/.routes.json` for `static` and `server` output (measured on SDK 57; `single` writes no
manifest):

```ts
// app.config.ts (plugins)
['expo-router', { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin' } }],
```

The values may come from the shared constant in `scripts/metro/web-sqlite-metro.ts`
(`headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS }`; app.config.ts runs in Node and may import scripts).
EAS Hosting adds `Strict-Transport-Security` and an `ETag` on assets itself (Expo's "Default responses
and headers").

## 2. Netlify and Cloudflare Pages (`host: "static-host"`)

Both read `public/_headers` (Expo copies `public/` into the export). The default `headersFile` of a
`static-host` contract:

```
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
```

A `single` export needs every path rewritten to `index.html` (`public/_redirects`: `/*  /index.html  200`).
A `static` export needs rewrites only for `clientRoutes` (section 5).

## 3. Vercel (`host: "static-host"`, `headersFile: "vercel.json"`)

```json
{
  "buildCommand": "expo export -p web",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

## 4. A server of your own (`host: "custom-server"`)

Name the file that sets the headers in `headersFile` (an nginx site, a Caddyfile, the server code);
`web-sqlite-setup` looks for both header names in it. nginx:
`add_header Cross-Origin-Embedder-Policy require-corp always;` and the same for
`Cross-Origin-Opener-Policy same-origin`.

## 5. Rewrites

- `single`: every path to `/index.html` (the app routes on the client).
- `static` on a static host: a dynamic route without `generateStaticParams` has no page; list its route id
  (`tasks/[id]`) in `clientRoutes` and rewrite its URL pattern to a page that renders it client-side, or
  export its params (web-target-and-output.md section 6).
- Reserved paths: Metro serves `/assets` and `/_expo`; never put files at `public/assets/`.

## 6. Caching

Files under `_expo/static/` carry a content hash in their name: cache them for a year (`immutable`).
HTML must revalidate (`no-cache`), or visitors keep an old page that points at deleted bundles.

## 7. What never ships

- **Source maps** (`.map`): they publish the app's source. Export the site without `--source-maps`; upload
  maps to the crash reporter instead (crash-reporting-and-observability). `export-source-maps` fails a map
  in the export unless the contract says `publishSourceMaps: true` on purpose.
- **Secrets:** every `EXPO_PUBLIC_*` value is inlined into the web bundle and readable by anyone
  (app-variants-and-environment owns the variables and the secret rules).
- **A test build:** export with the production variant pair
  (`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production`); debug-menu-and-test-hooks proves the
  test-only code is stripped.
