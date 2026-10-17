// scripts/deps/banned-packages.test.ts
import { findBannedPackages, inventoryFromLockfile, type Lockfile } from './banned-packages.ts';

import type { BannedRule } from './dependency-policy.ts';

const RULES: readonly BannedRule[] = [
  { pattern: /^(node-ipc|peacenotwar)$/u, scope: 'anywhere', reason: 'protestware' },
  {
    pattern: /^(axios|cross-fetch)$/u,
    scope: 'direct',
    reason: 'requests go through the ApiClient',
  },
];

const LOCKFILE: Lockfile = {
  packages: {
    '': {
      dependencies: { expo: '~57.0.26', axios: '1.0.0' },
      devDependencies: { eslint: '9.39.5' },
    },
    'node_modules/expo': {},
    'node_modules/some-tool/node_modules/node-ipc': {},
    'node_modules/fbjs/node_modules/cross-fetch': {},
  },
};

describe('inventoryFromLockfile', () => {
  it('separates direct dependencies from everything installed', () => {
    expect(inventoryFromLockfile(LOCKFILE)).toStrictEqual({
      direct: ['axios', 'eslint', 'expo'],
      all: ['cross-fetch', 'expo', 'node-ipc'],
    });
  });

  it('reads the direct dependencies of every workspace', () => {
    const lockfile: Lockfile = {
      packages: {
        '': { devDependencies: { typescript: '6.0.3' } },
        'apps/tasks': { dependencies: { zustand: '5.0.15' } },
      },
    };
    expect(inventoryFromLockfile(lockfile).direct).toStrictEqual(['typescript', 'zustand']);
  });
});

describe('findBannedPackages', () => {
  it('reports anywhere-bans at any depth and direct-bans only as direct dependencies', () => {
    const hits = findBannedPackages(inventoryFromLockfile(LOCKFILE), RULES);
    expect(hits.map((hit) => hit.name)).toStrictEqual(['node-ipc', 'axios']);
  });

  it('accepts a lockfile without banned packages', () => {
    const clean: Lockfile = { packages: { '': {}, 'node_modules/zustand': {} } };
    expect(findBannedPackages(inventoryFromLockfile(clean), RULES)).toStrictEqual([]);
  });
});
