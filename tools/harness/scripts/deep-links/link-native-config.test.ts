// scripts/deep-links/link-native-config.test.ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkNativeConfig, readLinkContract, toPathPattern } from './link-native-config.ts';

import type { LinkContract } from './link-native-config.ts';

const CONTRACT: LinkContract = {
  hosts: {
    development: [],
    preview: ['preview.tasks.example.com'],
    production: ['tasks.example.com'],
  },
  webPaths: ['/tasks/*', '/verify-email'],
};

describe('linkNativeConfig', () => {
  it('builds the iOS entitlement and one verified Android filter for the variant hosts', () => {
    expect(linkNativeConfig(CONTRACT, 'production')).toStrictEqual({
      associatedDomains: ['applinks:tasks.example.com'],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [
            { scheme: 'https' },
            { scheme: 'http' },
            { host: 'tasks.example.com' },
            { pathPattern: '/tasks/.*' },
            { pathPattern: '/verify-email' },
          ],
        },
      ],
    });
  });

  it('adds nothing for a variant without hosts, not even an empty entitlement', () => {
    const links = linkNativeConfig(CONTRACT, 'development');
    expect(links).toStrictEqual({ intentFilters: [] });
    expect('associatedDomains' in links).toBe(false);
  });

  it('turns a trailing wildcard into an Android pathPattern', () => {
    expect(toPathPattern('/lists/*')).toBe('/lists/.*');
    expect(toPathPattern('/')).toBe('/');
  });
});

describe('readLinkContract', () => {
  it('reads the contract and refuses one without hosts or webPaths', () => {
    const root = mkdtempSync(join(tmpdir(), 'link-contract-'));
    try {
      mkdirSync(join(root, 'contracts'));
      writeFileSync(join(root, 'contracts', 'deep-links.json'), JSON.stringify(CONTRACT));
      expect(readLinkContract(root)).toStrictEqual(CONTRACT);
      writeFileSync(join(root, 'contracts', 'deep-links.json'), '{}');
      expect(() => readLinkContract(root)).toThrow('"hosts" and "webPaths" are required');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
