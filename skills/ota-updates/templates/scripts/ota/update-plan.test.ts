// scripts/ota/update-plan.test.ts
import {
  MAX_FIRST_ROLLOUT_PERCENT,
  channelTargets,
  commandLine,
  liveRuntimes,
  planUpdate,
  printedJson,
  resolveProfile,
  runtimeProblems,
  updateArgs,
} from './update-plan.ts';

import type { EasBuildRecord, EasJson, UpdatePlan } from './update-plan.ts';

const variant = (name: string) => ({ APP_VARIANT: name, EXPO_PUBLIC_APP_VARIANT: name });

const EAS: EasJson = {
  build: {
    development: { developmentClient: true, distribution: 'internal', env: variant('development') },
    preview: {
      distribution: 'internal',
      environment: 'preview',
      channel: 'preview',
      env: variant('preview'),
    },
    'preview-simulator': { extends: 'preview' },
    production: {
      distribution: 'store',
      environment: 'production',
      channel: 'production',
      env: variant('production'),
    },
  },
};

const IOS_RUNTIME = 'c771bc775a1159b784a37f8698e0a8b7fd6e5ecc';
const ANDROID_RUNTIME = '0daa7d460bf395eb3dd6661a3edec6d73fd8d046';

const build = (platform: string, channel: string, runtime: string): EasBuildRecord => ({
  platform,
  status: 'FINISHED',
  updateChannel: { name: channel },
  runtime: { version: runtime },
});

function planned(request: Parameters<typeof planUpdate>[1]): UpdatePlan {
  const result = planUpdate(EAS, request);
  if (!result.ok) throw new Error(result.problems.join('; '));
  return result.plan;
}

describe('resolveProfile', () => {
  it('applies extends and merges env', () => {
    expect(resolveProfile(EAS, 'preview-simulator').channel).toBe('preview');
    expect(resolveProfile(EAS, 'preview-simulator').env).toStrictEqual(variant('preview'));
  });

  it('throws on a missing profile and on a cycle', () => {
    expect(() => resolveProfile(EAS, 'staging')).toThrow('no build profile "staging"');
    const cycle: EasJson = { build: { a: { extends: 'b' }, b: { extends: 'a' } } };
    expect(() => resolveProfile(cycle, 'a')).toThrow('cycle');
  });
});

describe('channelTargets', () => {
  it('lists the channels baked into binaries, store channels marked', () => {
    const targets = channelTargets(EAS);
    expect([...targets.keys()]).toStrictEqual(['preview', 'production']);
    expect(targets.get('production')?.isStore).toBe(true);
    expect(targets.get('preview')?.isStore).toBe(false);
  });
});

describe('planUpdate', () => {
  it('plans a preview update with the environment of the preview builds', () => {
    expect(
      planned({ channel: 'preview', message: ' Fix due dates ', platform: 'all' }),
    ).toStrictEqual({
      channel: 'preview',
      environment: 'preview',
      message: 'Fix due dates',
      platforms: ['ios', 'android'],
      rolloutPercentage: null,
      env: variant('preview'),
    });
  });

  it('refuses a channel no build carries, an empty message and a store channel without a rollout', () => {
    expect(planUpdate(EAS, { channel: 'staging', message: 'x', platform: 'all' })).toStrictEqual({
      ok: false,
      problems: ['no build profile bakes channel staging into a binary'],
    });
    const refused = planUpdate(EAS, { channel: 'production', message: ' ', platform: 'ios' });
    expect(refused.ok ? [] : refused.problems).toStrictEqual([
      `production is a store channel: start with --rollout <1-${String(MAX_FIRST_ROLLOUT_PERCENT)}>`,
      '--message is empty: say what the update fixes',
    ]);
  });

  it('keeps the first store rollout step small and whole', () => {
    const request = { channel: 'production', message: 'Fix', platform: 'all' } as const;
    expect(planUpdate(EAS, { ...request, rolloutPercentage: 10 }).ok).toBe(true);
    expect(planUpdate(EAS, { ...request, rolloutPercentage: 50 }).ok).toBe(false);
    expect(planUpdate(EAS, { ...request, rolloutPercentage: 2.5 }).ok).toBe(false);
    expect(
      planUpdate(EAS, {
        channel: 'preview',
        message: 'Fix',
        platform: 'all',
        rolloutPercentage: 100,
      }).ok,
    ).toBe(true);
  });

  it('refuses a channel whose builds name another variant or environment, or none', () => {
    const crossed: EasJson = {
      build: {
        preview: { channel: 'preview', environment: 'production', env: variant('preview') },
      },
    };
    expect(planUpdate(crossed, { channel: 'preview', message: 'x', platform: 'all' }).ok).toBe(
      false,
    );
    const unnamed: EasJson = { build: { beta: { channel: 'beta', distribution: 'internal' } } };
    expect(planUpdate(unnamed, { channel: 'beta', message: 'x', platform: 'all' })).toStrictEqual({
      ok: false,
      problems: [
        'channel beta is built as variant preview in environment preview: name all three the same',
      ],
    });
    const staging: EasJson = {
      build: { staging: { channel: 'staging', distribution: 'internal', env: variant('staging') } },
    };
    expect(
      planUpdate(staging, { channel: 'staging', message: 'x', platform: 'all' }),
    ).toStrictEqual({
      ok: false,
      problems: [
        'build profile staging builds APP_VARIANT staging for channel staging, which is not an app variant',
      ],
    });
  });

  it("reads the variant from the EAS environment, or EAS Build's default one, when eas.json sets no env", () => {
    const fromEnvironment: EasJson = {
      build: { production: { channel: 'production', environment: 'production' } },
    };
    const request = {
      channel: 'production',
      message: 'Fix',
      platform: 'all',
      rolloutPercentage: 10,
    } as const;
    const plan = planUpdate(fromEnvironment, request);
    expect(plan.ok && plan.plan.env).toStrictEqual(variant('production'));
    const byDefault: EasJson = { build: { production: { channel: 'production' } } };
    expect(planUpdate(byDefault, request).ok).toBe(true);
    const internal: EasJson = {
      build: { production: { channel: 'production', distribution: 'internal' } },
    };
    expect(planUpdate(internal, request).ok).toBe(false);
  });
});

