// scripts/e2e/sampler-evidence.test.ts
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  NEW_SAMPLER_STATUS,
  nextSamplerStatus,
  parseSamplerStatus,
  proveSamplersAlive,
  samplerProblems,
  samplerStatusPath,
  trackSampler,
  type SamplerEvidence,
} from './sampler-evidence.ts';

const PHONE = { name: 'tasks-e2e-phone', id: 'emulator-5560' };
const TABLET = { name: 'tasks-e2e-tablet', id: 'emulator-5562' };

/** A stand-in for a spawned sampler: emit('exit', code, signal) ends it early. */
class FakeChild extends EventEmitter {
  isKilled = false;
  kill(): boolean {
    this.isKilled = true;
    return true;
  }
}

describe('nextSamplerStatus and parseSamplerStatus', () => {
  it('counts samples, the ones that found the app, and keeps the last error', () => {
    const one = nextSamplerStatus(NEW_SAMPLER_STATUS, { isAppFound: false, error: 'adb: offline' });
    const two = nextSamplerStatus(one, { isAppFound: true, error: null });
    expect(two).toStrictEqual({
      samples: 2,
      appSamples: 1,
      listErrors: 0,
      lastError: 'adb: offline',
    });
    expect(parseSamplerStatus(JSON.stringify(two))).toStrictEqual(two);
  });

  it('reads a missing, broken or wrong-shaped file as no status', () => {
    expect(parseSamplerStatus(null)).toBeNull();
    expect(parseSamplerStatus('{"samples": 3')).toBeNull();
    expect(parseSamplerStatus('{"samples": -1, "appSamples": 0}')).toBeNull();
  });
});

describe('samplerProblems', () => {
  const live = { samples: 40, appSamples: 30, listErrors: 0, lastError: null };

  it('accepts a sampler that kept sampling and found the app', () => {
    const first = { ...live, samples: 38 };
    expect(samplerProblems({ exit: null, first, later: live })).toStrictEqual([]);
  });

  it('names a sampler that never started, exited early, stopped or never found the app', () => {
    expect(samplerProblems({ exit: 'exit code 1', first: null, later: null })).toStrictEqual([
      'never wrote its status (exit code 1)',
    ]);
    expect(samplerProblems({ exit: 'exit code 1', first: live, later: live })).toStrictEqual([
      'exited before the end of the run (exit code 1)',
    ]);
    expect(samplerProblems({ exit: null, first: live, later: live })).toStrictEqual([
      'stopped sampling before the end of the run',
    ]);
    const blind = {
      samples: 40,
      appSamples: 0,
      listErrors: 0,
      lastError: 'pm list packages -U: no uid',
    };
    expect(samplerProblems({ exit: null, first: null, later: blind })).toStrictEqual([
      'never found the app on its device (pm list packages -U: no uid)',
    ]);
  });
});

describe('samplerProblems and socket listing', () => {
  const sees = { samples: 40, appSamples: 30, listErrors: 0, lastError: null };
  const lsofFailed = 'lsof: Command failed';

  it('counts a sample that found the app but could not list its sockets', () => {
    const one = nextSamplerStatus(NEW_SAMPLER_STATUS, {
      isAppFound: true,
      error: lsofFailed,
      isListFailed: true,
    });
    expect(one).toStrictEqual({ samples: 1, appSamples: 1, listErrors: 1, lastError: lsofFailed });
    expect(parseSamplerStatus('{"samples": 3, "appSamples": 1}')).toStrictEqual({
      samples: 3,
      appSamples: 1,
      listErrors: 0,
      lastError: null,
    });
  });

  it('names a sampler that found the app but was blind to its sockets', () => {
    const blind = { ...sees, listErrors: 30, lastError: lsofFailed };
    expect(
      samplerProblems({ exit: null, first: { ...blind, samples: 38 }, later: blind }),
    ).toStrictEqual([`found the app but never listed its sockets (${lsofFailed})`]);
  });

  it('names a sampler whose listing started failing before the end', () => {
    const first = { ...sees, samples: 38, listErrors: 2 };
    const later = { ...sees, listErrors: 4, lastError: lsofFailed };
    expect(samplerProblems({ exit: null, first, later })).toStrictEqual([
      `could not list the app's sockets at the end of the run (${lsofFailed})`,
    ]);
  });
});

describe('proveSamplersAlive', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sampler-evidence-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeStatus = (report: string, status: { samples: number; appSamples: number }) => {
    const text = JSON.stringify({ ...status, lastError: null });
    writeFileSync(samplerStatusPath(report, PHONE.id), text);
  };

  it('passes live samplers, stops them and writes network-samplers.json', async () => {
    const report = join(dir, 'network.txt');
    const phone = new FakeChild();
    const samplers = [trackSampler(PHONE, phone)];
    writeStatus(report, { samples: 10, appSamples: 8 });
    const failures = await proveSamplersAlive(samplers, report, () => {
      writeStatus(report, { samples: 12, appSamples: 10 });
      return Promise.resolve();
    });
    expect(failures).toStrictEqual([]);
    expect(phone.isKilled).toBe(true);
    const evidence = JSON.parse(
      readFileSync(join(dir, 'network-samplers.json'), 'utf8'),
    ) as SamplerEvidence[];
    expect(evidence).toStrictEqual([
      {
        device: PHONE.name,
        deviceId: PHONE.id,
        samples: 12,
        appSamples: 10,
        listErrors: 0,
        lastError: null,
        problems: [],
      },
    ]);
  });

  it('fails a sampler that died halfway and one that never wrote a status', async () => {
    const report = join(dir, 'network.txt');
    const phone = new FakeChild();
    const samplers = [trackSampler(PHONE, phone), trackSampler(TABLET, new FakeChild())];
    writeStatus(report, { samples: 10, appSamples: 8 });
    phone.emit('exit', 1, null);
    const failures = await proveSamplersAlive(samplers, report, () => Promise.resolve());
    expect(failures).toStrictEqual([
      'network: the sampler on tasks-e2e-phone (emulator-5560) exited before the end of the run (exit code 1)',
      'network: the sampler on tasks-e2e-tablet (emulator-5562) never wrote its status (it did not start)',
    ]);
  });

  it('fails a run without any sampler', async () => {
    const failures = await proveSamplersAlive([], join(dir, 'network.txt'), () =>
      Promise.resolve(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('no socket sampler ran');
  });
});
