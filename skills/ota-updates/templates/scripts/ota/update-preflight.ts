// scripts/ota/update-preflight.ts
// CLI: node scripts/ota/update-preflight.ts --channel <channel> --message "<what it fixes>"
//      [--rollout <1-25 on a store channel>] [--platform ios|android|all] [--builds <file>]
// The gates in front of every EAS Update (the ota-updates skill), cheapest first: a clean committed
// tree; a channel some build profile bakes into binaries, with its variant and environment; then
// `npm run verify`; then each platform's runtime version, resolved with the channel's EAS
// environment exactly as `eas update` resolves it; then the finished builds on that channel
// (`eas build:list`, or the JSON file --builds names): every runtime version must already be live,
// or the update would carry code for native code no phone has. It never publishes: it prints the
// eas update command, and the developer's word runs it. Exit 0 ready, 1 a gate failed, 2 bad input.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  UPDATE_PLATFORMS,
  commandLine,
  planUpdate,
  printedJson,
  runtimeProblems,
  updateArgs,
} from './update-plan.ts';

import type {
  EasBuildRecord,
  EasJson,
  UpdatePlan,
  UpdatePlatform,
  UpdateRequest,
} from './update-plan.ts';

const USAGE =
  'Usage: node scripts/ota/update-preflight.ts --channel <channel> --message "<text>" ' +
  '[--rollout <percent>] [--platform ios|android|all] [--builds <eas build:list --json file>]';

/** Bad input (exit 2): nothing was run. */
class UsageError extends Error {}

type Options = UpdateRequest & { readonly builds: string | undefined };

function readOptions(argv: readonly string[]): Options | null {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      channel: { type: 'string' },
      message: { type: 'string' },
      rollout: { type: 'string' },
      platform: { type: 'string', default: 'all' },
      builds: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return null;
  const { channel, message, platform } = values;
  if (channel === undefined || message === undefined)
    throw new UsageError('--channel and --message are required');
  if (platform !== 'all' && !UPDATE_PLATFORMS.some((name) => name === platform)) {
    throw new UsageError(`--platform must be ios, android or all, not "${platform}"`);
  }
  const rollout = values.rollout === undefined ? {} : { rolloutPercentage: Number(values.rollout) };
  return {
    channel,
    message,
    platform: platform as UpdatePlatform | 'all',
    builds: values.builds,
    ...rollout,
  };
}

function stop(gate: string, problems: readonly string[]): void {
  if (problems.length === 0) return;
  throw new Error(`${gate} failed, nothing was published:\n  ${problems.join('\n  ')}`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error: unknown) {
    throw new UsageError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The runtime version eas update will compute: the same CLI, with the channel's EAS environment. */
function resolveRuntime(plan: UpdatePlan, platform: UpdatePlatform): string {
  const resolve = `EXPO_NO_DOTENV=1 npx --no-install expo-updates runtimeversion:resolve --platform ${platform}`;
  const args = ['env:exec', plan.environment, resolve, '--non-interactive'];
  const output = execFileSync('eas', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const { runtimeVersion } = printedJson(output) as { readonly runtimeVersion?: string | null };
  if (typeof runtimeVersion !== 'string')
    throw new Error(`${platform}: no runtime version (is runtimeVersion set?)`);
  return runtimeVersion;
}

function finishedBuilds(plan: UpdatePlan, file: string | undefined): readonly EasBuildRecord[] {
  if (file !== undefined) return readJson(file) as readonly EasBuildRecord[];
  const args = ['build:list', '--channel', plan.channel, '--status', 'finished', '--limit', '50'];
  const output = execFileSync('eas', [...args, '--json', '--non-interactive'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return printedJson(output) as readonly EasBuildRecord[];
}

function runGates(options: Options): UpdatePlan {
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  stop(
    'the clean tree gate',
    dirty === '' ? [] : ['commit or stash every change first: an update is a commit'],
  );
  const planned = planUpdate(readJson('eas.json') as EasJson, options);
  if (!planned.ok)
    throw new Error(
      `the channel gate failed, nothing was published:\n  ${planned.problems.join('\n  ')}`,
    );
  console.log('update-preflight: npm run verify ...');
  if (spawnSync('npm', ['run', '-s', 'verify'], { stdio: 'inherit' }).status !== 0) {
    stop('npm run verify', ['see its output above']);
  }
  const local: Partial<Record<UpdatePlatform, string>> = {};
  for (const platform of planned.plan.platforms) {
    local[platform] = resolveRuntime(planned.plan, platform);
    console.log(`update-preflight: ${platform} runtime ${local[platform]}`);
  }
  stop(
    'the runtime gate',
    runtimeProblems(planned.plan, local, finishedBuilds(planned.plan, options.builds)),
  );
  return planned.plan;
}

function main(): number {
  const options = readOptions(process.argv.slice(2));
  if (options === null) {
    console.log(USAGE);
    return 0;
  }
  const plan = runGates(options);
  console.log(
    `update-preflight: ready for channel ${plan.channel} (environment ${plan.environment})`,
  );
  console.log("update-preflight: run this only with the developer's go-ahead:");
  console.log(`  ${commandLine(updateArgs(plan))}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  console.error(`update-preflight: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
