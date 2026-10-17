// module-stubs.mjs: resolves bare package specifiers to local stand-in files while a checker imports
// the app's own modules (a helper, not an entry point). Register before the first import.
//   registerModuleStubs({ 'expo-iap': '/abs/scripts/lib/stubs/expo-iap.mjs' });

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const stubs = new Map();
let registered = false;

/** Maps each specifier (exactly, not its subpaths) to the file that stands in for it. */
export function registerModuleStubs(map) {
  for (const [specifier, file] of Object.entries(map)) stubs.set(specifier, pathToFileURL(file).href);
  if (registered || typeof registerHooks !== 'function') return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubs.has(specifier)) return { url: stubs.get(specifier), shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  registered = true;
}
