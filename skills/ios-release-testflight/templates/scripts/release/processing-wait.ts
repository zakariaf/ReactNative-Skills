// scripts/release/processing-wait.ts
// Waiting for processing as a plan on injected seams: two minutes (Apple never lists a fresh upload
// sooner), then the build's processing state once a minute for up to an hour. Each poll asks for one
// build and only its state, and every poll reuses one App Store Connect token until about a minute
// before it expires, so the key is read once and a token signed a few times, not 60. The token never
// reaches the log.
import { buildsPath, processingStateOf } from './processing.ts';
import { ascField } from '../asc/asc-client.ts';

export const PROCESSING_WAIT = { firstPollSeconds: 120, pollSeconds: 60, attempts: 60 } as const;
/** A token is minted again this long before its expiry, so no request carries a dying one. */
const REMINT_MARGIN_SECONDS = 60;

export type ProcessingPoll = {
  /** processingPollPath of the uploaded build. */
  readonly path: string;
  /** One GET of `path` with this token: the answer's JSON (it throws with the resume hint). */
  readonly read: (path: string, token: string) => Promise<unknown>;
  readonly token: () => string;
  readonly sleepSeconds: (seconds: number) => void;
  readonly log: (line: string) => void;
};

/** buildsPath, answered with the processing state of one build only. */
export function processingPollPath(
  appleAppId: string,
  buildNumber: number,
  version: string,
): string {
  return `${buildsPath(appleAppId, buildNumber, version)}&fields[builds]=processingState&limit=1`;
}

/** The REST id of the first build in a builds answer ('' without one). */
export function buildIdOf(json: unknown): string {
  const data = ascField(json, 'data');
  const id = Array.isArray(data) ? ascField(data[0], 'id') : undefined;
  return typeof id === 'string' ? id : '';
}

/**
 * One token reused across calls: `mint` runs on the first call and again once fewer than
 * REMINT_MARGIN_SECONDS of its `lifetimeSeconds` are left.
 */
export function reusedToken(
  mint: (nowEpochSeconds: number) => string,
  now: () => number,
  lifetimeSeconds: number,
): () => string {
  let token = '';
  let remintAt = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at >= remintAt) {
      token = mint(at);
      remintAt = at + lifetimeSeconds - REMINT_MARGIN_SECONDS;
    }
    return token;
  };
}

/** Polls until VALID and returns the build's REST id; INVALID, FAILED or an hour without VALID throw. */
export async function pollUntilValid(poll: ProcessingPoll): Promise<string> {
  const { attempts, firstPollSeconds, pollSeconds } = PROCESSING_WAIT;
  poll.sleepSeconds(firstPollSeconds);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const json = await poll.read(poll.path, poll.token());
    const state = processingStateOf(json);
    poll.log(
      `release:ios: processing ${state ?? 'not listed yet'} (${String(attempt)}/${String(attempts)})`,
    );
    if (state === 'VALID') return buildIdOf(json);
    if (state === 'INVALID' || state === 'FAILED') {
      throw new Error(
        `Release stopped: build status ${state}. Human step: the developer forwards Apple's email; fix, then rebuild with a new build number.`,
      );
    }
    if (attempt < attempts) poll.sleepSeconds(pollSeconds);
  }
  throw new Error(
    'processing did not reach VALID within 60 minutes: check the TestFlight tab in App Store Connect, then rerun with --resume processing',
  );
}
