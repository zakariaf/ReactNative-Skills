// scripts/asc/asc-client.ts
// The App Store Connect REST client (tooling only; the app never calls it). Errors carry Apple's
// error codes and details only: never the token, never a request with its headers.
const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com';

export type AscRequest = {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
};

export type AscError = { readonly code: string; readonly detail: string };

export type AscResponse =
  | { readonly ok: true; readonly status: number; readonly json: unknown }
  | { readonly ok: false; readonly status: number; readonly errors: readonly AscError[] };

/** One field of an App Store Connect JSON answer: undefined unless `value` is an object. */
export function ascField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function readField(value: unknown, key: string): string {
  const field = ascField(value, key);
  return typeof field === 'string' ? field : '';
}

function parseErrors(json: unknown): readonly AscError[] {
  const list = ascField(json, 'errors');
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((item: unknown) => ({
    code: readField(item, 'code'),
    detail: readField(item, 'detail'),
  }));
}

/** The error codes of a failed answer, for a message ('NOT_AUTHORIZED, ...'). */
export function errorCodes(response: AscResponse): string {
  return response.ok ? '' : response.errors.map((error) => error.code).join(', ');
}

export async function ascRequest(token: string, request: AscRequest): Promise<AscResponse> {
  const response = await fetch(`${ASC_BASE_URL}${request.path}`, {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  const json: unknown = text === '' ? null : JSON.parse(text);
  if (response.ok) {
    return { ok: true, status: response.status, json };
  }
  return { ok: false, status: response.status, errors: parseErrors(json) };
}
