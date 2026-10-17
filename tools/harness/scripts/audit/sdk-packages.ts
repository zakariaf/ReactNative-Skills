// scripts/audit/sdk-packages.ts
// What an SDK declaration in contracts/privacy.json covers in the network audit: the SDK and every
// package it installs itself, its dependencies and optional dependencies, followed through
// node_modules the way Node resolves them (its own nested node_modules first, then up to the app
// root). @sentry/react-native declares the crash reporter, and its @sentry/core and @sentry/browser
// go online only through it. Peers are not followed: a peer is the app's own package and answers for
// itself. Without node_modules only the declared names are covered.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Installed = { readonly dir: string; readonly dependencies: readonly string[] };

/** The package `name` as Node finds it from `fromDir`, with the packages it installs; null when absent. */
function findInstalled(root: string, fromDir: string, name: string): Installed | null {
  const top = path.resolve(root);
  let dir = path.resolve(fromDir);
  for (;;) {
    const file = path.join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly optionalDependencies?: Readonly<Record<string, string>>;
      };
      const dependencies = Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
      });
      return { dir: path.dirname(file), dependencies };
    }
    if (dir === top || path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
}

/** The declared SDKs and every package they install, recursively (never their peers). */
export function sdkPackages(root: string, declared: ReadonlySet<string>): ReadonlySet<string> {
  const covered = new Set(declared);
  const queue: Installed[] = [];
  for (const sdk of declared) {
    const found = findInstalled(root, root, sdk);
    if (found !== null) queue.push(found);
  }
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const dependency of next.dependencies) {
      if (covered.has(dependency)) continue;
      covered.add(dependency);
      const found = findInstalled(root, next.dir, dependency);
      if (found !== null) queue.push(found);
    }
  }
  return covered;
}
