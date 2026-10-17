// app-config.mjs: evaluates an Expo app config once per variant, the way Expo does, with zero
// dependencies (a helper, not an entry point). app.config.ts runs through Node's type stripping
// (Node 22.18 or newer), app.config.{js,mjs,cjs} through import(), app.json is read as JSON. Each
// variant is evaluated in its own child process (evaluate-app-config.mjs) with APP_VARIANT and
// EXPO_PUBLIC_APP_VARIANT set (the canonical resolver reads both), so every module the config
// imports, not only the config itself, reads that variant's environment, even at module scope. The
// config must load without packages it does not import (type-only imports such as `expo/config`
// are erased); one that cannot load is bad input (exit 2).
//
//   findAppConfig(root, appRel)                 repo-relative path of the app config, or null
//   loadVariantConfigs(root, rel, variants)     Map<variant, ExpoConfig>
//   keyLine(text, key)                          1-based line of the first `key:` / "key": in the text
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError } from '../check-lib.mjs';

const CONFIG_FILES = ['app.config.ts', 'app.config.mts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.json'];

export function findAppConfig(root, appRel) {
  for (const name of CONFIG_FILES) {
    const rel = posix.join(appRel, name);
    if (existsSync(join(root, rel))) return rel;
  }
  return null;
}

function readStaticConfig(root, appRel) {
  const path = join(root, appRel, 'app.json');
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data?.expo ?? data ?? {};
  } catch (error) {
    throw new UsageError(`${posix.join(appRel, 'app.json')} is not valid JSON: ${error.message}`, 'Fix the JSON syntax of app.json.');
  }
}

const EVALUATOR = fileURLToPath(new URL('./evaluate-app-config.mjs', import.meta.url));

/** Evaluates the config in a child process with the variant's environment (fresh module graph). */
function evaluateOnce(root, rel, variant, staticConfig) {
  const result = spawnSync(process.execPath, [EVALUATOR, join(root, rel)], {
    cwd: join(root, posix.dirname(rel)),
    env: { ...process.env, APP_VARIANT: variant, EXPO_PUBLIC_APP_VARIANT: variant },
    input: JSON.stringify(staticConfig),
    stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `exit ${result.status ?? result.signal}`);
  return JSON.parse(result.output[3]);
}

/** The exact change for the load errors Node's type stripping raises where Expo's loader does not. */
function fixFor(error) {
  const text = String(error?.message ?? error);
  if (/expo[\\/]config/.test(text)) return "Write the types import as `import type { ConfigContext, ExpoConfig } from 'expo/config'` (Node keeps a plain import and cannot load expo/config).";
  if (/Cannot find package/.test(text)) return "Install the app's packages (npm ci): the config imports a package that is not in node_modules.";
  if (/Cannot find module/.test(text)) return 'Point each relative import of the config at an existing file, with its extension (./src/config/updates-config.ts).';
  if (/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|TypeScript/.test(text)) return 'Use erasable TypeScript only in the config and the files it imports (no enum, namespace or parameter properties): Node strips types, it does not compile them.';
  return 'Run from an installed app (npm ci) and make the config evaluate with APP_VARIANT set to that variant.';
}

/** The evaluated config of every variant. */
export async function loadVariantConfigs(root, rel, variants) {
  const appRel = posix.dirname(rel);
  const staticConfig = readStaticConfig(root, appRel);
  const configs = new Map();
  if (rel.endsWith('.json')) {
    for (const variant of variants) configs.set(variant, staticConfig);
    return configs;
  }
  for (const variant of variants) {
    try {
      configs.set(variant, evaluateOnce(root, rel, variant, staticConfig));
    } catch (error) {
      throw new UsageError(
        `${rel} did not evaluate for APP_VARIANT=${variant}: ${error?.message ?? error}`,
        fixFor(error),
      );
    }
  }
  return configs;
}

export function keyLine(text, key) {
  const match = new RegExp(`(?:^|[\\s{,])["']?${key}["']?\\s*:`, 'm').exec(text);
  if (!match) return 1;
  const at = match.index + match[0].search(/["'\w]/);
  return text.slice(0, at).split('\n').length;
}
