// scripts/audit/network-native-layer.test.ts — builds an npm-workspaces-shaped repo on disk.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  categoriesOf,
  installedPackageRoot,
  moduleRootsOf,
  nativeNetworkFindings,
  packageRootOf,
  sourceFiles,
} from './network-native-layer.ts';

describe('the native layer', () => {
  let root = '';

  function write(rel: string, text: string): string {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }

  beforeEach(() => {
    // realpath: macOS tmpdir() is a symlink (/var -> /private/var) and require.resolve returns real paths.
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'native-layer-')));
    write('package.json', '{"name":"app","workspaces":["apps/*"]}');
    write('apps/tasks/package.json', '{"name":"tasks"}');
    write('node_modules/hoisted-lib/package.json', '{"name":"hoisted-lib","version":"1.0.0"}');
    write('node_modules/sdk-a/package.json', '{"name":"sdk-a"}');
    write(
      'node_modules/sdk-a/ios/SdkA.swift',
      'let task = URLSession.shared.dataTask(with: request)',
    );
    write(
      'node_modules/sdk-a/android/src/main/java/SdkA.kt',
      'val client = okhttp3.OkHttpClient()',
    );
    write('node_modules/sdk-b/package.json', '{"name":"sdk-b"}');
    write('node_modules/sdk-b/SdkB.m', 'WKWebView *view;');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('the native module walk', () => {
    it('resolves a package where npm hoisted it, never under the app folder', () => {
      expect(installedPackageRoot(path.join(root, 'apps/tasks'), 'hoisted-lib')).toBe(
        path.join(root, 'node_modules/hoisted-lib'),
      );
    });

    it('takes the package root from the nearest package.json, for both platforms', () => {
      const roots = moduleRootsOf(path.join(root, 'node_modules/react-native'), [
        {
          rn: {},
          expo: {
            modules: [
              {
                packageName: 'sdk-a',
                pods: [{ podspecDir: path.join(root, 'node_modules/sdk-a/ios') }],
              },
            ],
          },
        },
        {
          rn: {
            dependencies: {
              'sdk-b': {
                root: path.join(root, 'node_modules/sdk-b'),
                platforms: { android: null, ios: {} },
              },
            },
          },
          expo: {},
        },
        {
          rn: {},
          expo: {
            modules: [{ packageName: 'dev-tool', debugOnly: true, pods: [{ podspecDir: root }] }],
          },
        },
        {
          rn: {},
          expo: { modules: [{ packageName: 'dev-tool', projects: [{ sourceDir: root }] }] },
        },
      ]);

      expect([...roots.keys()]).toStrictEqual(['react-native', 'sdk-a', 'sdk-b']);
      expect(roots.get('sdk-a')).toBe(path.join(root, 'node_modules/sdk-a'));
      expect(packageRootOf(path.join(root, 'node_modules/sdk-b'))).toBe(
        path.join(root, 'node_modules/sdk-b'),
      );
    });

    it('skips a symlink, so a workspace link back into the app is not walked', () => {
      symlinkSync(path.join(root, 'apps'), path.join(root, 'node_modules/sdk-b/link'));

      expect(sourceFiles(path.join(root, 'node_modules/sdk-b'))).toStrictEqual([
        path.join(root, 'node_modules/sdk-b/SdkB.m'),
      ]);
    });

    it('scans Apple and Android sources with their own patterns', () => {
      const findings = nativeNetworkFindings(
        new Map([
          ['sdk-a', path.join(root, 'node_modules/sdk-a')],
          ['sdk-b', path.join(root, 'node_modules/sdk-b')],
        ]),
      );

      expect(findings.get('sdk-a')).toStrictEqual(new Set(['urlSession', 'httpClient']));
      expect(findings.get('sdk-b')).toStrictEqual(new Set(['webView']));
      expect(categoriesOf('Net.java', 'new java.net.Socket(host, 80)')).toStrictEqual([
        'lowLevelSocket',
      ]);
    });
  });
});
