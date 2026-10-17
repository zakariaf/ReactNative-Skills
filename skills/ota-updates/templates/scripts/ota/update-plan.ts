// scripts/ota/update-plan.ts
// The pure half of the update preflight (the ota-updates skill): which channels the build profiles
// bake into binaries, whether an `eas update` request targets one of them with the environment its
// builds used, whether every platform's runtime version already has a finished build on that
// channel, and the exact eas update command. No I/O: update-preflight.ts feeds it.
import { isAppVariant, variantEnv } from '../../src/config/app-variant.ts';

import type { AppVariant } from '../../src/config/app-variant.ts';

export const UPDATE_PLATFORMS = ['ios', 'android'] as const;
export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];

/** The first step of a store-channel rollout reaches at most this share of phones. */
export const MAX_FIRST_ROLLOUT_PERCENT = 25;

export type EasBuildProfile = {
  readonly extends?: string;
  readonly channel?: string;
  readonly environment?: string;
  readonly distribution?: string;
  readonly developmentClient?: boolean;
  readonly env?: Readonly<Record<string, string>>;
};
export type EasJson = { readonly build?: Readonly<Record<string, EasBuildProfile>> };

/** A channel some build profile bakes into its binaries. */
export type ChannelTarget = {
  readonly channel: string;
  readonly profile: string;
  readonly variant: string | null;
  readonly environment: string;
  readonly isStore: boolean;
};

export type UpdateRequest = {
  readonly channel: string;
  readonly message: string;
  readonly platform: UpdatePlatform | 'all';
  readonly rolloutPercentage?: number;
};

export type UpdatePlan = {
  readonly channel: string;
  readonly environment: string;
  readonly message: string;
  readonly platforms: readonly UpdatePlatform[];
  readonly rolloutPercentage: number | null;
  /** APP_VARIANT and EXPO_PUBLIC_APP_VARIANT of the channel's builds. */
  readonly env: Readonly<Record<string, AppVariant>>;
};

/** One finished build as `eas build:list --json` prints it (the fields this plan reads). */
export type EasBuildRecord = {
  readonly platform: string;
  readonly status: string;
  readonly updateChannel?: { readonly name: string } | null;
  readonly runtime?: { readonly version: string } | null;
};

export type Planned = { readonly ok: true; readonly plan: UpdatePlan };
export type Refused = { readonly ok: false; readonly problems: readonly string[] };

/** A profile with its extends chain applied (env merges one level, as EAS does). */
export function resolveProfile(
  eas: EasJson,
  name: string,
  seen: readonly string[] = [],
): EasBuildProfile {
  const profile = eas.build?.[name];
  if (profile === undefined) throw new Error(`eas.json has no build profile "${name}"`);
  if (profile.extends === undefined) return profile;
  if (seen.includes(name)) throw new Error(`eas.json build profiles extend in a cycle: ${name}`);
  const base = resolveProfile(eas, profile.extends, [...seen, name]);
  return { ...base, ...profile, env: { ...base.env, ...profile.env } };
}

/**
 * The EAS environment a build of the profile loads: its own, else EAS Build's default (production
 * for store distribution, development for a development client, preview otherwise; Expo docs,
 * "Using environment variables with EAS Build", verified 2026-10-16).
 */
function buildEnvironment(profile: EasBuildProfile): string {
  if (profile.environment !== undefined) return profile.environment;
  if ((profile.distribution ?? 'store') === 'store') return 'production';
  return profile.developmentClient === true ? 'development' : 'preview';
}

function targetOf(eas: EasJson, profileName: string): ChannelTarget | null {
  const profile = resolveProfile(eas, profileName);
  if (profile.channel === undefined) return null;
  const isDevClient = profile.developmentClient === true;
  const environment = buildEnvironment(profile);
  return {
    channel: profile.channel,
    profile: profileName,
    // eas.json's env wins; otherwise APP_VARIANT comes from the EAS environment's variables.
    variant: profile.env?.['APP_VARIANT'] ?? environment,
    environment,
    isStore: (profile.distribution ?? 'store') === 'store' && !isDevClient,
  };
}

/** Every channel baked into a binary, by channel name (the first profile that names it wins). */
export function channelTargets(eas: EasJson): ReadonlyMap<string, ChannelTarget> {
  const targets = new Map<string, ChannelTarget>();
  for (const name of Object.keys(eas.build ?? {})) {
    const target = targetOf(eas, name);
    if (target !== null && !targets.has(target.channel)) targets.set(target.channel, target);
  }
  return targets;
}

