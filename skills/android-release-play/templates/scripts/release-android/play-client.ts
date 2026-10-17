// scripts/release-android/play-client.ts
// The Google Play Developer API v3 (androidpublisher), called with Node's fetch: a JWT signed by the
// service account (play-credentials.ts) is exchanged for an access token, then one edit uploads the
// bundle and puts exactly its versionCode on a track, or changes a track's release (staged rollout,
// halt, complete), and commits. Every non-2xx answer is a PlayStop: stop and ask a person, never
// retry (401/403, the API not enabled, an app the Console does not have, a draft app, a used version
// code, missing declarations, changes Play will not send for review automatically). A commit sends
// changesNotSentForReview=true only when the developer chose it for this run. Errors name the step and Google's one-line message, never the token
// or a header. Release tooling only: the app itself reaches the network through src/api.
import type { ServiceAccount } from './play-credentials.ts';

export const PLAY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
export const PLAY_UPLOAD_API =
  'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';

const TOKEN_LIFETIME_SECONDS = 3600;

export type HttpRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array<ArrayBuffer> | null;
};
export type HttpResponse = { readonly status: number; readonly text: string };
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export type PlayStopReason =
  | 'api-not-enabled'
  | 'auth'
  | 'app-not-found'
  | 'draft-app'
  | 'version-code-used'
  | 'policy-declarations'
  | 'changes-not-sent-for-review'
  | 'http-error';

/** A release on a track, as the API takes it (userFraction only with inProgress or halted). */
export type TrackRelease = {
  readonly versionCodes: readonly string[];
  readonly status: 'draft' | 'inProgress' | 'halted' | 'completed';
  readonly userFraction?: number;
  readonly releaseNotes?: readonly { readonly language: string; readonly text: string }[];
};

/** A Play API answer that needs a person: stop, ask, never retry. */
export class PlayStop extends Error {
  readonly reason: PlayStopReason;

  constructor(
    reason: PlayStopReason,
    at: { readonly step: string; readonly status: number },
    detail: string,
  ) {
    super(`${at.step} stopped: ${reason} (HTTP ${String(at.status)}): ${detail}`);
    this.name = 'PlayStop';
    this.reason = reason;
  }
}

/** Google's error message, one line at most; the request (and its token) is never quoted. */
function detailOf(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string; status?: string } };
    return (body.error?.message ?? body.error?.status ?? 'no message').slice(0, 300);
  } catch {
    return 'an answer that is not JSON';
  }
}

/** Matched on the whole answer: these name a cause no permission change fixes. */
const STOP_PATTERNS: readonly (readonly [RegExp, PlayStopReason])[] = [
  [
    /Changes cannot be sent for review automatically|changesNotSentForReview/iu,
    'changes-not-sent-for-review',
  ],
  [/SERVICE_DISABLED|has not been used in project|is disabled/iu, 'api-not-enabled'],
  [/Only releases with status draft may be created on draft app/iu, 'draft-app'],
  [/version code .*already been used/iu, 'version-code-used'],
];
/**
 * Missing App content declarations, matched on Google's message only and before the 401/403 check
 * (Play answers some with 403). Narrow on purpose: a bare "policy" would also match an IAM answer
 * ("Permission denied by IAM policy"), which is an auth stop.
 */
const DECLARATIONS =
  /\bdeclarations?\b|\bApp content\b|\bpolicy (?:declaration|violation|requirement)/iu;

