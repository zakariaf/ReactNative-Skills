// scripts/metro/web-sqlite-metro.ts
// The Metro settings expo-sqlite needs in the web build (web-support), applied in metro.config.js:
//   const { withWebSqlite } = require('./scripts/metro/web-sqlite-metro.ts');
//   module.exports = withWebSqlite(config);
// 1. `wasm` as an asset extension: expo-sqlite's worker imports wa-sqlite.wasm, and without it the web
//    bundle fails ("Unable to resolve module ./wa-sqlite/wa-sqlite.wasm", verified on Expo SDK 57).
// 2. Cross-origin isolation on the dev server: the worker answers synchronous calls through
//    SharedArrayBuffer, which a page only has when it is served with these two headers
//    ("ReferenceError: SharedArrayBuffer is not defined" without them, verified in Chrome). The
//    deployed site needs the same headers from its host (contracts/web.json "host").
//    require-corp, not credentialless: Safari and every iOS browser isolate only with require-corp
//    (MDN browser-compat-data 8.1.5, verified 2026-10-14). Its cost: a cross-origin resource loads
//    only with a Cross-Origin-Resource-Policy header or through CORS (crossorigin).
// Node runs this file with type stripping: only erasable syntax, no imports from the app.

/** The response headers that make a page cross-origin isolated (SharedArrayBuffer available). */
export const CROSS_ORIGIN_ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

type HeaderResponse = { readonly setHeader: (name: string, value: string) => unknown };

/** A connect-style middleware, as Metro's server hands it to enhanceMiddleware. */
export type Middleware = (
  request: unknown,
  response: HeaderResponse,
  next: (error?: unknown) => void,
) => unknown;

type EnhanceMiddleware = (middleware: Middleware, server: unknown) => Middleware;

/** The part of Metro's config this helper reads and replaces. */
export type WebSqliteMetroConfig = {
  readonly resolver: { readonly assetExts: readonly string[] };
  readonly server: { readonly enhanceMiddleware?: EnhanceMiddleware };
};

/** The isolation headers on every response, then whatever enhancer the config already had. */
function isolationEnhancer(previous: EnhanceMiddleware | undefined): EnhanceMiddleware {
  return (middleware, server) => {
    const inner = previous === undefined ? middleware : previous(middleware, server);
    return (request, response, next) => {
      for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) {
        response.setHeader(name, value);
      }
      return inner(request, response, next);
    };
  };
}

/** A copy of the config with `wasm` among the asset extensions and the isolation headers on. */
export function withWebSqlite<TConfig extends WebSqliteMetroConfig>(config: TConfig): TConfig {
  const { assetExts } = config.resolver;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      assetExts: assetExts.includes('wasm') ? assetExts : [...assetExts, 'wasm'],
    },
    server: {
      ...config.server,
      enhanceMiddleware: isolationEnhancer(config.server.enhanceMiddleware),
    },
  };
}
