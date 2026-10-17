// scripts/release/processing-wait.test.ts
// The processing wait on a fake clock: no real time passes, no token is minted, nothing is fetched.
import {
  buildIdOf,
  PROCESSING_WAIT,
  processingPollPath,
  pollUntilValid,
  reusedToken,
} from './processing-wait.ts';

import type { ProcessingPoll } from './processing-wait.ts';

const LIFETIME = 15 * 60;
const START = 1_000_000;

type FakeClock = {
  readonly now: () => number;
  readonly sleepSeconds: (seconds: number) => void;
  readonly mint: (at: number) => string;
  readonly minted: number[];
};

/** A clock that only moves when the wait sleeps, and a mint that names the second it ran. */
function fakeClock(): FakeClock {
  let now = START;
  const minted: number[] = [];
  return {
    now: () => now,
    sleepSeconds: (seconds) => {
      now += seconds;
    },
    mint: (at) => {
      minted.push(at);
      return `token-${String(minted.length)}`;
    },
    minted,
  };
}

const answer = (state: string, id = 'build-rest-id'): unknown => ({
  data: [{ id, attributes: { processingState: state } }],
});

type Read = { readonly at: number; readonly path: string; readonly token: string };

function pollOf(states: readonly string[], clock = fakeClock()) {
  const reads: Read[] = [];
  const lines: string[] = [];
  const queue = [...states];
  const poll: ProcessingPoll = {
    path: processingPollPath('6400000000', 8, '1.4.0'),
    read: async (path, token) => {
      reads.push({ at: clock.now(), path, token });
      const state = queue.shift() ?? 'PROCESSING';
      return Promise.resolve(state === 'none' ? { data: [] } : answer(state));
    },
    token: reusedToken(clock.mint, clock.now, LIFETIME),
    sleepSeconds: clock.sleepSeconds,
    log: (line) => lines.push(line),
  };
  return { poll, reads, lines, clock };
}

describe('processingPollPath and buildIdOf', () => {
  it('asks only for the processing state of one build', () => {
    expect(processingPollPath('6400000000', 8, '1.4.0')).toBe(
      '/v1/builds?filter[app]=6400000000&filter[version]=8&filter[preReleaseVersion.version]=1.4.0&fields[builds]=processingState&limit=1',
    );
  });

  it("reads the first build's REST id, or '' without one", () => {
    expect(buildIdOf(answer('VALID', 'abc'))).toBe('abc');
    expect(buildIdOf({ data: [] })).toBe('');
    expect(buildIdOf(null)).toBe('');
  });
});

describe('reusedToken', () => {
  it('mints once and reuses the token until a minute before it expires', () => {
    const clock = fakeClock();
    const token = reusedToken(clock.mint, clock.now, LIFETIME);
    expect(token()).toBe('token-1');
    clock.sleepSeconds(LIFETIME - 61);
    expect(token()).toBe('token-1');
    clock.sleepSeconds(1);
    expect(token()).toBe('token-2');
    expect(clock.minted).toStrictEqual([START, START + LIFETIME - 60]);
  });
});

describe('pollUntilValid', () => {
  it('waits two minutes before the first poll, then polls every minute until VALID', async () => {
    const { poll, reads } = pollOf(['none', 'PROCESSING', 'VALID']);
    await expect(pollUntilValid(poll)).resolves.toBe('build-rest-id');
    expect(PROCESSING_WAIT.firstPollSeconds).toBe(120);
    expect(reads.map((read) => read.at - START)).toStrictEqual([120, 180, 240]);
    expect(new Set(reads.map((read) => read.path))).toStrictEqual(new Set([poll.path]));
  });

  it('reuses one token across polls and mints the next a minute before it expires', async () => {
    const { poll, reads, clock } = pollOf([]);
    await expect(pollUntilValid(poll)).rejects.toThrow('did not reach VALID within 60 minutes');
    expect(reads).toHaveLength(PROCESSING_WAIT.attempts);
    expect(new Set(reads.map((read) => read.token)).size).toBe(clock.minted.length);
    expect(clock.minted.map((at) => at - START)).toStrictEqual([120, 960, 1800, 2640, 3480]);
  });

  it('stops on INVALID or FAILED with the human step, and never logs a token', async () => {
    const { poll, lines } = pollOf(['PROCESSING', 'INVALID']);
    await expect(pollUntilValid(poll)).rejects.toThrow('Release stopped: build status INVALID');
    expect(lines).toStrictEqual([
      'release:ios: processing PROCESSING (1/60)',
      'release:ios: processing INVALID (2/60)',
    ]);
    expect(lines.join('\n')).not.toContain('token-');
  });
});
