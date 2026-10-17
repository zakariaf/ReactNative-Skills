// src/api/api-client.ts
export type ApiClient = { readonly request: (path: string) => Promise<number> };