function rolloutProblems(target: ChannelTarget, rollout: number | undefined): string[] {
  if (rollout === undefined) {
    return target.isStore
      ? [
          `${target.channel} is a store channel: start with --rollout <1-${String(MAX_FIRST_ROLLOUT_PERCENT)}>`,
        ]
      : [];
  }
  const max = target.isStore ? MAX_FIRST_ROLLOUT_PERCENT : 100;
  return Number.isInteger(rollout) && rollout >= 1 && rollout <= max
    ? []
    : [`--rollout must be a whole number from 1 to ${String(max)} on ${target.channel}`];
}

function targetProblems(target: ChannelTarget): string[] {
  if (target.variant === null || !isAppVariant(target.variant)) {
    return [
      `build profile ${target.profile} builds APP_VARIANT ${String(target.variant)} for channel ${target.channel}, which is not an app variant`,
    ];
  }
  if (target.variant !== target.channel || target.environment !== target.channel) {
    return [
      `channel ${target.channel} is built as variant ${target.variant} in environment ${target.environment}: name all three the same`,
    ];
  }
  return [];
}

/** Checks an update request against eas.json; returns the plan or every reason to stop. */
export function planUpdate(eas: EasJson, request: UpdateRequest): Planned | Refused {
  const target = channelTargets(eas).get(request.channel);
  if (target === undefined) {
    return {
      ok: false,
      problems: [`no build profile bakes channel ${request.channel} into a binary`],
    };
  }
  const problems = [
    ...targetProblems(target),
    ...rolloutProblems(target, request.rolloutPercentage),
  ];
  if (request.message.trim() === '') problems.push('--message is empty: say what the update fixes');
  if (problems.length > 0 || target.variant === null || !isAppVariant(target.variant)) {
    return { ok: false, problems };
  }
  const platforms = request.platform === 'all' ? [...UPDATE_PLATFORMS] : [request.platform];
  const plan = {
    channel: target.channel,
    environment: target.environment,
    message: request.message.trim(),
    platforms,
    rolloutPercentage: request.rolloutPercentage ?? null,
    env: variantEnv(target.variant),
  };
  return { ok: true, plan };
}

const BUILD_PLATFORM: Readonly<Record<UpdatePlatform, string>> = { ios: 'IOS', android: 'ANDROID' };

/** Runtime versions of the finished builds on `channel` for `platform`. */
export function liveRuntimes(
  builds: readonly EasBuildRecord[],
  channel: string,
  platform: UpdatePlatform,
): readonly string[] {
  const live = builds
    .filter((build) => build.status === 'FINISHED' && build.platform === BUILD_PLATFORM[platform])
    .filter((build) => build.updateChannel?.name === channel)
    .map((build) => build.runtime?.version)
    .filter((version) => version !== undefined);
  return [...new Set(live)];
}

/** A runtime version no finished build on the channel has: the update would reach no phone. */
export function runtimeProblems(
  plan: UpdatePlan,
  local: Readonly<Partial<Record<UpdatePlatform, string>>>,
  builds: readonly EasBuildRecord[],
): readonly string[] {
  return plan.platforms.flatMap((platform) => {
    const runtime = local[platform];
    const live = liveRuntimes(builds, plan.channel, platform);
    if (runtime !== undefined && live.includes(runtime)) return [];
    const seen = live.length === 0 ? 'none' : live.join(', ');
    return [
      `${platform}: runtime ${String(runtime)} has no finished build on channel ${plan.channel} (live: ${seen}); a native input changed since that build, so ship a store build first`,
    ];
  });
}

/** The eas update command of a plan (run by the developer, never by the preflight). */
export function updateArgs(plan: UpdatePlan): readonly string[] {
  const platform = plan.platforms.length === 1 ? (plan.platforms[0] ?? 'all') : 'all';
  const rollout =
    plan.rolloutPercentage === null ? [] : ['--rollout-percentage', String(plan.rolloutPercentage)];
  return [
    'update',
    '--channel',
    plan.channel,
    '--environment',
    plan.environment,
    '--platform',
    platform,
    '--message',
    plan.message,
    ...rollout,
    '--non-interactive',
  ];
}

/** A shell-safe command line for printing. */
export function commandLine(args: readonly string[]): string {
  const quote = (arg: string): string =>
    /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
  return ['eas', ...args].map(quote).join(' ');
}

/** The JSON a command printed, from its first line that starts with { or [ (notices may precede it). */
export function printedJson(output: string): unknown {
  const start = output.search(/^[[{]/m);
  if (start < 0) throw new Error(`no JSON in the output:\n${output}`);
  return JSON.parse(output.slice(start));
}
