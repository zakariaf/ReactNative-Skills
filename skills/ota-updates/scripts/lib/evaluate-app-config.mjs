// evaluate-app-config.mjs: evaluates one app config in this process and writes it as JSON to file
// descriptor 3 (a helper run by app-config.mjs in a child process, one per variant, so every module
// the config imports is evaluated afresh with that variant's environment; not an entry point for
// people). The parent sets APP_VARIANT and EXPO_PUBLIC_APP_VARIANT and passes the static config
// (app.json's expo object, or {}) on stdin. Functions in the config (inline config plugins) become
// "[Function <name>]" strings: the checker reads only plain values. On failure the message goes to
// stderr and the exit code is 3.
//
//   node evaluate-app-config.mjs <absolute config path>
import { readFileSync, writeSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Node warns once per typeless package.json that holds ESM; the warning is noise for a checker. */
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const code = typeof rest[0] === 'object' ? rest[0]?.code : rest[1];
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return undefined;
  return emit.call(process, warning, ...rest);
};

/**
 * Two import forms Expo's own config loader accepts that plain Node does not, so an app outside the
 * house style can still be checked: `import { ConfigContext, ExpoConfig } from 'expo/config'` (a
 * value import of two types; Node keeps it, and expo/config is a folder Node's ESM loader refuses)
 * and an extensionless relative import (`./src/config/updates-config`). expo/config resolves to a
 * module that exports those two names as undefined; an extensionless relative specifier is tried
 * with .ts, .tsx, .mts, .js and /index.ts. Needs module.registerHooks (Node 22.15+); without it the
 * error message names the change.
 */
const EXPO_CONFIG_STUB = `data:text/javascript,${encodeURIComponent('export const ConfigContext = undefined; export const ExpoConfig = undefined; export default {};')}`;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '/index.ts'];
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'expo/config') return { url: EXPO_CONFIG_STUB, format: 'module', shortCircuit: true };
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const relative = specifier.startsWith('./') || specifier.startsWith('../');
        if (!relative || /\.[cm]?[jt]sx?$/.test(specifier) || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        for (const extension of EXTENSIONS) {
          try {
            return nextResolve(specifier + extension, context);
          } catch {
            // try the next extension
          }
        }
        throw error;
      }
    },
  });
}

const replacer = (_key, value) => (typeof value === 'function' ? `[Function ${value.name || 'anonymous'}]` : value);

try {
  const configPath = process.argv[2];
  const appDir = dirname(configPath);
  const staticConfig = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const module = await import(pathToFileURL(configPath).href);
  const exported = module.default ?? module;
  const context = { config: staticConfig, projectRoot: appDir, staticConfigPath: null, packageJsonPath: join(appDir, 'package.json') };
  const config = typeof exported === 'function' ? await exported(context) : exported;
  writeSync(3, JSON.stringify(config?.expo ?? config ?? {}, replacer));
} catch (error) {
  process.stderr.write(String(error?.message ?? error));
  process.exitCode = 3;
}
