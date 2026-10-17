// scripts/release-android/play-client.test.ts
import {
  commitUrl,
  createPlayClient,
  PLAY_API,
  PLAY_SCOPE,
  PLAY_TOKEN_URL,
  PLAY_UPLOAD_API,
  playStopOf,
  serviceJwt,
  setTrackRelease,
  uploadBundle,
} from './play-client.ts';

import type { HttpRequest, HttpResponse, PlayClient } from './play-client.ts';
import type { ServiceAccount } from './play-credentials.ts';

const PACKAGE = 'com.acme.tasks';
const EDITS = `${PLAY_API}/${PACKAGE}/edits`;
const ACCOUNT: ServiceAccount = {
  clientEmail: 'release@tasks-test.iam.gserviceaccount.com',
  signRs256: (data) => `signed(${String(data.length)})`,
};

/** A fake Play API: answers by step, records every request. */
function fakePlay(answers: Readonly<Record<string, HttpResponse>> = {}): {
  readonly client: PlayClient;
  readonly requests: HttpRequest[];
} {
  const requests: HttpRequest[] = [];
  const defaults: Readonly<Record<string, HttpResponse>> = {
    token: { status: 200, text: '{"access_token":"ya29.test","expires_in":3599}' },
    insert: { status: 200, text: '{"id":"edit-1"}' },
    bundles: { status: 200, text: '{"versionCode":15}' },
    tracks: { status: 200, text: '{}' },
    commit: { status: 200, text: '{"id":"edit-1"}' },
  };
  const stepOf = (request: HttpRequest): string => {
    if (request.url === PLAY_TOKEN_URL) return 'token';
    if (request.url.includes(':commit')) return 'commit';
    if (request.url.includes('/bundles')) return 'bundles';
    if (request.url.includes('/tracks/')) return 'tracks';
    return 'insert';
  };
  const http = (request: HttpRequest): Promise<HttpResponse> => {
    requests.push(request);
    const step = stepOf(request);
    return Promise.resolve(answers[step] ?? defaults[step] ?? { status: 500, text: '' });
  };
  return {
    client: createPlayClient({
      http,
      account: ACCOUNT,
      packageName: PACKAGE,
      nowSeconds: () => 1000,
    }),
    requests,
  };
}

function decodePart(jwt: string, index: number): unknown {
  return JSON.parse(Buffer.from(jwt.split('.')[index] ?? '', 'base64url').toString('utf8'));
}

describe('serviceJwt', () => {
  it('asks for the androidpublisher scope for one hour', () => {
    const jwt = serviceJwt(ACCOUNT, 1000);

    expect(decodePart(jwt, 0)).toStrictEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodePart(jwt, 1)).toStrictEqual({
      iss: ACCOUNT.clientEmail,
      scope: PLAY_SCOPE,
      aud: PLAY_TOKEN_URL,
      iat: 1000,
      exp: 4600,
    });
  });
});

describe('uploadBundle', () => {
  it('uploads in one edit and puts the read versionCode on the track', async () => {
    const { client, requests } = fakePlay();
    const versionCode = await uploadBundle(client, {
      bytes: new Uint8Array([1, 2, 3]),
      track: 'internal',
      release: { status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Reminders' }] },
    });

    expect(versionCode).toBe(15);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `POST ${PLAY_TOKEN_URL}`,
      `POST ${EDITS}`,
      `POST ${PLAY_UPLOAD_API}/${PACKAGE}/edits/edit-1/bundles?uploadType=media`,
      `PUT ${EDITS}/edit-1/tracks/internal`,
      `POST ${EDITS}/edit-1:commit`,
    ]);
    expect(JSON.parse(String(requests[3]?.body))).toStrictEqual({
      track: 'internal',
      releases: [
        {
          status: 'completed',
          releaseNotes: [{ language: 'en-US', text: 'Reminders' }],
          versionCodes: ['15'],
        },
      ],
    });
  });

  it('sends the token only as the authorization header', async () => {
    const { client, requests } = fakePlay();
    await uploadBundle(client, {
      bytes: new Uint8Array([1]),
      track: 'internal',
      release: { status: 'draft' },
    });

    expect(requests[1]?.headers['authorization']).toBe('Bearer ya29.test');
    expect(requests.filter((request) => request.url === PLAY_TOKEN_URL)).toHaveLength(1);
  });

  it('stops without committing when Google refuses the bundle', async () => {
    const used = {
      status: 403,
      text: '{"error":{"message":"APK specifies a version code that has already been used."}}',
    };
    const { client, requests } = fakePlay({ bundles: used });

    await expect(
      uploadBundle(client, {
        bytes: new Uint8Array([1]),
        track: 'internal',
        release: { status: 'completed' },
      }),
    ).rejects.toMatchObject({ name: 'PlayStop', reason: 'version-code-used' });
    expect(requests.some((request) => request.url.endsWith(':commit'))).toBe(false);
  });
});

