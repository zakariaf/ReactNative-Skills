// load-ts.mjs: imports the app's own TypeScript modules into check-ad-behaviour.mjs through Node's
// type stripping (Node 22.18+), so the behaviour check runs the real code without Jest or a build.
// Alias and extensionless imports resolve through the shared app-modules.mjs (tsconfig "paths",
// workspace names); setModuleStubs() maps native packages (the ads SDK, expo-tracking-transparency,
// react-native, react, expo-constants) to the Node stand-ins in stubs/, so adapters run. Not an
// entry point.

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

import { enableAppImports, errorText } from './app-modules.mjs';

const stubs = new Map();
let isHooked = false;

/** Resolve these bare specifiers to local stand-in files ({ react: '/abs/stub.mjs' }). Call before importing. */
export function setModuleStubs(map) {
  for (const [specifier, file] of Object.entries(map)) stubs.set(specifier, pathToFileURL(file).href);
  if (isHooked) return;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubs.has(specifier)) return { url: stubs.get(specifier), shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  isHooked = true;
}

/** Lets this process import the app's TypeScript from appRoot; returns the loader. */
export function appLoader(appRoot) {
  const app = enableAppImports(appRoot);
  return {
    exists: (rel) => app.exists(rel),
    /** { module } or { error } with a one-line reason, so a checker reports a broken module as a problem. */
    async load(rel) {
      if (!app.exists(rel)) return { error: `${rel} does not exist` };
      try {
        return { module: await app.load(rel) };
      } catch (error) {
        return { error: `${rel} could not be loaded: ${errorText(error)}` };
      }
    },
  };
}
