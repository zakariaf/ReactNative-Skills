// scripts/metro/web-sqlite-metro.test.ts
import { CROSS_ORIGIN_ISOLATION_HEADERS, withWebSqlite } from './web-sqlite-metro.ts';

import type { Middleware, WebSqliteMetroConfig } from './web-sqlite-metro.ts';

type Enhancer = NonNullable<WebSqliteMetroConfig['server']['enhanceMiddleware']>;

function metroConfig(enhanceMiddleware?: Enhancer): WebSqliteMetroConfig {
  return {
    resolver: { assetExts: ['png', 'ttf'] },
    server: enhanceMiddleware === undefined ? {} : { enhanceMiddleware },
  };
}

function serve(config: WebSqliteMetroConfig, base: Middleware): Record<string, string> {
  const headers: Record<string, string> = {};
  const enhance = config.server.enhanceMiddleware;
  if (enhance === undefined) throw new Error('enhanceMiddleware is not set');
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
  enhance(base, {})({}, response, () => undefined);
  return headers;
}

describe('withWebSqlite', () => {
  it('adds wasm to the asset extensions once, without changing the original config', () => {
    const original = metroConfig();

    const config = withWebSqlite(withWebSqlite(original));

    expect(config.resolver.assetExts).toStrictEqual(['png', 'ttf', 'wasm']);
    expect(original.resolver.assetExts).toStrictEqual(['png', 'ttf']);
  });

  it('sends both isolation headers, then hands the request to the server', () => {
    const base = jest.fn<unknown, Parameters<Middleware>>();

    const headers = serve(withWebSqlite(metroConfig()), base);

    expect(headers).toStrictEqual({ ...CROSS_ORIGIN_ISOLATION_HEADERS });
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(CROSS_ORIGIN_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('keeps a middleware enhancer the config already had', () => {
    const marker = jest.fn<unknown, Parameters<Middleware>>();
    const config = withWebSqlite(metroConfig(() => marker));

    serve(config, jest.fn<unknown, Parameters<Middleware>>());

    expect(marker).toHaveBeenCalledTimes(1);
  });
});