export function playStopOf(step: string, response: HttpResponse): PlayStop {
  const at = { step, status: response.status };
  const detail = detailOf(response.text);
  const matched = STOP_PATTERNS.find(([pattern]) => pattern.test(response.text));
  if (matched !== undefined) {
    return new PlayStop(matched[1], at, detail);
  }
  if (DECLARATIONS.test(detail)) {
    return new PlayStop('policy-declarations', at, detail);
  }
  if (response.status === 401 || response.status === 403) {
    return new PlayStop('auth', at, `${detail} (the service account's permission or key)`);
  }
  if (response.status === 404) {
    return new PlayStop('app-not-found', at, detail);
  }
  return new PlayStop('http-error', at, detail);
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** The service account's JWT bearer assertion for the androidpublisher scope. */
export function serviceJwt(account: ServiceAccount, nowSeconds: number): string {
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: account.clientEmail,
    scope: PLAY_SCOPE,
    aud: PLAY_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
  })}`;
  return `${unsigned}.${account.signRs256(unsigned)}`;
}

type CallRequest = Omit<HttpRequest, 'headers'> & { readonly type?: string };

export type PlayClient = {
  readonly packageName: string;
  readonly call: (step: string, request: CallRequest) => Promise<unknown>;
};

/** The OAuth request that trades the service account's JWT for an access token. */
function tokenRequest(account: ServiceAccount, nowSeconds: number): HttpRequest {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: serviceJwt(account, nowSeconds),
  });
  return {
    method: 'POST',
    url: PLAY_TOKEN_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  };
}

export function createPlayClient(input: {
  readonly http: Http;
  readonly account: ServiceAccount;
  readonly packageName: string;
  readonly nowSeconds: () => number;
}): PlayClient {
  let token: string | null = null;
  const send = async (step: string, request: HttpRequest): Promise<unknown> => {
    const response = await input.http(request);
    if (response.status < 200 || response.status > 299) {
      throw playStopOf(step, response);
    }
    return response.text === '' ? {} : (JSON.parse(response.text) as unknown);
  };
  const accessToken = async (): Promise<string> => {
    if (token !== null) {
      return token;
    }
    const answer = (await send('token', tokenRequest(input.account, input.nowSeconds()))) as {
      access_token?: string;
    };
    token = answer.access_token ?? '';
    return token;
  };
  return {
    packageName: input.packageName,
    call: async (step, request) => {
      const authorization = `Bearer ${await accessToken()}`;
      const type = request.type ?? 'application/json';
      const { method, url, body } = request;
      return send(step, { method, url, body, headers: { authorization, 'content-type': type } });
    },
  };
}

/** How an edit is committed: by default Play sends the changes for review itself. */
export type CommitOptions = {
  /**
   * changesNotSentForReview=true: Play keeps the committed changes until someone sends them for
   * review in Play Console. Only when the developer chose it after a changes-not-sent-for-review stop.
   */
  readonly isReviewSentByHand?: boolean;
};

/** The edits.commit URL, with changesNotSentForReview=true only when the developer chose it. */
export function commitUrl(edits: string, edit: string, options: CommitOptions = {}): string {
  const query = options.isReviewSentByHand === true ? '?changesNotSentForReview=true' : '';
  return `${edits}/${edit}:commit${query}`;
}

async function inEdit<T>(
  client: PlayClient,
  work: (edits: string, edit: string) => Promise<T>,
  options: CommitOptions,
): Promise<T> {
  const edits = `${PLAY_API}/${client.packageName}/edits`;
  const edit = (await client.call('edits.insert', { method: 'POST', url: edits, body: null })) as {
    id: string;
  };
  const result = await work(edits, edit.id);
  await client.call('edits.commit', {
    method: 'POST',
    url: commitUrl(edits, edit.id, options),
    body: null,
  });
  return result;
}

async function putTrack(
  client: PlayClient,
  at: { readonly url: string; readonly track: string },
  release: TrackRelease,
): Promise<void> {
  await client.call('edits.tracks.update', {
    method: 'PUT',
    url: `${at.url}/tracks/${at.track}`,
    body: JSON.stringify({ track: at.track, releases: [release] }),
  });
}

/**
 * edits.insert -> edits.bundles.upload -> edits.tracks.update -> edits.commit. `release` gets the
 * versionCode Google read from the bundle. Resolves that versionCode.
 */
export async function uploadBundle(
  client: PlayClient,
  input: {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly track: string;
    readonly release: Omit<TrackRelease, 'versionCodes'>;
  } & CommitOptions,
): Promise<number> {
  return inEdit(
    client,
    async (edits, edit) => {
      const bundle = (await client.call('edits.bundles.upload', {
        method: 'POST',
        url: `${PLAY_UPLOAD_API}/${client.packageName}/edits/${edit}/bundles?uploadType=media`,
        body: input.bytes,
        type: 'application/octet-stream',
      })) as { versionCode: number };
      const release = { ...input.release, versionCodes: [String(bundle.versionCode)] };
      await putTrack(client, { url: `${edits}/${edit}`, track: input.track }, release);
      return bundle.versionCode;
    },
    input,
  );
}

/** One edit that sets a track's release (promotion with a staged rollout, a raise, a halt). */
export async function setTrackRelease(
  client: PlayClient,
  input: { readonly track: string; readonly release: TrackRelease } & CommitOptions,
): Promise<void> {
  await inEdit(
    client,
    async (edits, edit) => {
      await putTrack(client, { url: `${edits}/${edit}`, track: input.track }, input.release);
    },
    input,
  );
}