describe('runtimeProblems', () => {
  const builds = [
    build('IOS', 'production', IOS_RUNTIME),
    build('ANDROID', 'production', ANDROID_RUNTIME),
    build('IOS', 'preview', 'ab8cb482649f808ced9307af691ac9cb74d2e464'),
    { ...build('ANDROID', 'production', 'f00d'), status: 'ERRORED' },
  ];
  const plan = planned({
    channel: 'production',
    message: 'Fix',
    platform: 'all',
    rolloutPercentage: 10,
  });

  it('finds the live runtime versions of one channel and platform', () => {
    expect(liveRuntimes(builds, 'production', 'android')).toStrictEqual([ANDROID_RUNTIME]);
  });

  it('passes when every platform runtime has a finished build on the channel', () => {
    expect(
      runtimeProblems(plan, { ios: IOS_RUNTIME, android: ANDROID_RUNTIME }, builds),
    ).toStrictEqual([]);
  });

  it('stops an update whose runtime no build on the channel has (a native change)', () => {
    const problems = runtimeProblems(plan, { ios: 'new-native', android: ANDROID_RUNTIME }, builds);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `ios: runtime new-native has no finished build on channel production (live: ${IOS_RUNTIME})`,
    );
    expect(runtimeProblems(plan, {}, [])[1]).toContain('(live: none)');
  });
});

describe('updateArgs', () => {
  it('names channel, environment, platform, message and the rollout', () => {
    const plan = planned({
      channel: 'production',
      message: "Fix Tasks' due dates",
      platform: 'ios',
      rolloutPercentage: 10,
    });
    expect(updateArgs(plan)).toStrictEqual([
      'update',
      '--channel',
      'production',
      '--environment',
      'production',
      '--platform',
      'ios',
      '--message',
      "Fix Tasks' due dates",
      '--rollout-percentage',
      '10',
      '--non-interactive',
    ]);
    expect(commandLine(updateArgs(plan))).toBe(
      "eas update --channel production --environment production --platform ios --message 'Fix Tasks'\\'' due dates' --rollout-percentage 10 --non-interactive",
    );
  });

  it('publishes both platforms in one group without a rollout on preview', () => {
    const plan = planned({ channel: 'preview', message: 'Fix', platform: 'all' });
    expect(commandLine(updateArgs(plan))).toBe(
      'eas update --channel preview --environment preview --platform all --message Fix --non-interactive',
    );
  });
});

describe('printedJson', () => {
  it('reads the JSON after any notice lines, single-line or pretty-printed', () => {
    expect(
      printedJson('★ eas-cli 24.13.0 is now available\n{"runtimeVersion":"abc"}\n'),
    ).toStrictEqual({
      runtimeVersion: 'abc',
    });
    expect(printedJson('[\n  {\n    "status": "FINISHED"\n  }\n]\n')).toStrictEqual([
      { status: 'FINISHED' },
    ]);
  });

  it('throws when nothing JSON was printed', () => {
    expect(() => printedJson('Not logged in')).toThrow('no JSON in the output');
  });
});
