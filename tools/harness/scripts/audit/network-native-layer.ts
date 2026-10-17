// scripts/audit/network-native-layer.ts
// Network-capable native code in every autolinked module, iOS and Android: the module list comes
// from React Native and Expo autolinking, each module's sources are scanned for HTTP stacks,
// sockets and web views. Regex cannot see inside binary .xcframework or .aar files: the trunk-pod
// layer, the Gradle report and the runtime socket sampling cover that gap.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { addFinding } from './network-baseline.ts';

import type { Findings } from './network-baseline.ts';

const APPLE_PATTERNS: Readonly<Record<string, RegExp>> = {
  urlSession: /\b(?:NS)?URLSession\b|\bNSURLConnection\b/u,
  webSocket: /URLSessionWebSocketTask|SRWebSocket|SocketRocket/u,
  lowLevelSocket: /\bCFSocket|\bCFStreamCreatePairWithSocket|\bNWConnection\b|\bgetaddrinfo\(/u,
  webView: /\bWKWebView\b|\bSFSafariViewController\b|\bASWebAuthenticationSession\b/u,
};
const ANDROID_PATTERNS: Readonly<Record<string, RegExp>> = {
  httpClient: /\bHttpURLConnection\b|\bokhttp3\.(?:OkHttpClient|Call)\b|\bOkHttpClient\b/u,
  webSocket: /\bokhttp3\.WebSocket\b|\bnewWebSocket\(/u,
  lowLevelSocket: /\bjava\.net\.Socket\b|\bnew Socket\(|\bDatagramSocket\b/u,
  webView: /\bandroid\.webkit\.WebView\b|\bCustomTabsIntent\b/u,
};
const APPLE_SOURCE = /\.(?:swift|m|mm|h|c|cpp)$/u;
const ANDROID_SOURCE = /\.(?:java|kt)$/u;
const SKIPPED_FOLDERS = new Set(['node_modules', 'build', 'Pods', 'test', 'tests', 'androidTest']);

/**
 * Every native source file under dir. Symlinks are never followed: workspace links point back at
 * an app and its ios/Pods, whose CocoaPods header links can dangle.
 */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED_FOLDERS.has(name) || name.startsWith('.')) {
      return [];
    }
    const file = path.join(dir, name);
    const entry = lstatSync(file);
    if (entry.isSymbolicLink()) {
      return [];
    }
    if (entry.isDirectory()) {
      return sourceFiles(file);
    }
    return APPLE_SOURCE.test(name) || ANDROID_SOURCE.test(name) ? [file] : [];
  });
}

/** The package folder that holds a podspec or Gradle project: the nearest folder with a package.json. */
export function packageRootOf(nativeDir: string): string {
  for (let dir = nativeDir; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      return nativeDir;
    }
  }
}

/** Where a package is installed for this app, resolved the way Node and Metro do (npm may hoist it). */
export function installedPackageRoot(appDir: string, name: string): string {
  const require = createRequire(path.join(appDir, 'package.json'));
  return path.dirname(require.resolve(`${name}/package.json`));
}

type RnDependency = {
  readonly root: string;
  readonly platforms?: Readonly<Record<string, unknown>>;
};
type ExpoModule = {
  readonly packageName: string;
  readonly debugOnly?: boolean;
  readonly pods?: readonly { readonly podspecDir: string }[];
  readonly projects?: readonly { readonly sourceDir: string }[];
};
/** What the autolinking commands print (only the fields this layer reads). */
export type AutolinkingOutput = {
  readonly rn: { readonly dependencies?: Readonly<Record<string, RnDependency>> };
  readonly expo: { readonly modules?: readonly ExpoModule[] };
};

function nativeDirOf(module: ExpoModule): string | undefined {
  return module.pods?.[0]?.podspecDir ?? module.projects?.[0]?.sourceDir;
}

/**
 * The modules a release build never contains: Expo marks the dev launcher and dev menu debugOnly
 * on Apple (Debug-only pods), and on Android they ship release stubs (disableInRelease).
 */
function debugOnlyModules(outputs: readonly AutolinkingOutput[]): ReadonlySet<string> {
  const modules = outputs.flatMap((output) => output.expo.modules ?? []);
  return new Set(
    modules.filter((module) => module.debugOnly === true).map((module) => module.packageName),
  );
}

/** name -> package root over every platform's autolinking output, without debug-only modules. */
export function moduleRootsOf(
  reactNativeRoot: string,
  outputs: readonly AutolinkingOutput[],
): Map<string, string> {
  const debugOnly = debugOnlyModules(outputs);
  const roots = new Map<string, string>([['react-native', reactNativeRoot]]);
  for (const output of outputs) {
    for (const [name, dep] of Object.entries(output.rn.dependencies ?? {})) {
      const isNative = Object.values(dep.platforms ?? {}).some((value) => value !== null);
      if (isNative) {
        roots.set(name, dep.root);
      }
    }
    for (const module of output.expo.modules ?? []) {
      const nativeDir = nativeDirOf(module);
      if (nativeDir !== undefined && !debugOnly.has(module.packageName)) {
        roots.set(module.packageName, packageRootOf(nativeDir));
      }
    }
  }
  return roots;
}

function autolinking(appDir: string, args: readonly string[]): unknown {
  const json = execFileSync('npx', ['expo-modules-autolinking', ...args], {
    cwd: appDir,
    encoding: 'utf8',
  });
  return JSON.parse(json) as unknown;
}

function platformOutput(
  appDir: string,
  rnPlatform: string,
  expoPlatform: string,
): AutolinkingOutput {
  return {
    rn: autolinking(appDir, [
      'react-native-config',
      '--platform',
      rnPlatform,
      '--json',
    ]) as AutolinkingOutput['rn'],
    expo: autolinking(appDir, [
      'resolve',
      '--platform',
      expoPlatform,
      '--json',
    ]) as AutolinkingOutput['expo'],
  };
}

/** Every autolinked native module of the app, iOS and Android. */
export function nativeModuleRoots(appDir: string): Map<string, string> {
  return moduleRootsOf(installedPackageRoot(appDir, 'react-native'), [
    platformOutput(appDir, 'ios', 'apple'),
    platformOutput(appDir, 'android', 'android'),
  ]);
}

/** The categories one native source file matches. */
export function categoriesOf(file: string, text: string): string[] {
  const patterns = ANDROID_SOURCE.test(file) ? ANDROID_PATTERNS : APPLE_PATTERNS;
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);
}

export function nativeNetworkFindings(roots: ReadonlyMap<string, string>): Findings {
  const findings = new Map<string, Set<string>>();
  for (const [name, root] of roots) {
    for (const file of sourceFiles(root)) {
      for (const category of categoriesOf(file, readFileSync(file, 'utf8'))) {
        addFinding(findings, name, category);
      }
    }
  }
  return findings;
}
