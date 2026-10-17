// scripts/release/release-upload.ts
// Release steps 8-12: validate, upload, wait until Apple's processing says VALID, set What to Test,
// tag the build. Every Apple error goes through the playbook (release-failures.ts).
import { execFileSync } from 'node:child_process';

import { buildTag } from './build-number.ts';
import { pollUntilValid, processingPollPath, reusedToken } from './processing-wait.ts';
import { findDeliveryId } from './processing.ts';
import { uploadArgs, validateArgs } from './release-options.ts';
import { runReleaseStep, sleepSeconds } from './release-steps.ts';
import { ascRequest, errorCodes } from '../asc/asc-client.ts';
import { loadAscCredentials } from '../asc/asc-credentials.ts';
import { ASC_TOKEN_LIFETIME_SECONDS, createAscJwt } from '../asc/asc-jwt.ts';
import { setWhatsNew } from '../asc/beta-notes.ts';
import { nowEpochSeconds } from '../clock/system-clock.ts';

import type { Preflight } from './release-preflight.ts';
import type { ReleaseContext } from './release-steps.ts';
import type { AscCredentials } from '../asc/asc-jwt.ts';

export type Uploaded = { readonly buildNumber: number; readonly deliveryId: string | null };
export type UploadInput = {
  readonly ipa: string;
  readonly pre: Preflight;
  readonly buildNumber: number;
};

/** Steps 8-9. `--wait` returns when Apple starts PROCESSING; VALID is awaited in step 10. */
export function validateAndUpload(input: UploadInput, context: ReleaseContext): Uploaded {
  const { ipa, pre, buildNumber } = input;
  runReleaseStep('validate', { file: 'xcrun', args: validateArgs(ipa, pre.ids) }, context);
  const meta = {
    appleAppId: pre.app.appleAppId,
    bundleId: pre.app.bundleId,
    buildNumber,
    version: pre.app.version,
  };
  const output = runReleaseStep(
    'upload',
    { file: 'xcrun', args: uploadArgs(ipa, meta, pre.ids) },
    context,
  );
  let json: unknown = null;
  try {
    json = JSON.parse(output);
  } catch {
    json = null;
  }
  return { buildNumber, deliveryId: findDeliveryId(json) };
}

const RESUME_PROCESSING =
  'Resume: the upload is done; once the cause is fixed (a 401 or 403 is a human step), rerun with --resume processing.';

/** One read of the builds endpoint. Any error keeps the resume hint: the upload must not repeat. */
async function readBuilds(path: string, bearer: string): Promise<unknown> {
  let response: Awaited<ReturnType<typeof ascRequest>>;
  try {
    response = await ascRequest(bearer, { method: 'GET', path });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`reading the processing state failed: ${reason}\n${RESUME_PROCESSING}`);
  }
  if (!response.ok) {
    throw new Error(
      `App Store Connect answered ${String(response.status)} (${errorCodes(response)}) while waiting for processing\n${RESUME_PROCESSING}`,
    );
  }
  return response.json;
}

/** The key, read once into memory for the whole wait (a missing id keeps the resume hint). */
function credentialsFor(env: NodeJS.ProcessEnv): AscCredentials {
  try {
    return loadAscCredentials(env);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`reading the processing state failed: ${reason}\n${RESUME_PROCESSING}`);
  }
}

/** Step 10: two minutes, then a poll every 60 s for up to an hour with one reused token. */
export async function waitUntilValid(
  pre: Preflight,
  buildNumber: number,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const credentials = credentialsFor(env);
  return pollUntilValid({
    path: processingPollPath(pre.app.appleAppId, buildNumber, pre.app.version),
    read: readBuilds,
    token: reusedToken(
      (now) => createAscJwt(credentials, now),
      nowEpochSeconds,
      ASC_TOKEN_LIFETIME_SECONDS,
    ),
    sleepSeconds,
    log: (line) => {
      console.log(line);
    },
  });
}

export type TagInput = {
  readonly pre: Preflight;
  /** '' for a single app, '<folder>/' when multi-package. */
  readonly prefix: string;
  readonly variant: string;
  readonly buildNumber: number;
  readonly restId: string;
};

/**
 * Steps 11-12: What to Test (the text the preflight built and checked), then the annotated upload
 * tag. Returns the tester text for the report; any failure here keeps the resume line.
 */
export async function describeAndTag(input: TagInput, env: NodeJS.ProcessEnv): Promise<string> {
  const { pre, buildNumber } = input;
  try {
    await setWhatsNew(
      createAscJwt(loadAscCredentials(env), nowEpochSeconds()),
      input.restId,
      pre.whatToTest,
    );
    const tag = buildTag(input.prefix, pre.app.version, buildNumber);
    const message = `App Store build ${String(buildNumber)} (TestFlight, ${input.variant})`;
    execFileSync('git', ['tag', '-a', tag, '-m', message]);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${reason}\nResume: the build is VALID; rerun with --resume processing to set What to Test and tag it.`,
    );
  }
  return pre.whatToTest;
}
