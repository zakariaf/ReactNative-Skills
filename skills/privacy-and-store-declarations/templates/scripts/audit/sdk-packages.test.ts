// scripts/audit/sdk-packages.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sdkPackages } from './sdk-packages.ts';

let root = '';

function install(at: string, manifest: Readonly<Record<string, unknown>>): void {
  const dir = path.join(root, at);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
}

describe('sdkPackages', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sdk-packages-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('covers what a declared SDK installs, recursively and through nested node_modules', () => {
    install('node_modules/@crash/react-native', {
      dependencies: { '@crash/core': '1.0.0', '@crash/browser': '1.0.0' },
    });
    install('node_modules/@crash/core', {});
    install('node_modules/@crash/react-native/node_modules/@crash/browser', {
      optionalDependencies: { '@crash-internal/replay': '1.0.0' },
    });
    install('node_modules/@crash-internal/replay', {});
    expect([...sdkPackages(root, new Set(['@crash/react-native']))].sort()).toStrictEqual([
      '@crash-internal/replay',
      '@crash/browser',
      '@crash/core',
      '@crash/react-native',
    ]);
  });

  it('ignores a peer: the app answers for its own packages', () => {
    install('node_modules/@crash/react-native', { peerDependencies: { 'react-native': '*' } });
    install('node_modules/react-native', {});
    expect([...sdkPackages(root, new Set(['@crash/react-native']))]).toStrictEqual([
      '@crash/react-native',
    ]);
  });

  it('covers only the declared names without node_modules', () => {
    expect([...sdkPackages(root, new Set(['expo-iap']))]).toStrictEqual(['expo-iap']);
  });
});
