export type ApiClient = { readonly get: (path: string) => Promise<unknown> };

export function createApiClient(baseUrl: string): ApiClient {
  return { get: (path) => fetch(`${baseUrl}${path}`).then((response) => response.json() as Promise<unknown>) };
}
