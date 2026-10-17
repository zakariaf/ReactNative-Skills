// scripts/e2e/sampler-evidence.ts
// Proof that the socket samplers were watching. An empty network.txt is evidence only when every
// sampler of the run sampled until the end and found the app on its device: a sampler that crashed
// at import, never matched the app (a wrong executable or uid), or died halfway leaves the same empty
// file. Each sampler (sample-sockets.ts) rewrites its status file after every sample; at the end the
// runner reads every status twice, a few samples apart (a live sampler's count grows in between),
// stops the samplers, writes the verdict to network-samplers.json next to network.txt (the
// e2e-maestro report checker's network-sampler rule reads it) and fails the run on any problem.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What a sampler writes after every sample. */
export type SamplerStatus = {
  readonly samples: number;
  /** Samples that found the app's process on the sampler's device. */
  readonly appSamples: number;
  /**
   * Samples that found the app but could not list its sockets (lsof or /proc/net failed): the
   * sampler saw the app and was still blind.
   */
  readonly listErrors: number;
  /** The last tool failure (pgrep, lsof, adb), or null. */
  readonly lastError: string | null;
};

export const NEW_SAMPLER_STATUS: SamplerStatus = {
  samples: 0,
  appSamples: 0,
  listErrors: 0,
  lastError: null,
};

/** One entry of network-samplers.json. */
export type SamplerEvidence = SamplerStatus & {
  readonly device: string;
  readonly deviceId: string;
  /** Empty when the sampler watched the app until the end. */
  readonly problems: readonly string[];
};

export const SAMPLERS_FILE = 'network-samplers.json';

/** The status file of the sampler on one device, next to the report. */
export const samplerStatusPath = (report: string, deviceId: string): string =>
  `${report}.sampler-${deviceId}.json`;

export function nextSamplerStatus(
  status: SamplerStatus,
  sample: {
    readonly isAppFound: boolean;
    readonly error: string | null;
    /** True when the app was found but listing its sockets failed. */
    readonly isListFailed?: boolean;
  },
): SamplerStatus {
  return {
    samples: status.samples + 1,
    appSamples: status.appSamples + (sample.isAppFound ? 1 : 0),
    listErrors: status.listErrors + (sample.isAppFound && sample.isListFailed === true ? 1 : 0),
    lastError: sample.error ?? status.lastError,
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** A status file's content, or null when it is missing or unreadable. */
export function parseSamplerStatus(text: string | null): SamplerStatus | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof SamplerStatus, unknown>> | null;
    if (raw === null || !isCount(raw.samples) || !isCount(raw.appSamples)) return null;
    const lastError = typeof raw.lastError === 'string' ? raw.lastError : null;
    if (raw.listErrors !== undefined && !isCount(raw.listErrors)) return null;
    const listErrors = raw.listErrors ?? 0;
    return { samples: raw.samples, appSamples: raw.appSamples, listErrors, lastError };
  } catch {
    return null;
  }
}

/**
 * Why a sampler's silence proves nothing, from how it ended (`exit`: null while it still runs) and
 * two reads of its status, `first` before and `later` after a wait of a few samples.
 */
export function samplerProblems(end: {
  readonly exit: string | null;
  readonly first: SamplerStatus | null;
  readonly later: SamplerStatus | null;
}): string[] {
  const { exit, first, later } = end;
  if (later === null) return [`never wrote its status (${exit ?? 'it did not start'})`];
  const problems: string[] = [];
  if (exit !== null) problems.push(`exited before the end of the run (${exit})`);
  else if (first !== null && later.samples <= first.samples) {
    problems.push('stopped sampling before the end of the run');
  }
  const blind = blindness(first, later);
  if (blind !== null) problems.push(`${blind} (${later.lastError ?? 'no tool error'})`);
  return problems;
}

/** Why a sampler that wrote its status saw nothing: no app, no socket listing, or listing lost at the end. */
function blindness(first: SamplerStatus | null, later: SamplerStatus): string | null {
  if (later.appSamples === 0) return 'never found the app on its device';
  if (later.listErrors >= later.appSamples) return 'found the app but never listed its sockets';
  if (first !== null && later.listErrors > first.listErrors) {
    return "could not list the app's sockets at the end of the run";
  }
  return null;
}

/** The part of a spawned process this needs (a ChildProcess). */
type SamplerProcess = {
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): boolean;
};

export type RunningSampler = {
  readonly device: string;
  readonly deviceId: string;
  /** How it ended before the runner stopped it ('exit code 1'), or null while it runs. */
  readonly exit: () => string | null;
  readonly kill: () => void;
};

/** A spawned sampler with how it ended, if it ended before the runner stopped it. */
export function trackSampler(
  device: { readonly name: string; readonly id: string },
  child: SamplerProcess,
): RunningSampler {
  let exit: string | null = null;
  child.on('exit', (code, signal) => {
    exit ??= signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
  });
  child.on('error', (error) => {
    exit ??= `could not start: ${error.message}`;
  });
  return {
    device: device.name,
    deviceId: device.id,
    exit: () => exit,
    kill: () => {
      child.kill();
    },
  };
}

const readText = (file: string): string | null =>
  existsSync(file) ? readFileSync(file, 'utf8') : null;

/**
 * Reads every sampler's status, waits, reads again, stops the samplers and writes the verdict to
 * network-samplers.json beside `report`. Returns one failure line per problem (none: all watched).
 */
export async function proveSamplersAlive(
  samplers: readonly RunningSampler[],
  report: string,
  wait: () => Promise<void>,
): Promise<string[]> {
  const statusOf = (sampler: RunningSampler): SamplerStatus | null =>
    parseSamplerStatus(readText(samplerStatusPath(report, sampler.deviceId)));
  const first = samplers.map(statusOf);
  await wait();
  const evidence: SamplerEvidence[] = samplers.map((sampler, index) => {
    const later = statusOf(sampler);
    const problems = samplerProblems({ exit: sampler.exit(), first: first[index] ?? null, later });
    const { device, deviceId } = sampler;
    return { device, deviceId, ...(later ?? NEW_SAMPLER_STATUS), problems };
  });
  for (const sampler of samplers) sampler.kill();
  const file = join(dirname(report), SAMPLERS_FILE);
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.length === 0) return [`network: no socket sampler ran, see ${file}`];
  return evidence.flatMap(({ device, deviceId, problems }) =>
    problems.map((problem) => `network: the sampler on ${device} (${deviceId}) ${problem}`),
  );
}