describe('commitUrl', () => {
  it('lets Play send the changes for review unless the developer chose otherwise', () => {
    expect(commitUrl(EDITS, 'edit-1')).toBe(`${EDITS}/edit-1:commit`);
    expect(commitUrl(EDITS, 'edit-1', { isReviewSentByHand: true })).toBe(
      `${EDITS}/edit-1:commit?changesNotSentForReview=true`,
    );
  });

  it('commits an upload with changesNotSentForReview only when asked', async () => {
    const { client, requests } = fakePlay();
    await uploadBundle(client, {
      bytes: new Uint8Array([1]),
      track: 'internal',
      release: { status: 'completed' },
      isReviewSentByHand: true,
    });

    expect(requests.at(-1)?.url).toBe(`${EDITS}/edit-1:commit?changesNotSentForReview=true`);
  });
});

describe('setTrackRelease', () => {
  it('starts a staged rollout on production in one edit', async () => {
    const { client, requests } = fakePlay();
    await setTrackRelease(client, {
      track: 'production',
      release: { versionCodes: ['15'], status: 'inProgress', userFraction: 0.05 },
    });

    expect(JSON.parse(String(requests[2]?.body))).toStrictEqual({
      track: 'production',
      releases: [{ versionCodes: ['15'], status: 'inProgress', userFraction: 0.05 }],
    });
    expect(requests.at(-1)?.url).toBe(`${EDITS}/edit-1:commit`);
  });
});

describe('playStopOf', () => {
  const stop = (status: number, message: string): string =>
    playStopOf('edits.insert', { status, text: JSON.stringify({ error: { message } }) }).reason;

  it('names the reason a person has to act on', () => {
    expect(stop(403, 'Google Play Android Developer API has not been used in project 1')).toBe(
      'api-not-enabled',
    );
    expect(stop(403, 'The caller does not have permission')).toBe('auth');
    expect(stop(404, 'Package not found: com.acme.tasks.')).toBe('app-not-found');
    expect(stop(400, 'Only releases with status draft may be created on draft app.')).toBe(
      'draft-app',
    );
    expect(stop(403, 'You must complete the advertising ID declaration')).toBe(
      'policy-declarations',
    );
    expect(
      stop(
        400,
        'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.',
      ),
    ).toBe('changes-not-sent-for-review');
    expect(stop(500, 'Backend error')).toBe('http-error');
  });

  it('sends an IAM answer that mentions a policy to permissions, not App content', () => {
    expect(stop(403, "Permission 'androidpublisher.edits.create' denied by IAM policy")).toBe(
      'auth',
    );
    expect(stop(401, 'Request had invalid authentication credentials (see the policy)')).toBe(
      'auth',
    );
  });

  it('quotes at most Google one-line message', () => {
    const error = playStopOf('token', { status: 401, text: 'Bearer ya29.secret <html>' });

    expect(error.message).toBe(
      "token stopped: auth (HTTP 401): an answer that is not JSON (the service account's permission or key)",
    );
  });
});
