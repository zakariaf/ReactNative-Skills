// src/api/fetch-api-client.ts
import type { ApiClient } from './api-client';

const deviceFetch = globalThis.fetch;

export function createFetchApiClient(baseUrl: string): ApiClient {
  return {
    request: async (path: string) => {
      const response = await deviceFetch(`${baseUrl}${path}`);
      return response.status;
    },
  };
}
