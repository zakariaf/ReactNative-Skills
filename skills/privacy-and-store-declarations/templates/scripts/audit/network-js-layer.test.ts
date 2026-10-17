// scripts/audit/network-js-layer.test.ts
// Module contents are assembled from parts: the lint rule bans URL literals and network calls here.
import { packageOf, repoPathOf } from './bundle-modules.ts';
import { jsNetworkFindings, maskComments, modulesContaining } from './network-js-layer.ts';

const call = (name: string): string => `${name}(input)`;
const link = ['"https', '://help.example.test/privacy"'].join('');
const SEAMS = { network: ['src/api/**'], urls: ['src/config/**'] };

function module(
  source: string,
  content: string,
): { platform: string; source: string; content: string } {
  return { platform: 'ios', source, content };
}

describe('jsNetworkFindings', () => {
  it('allows first-party requests in the API folder and links in config', () => {
    const modules = [
      module('../../src/api/fetch-api-client.ts', call('fetch')),
      module('/src/config/external-links.ts', `export const privacy = ${link};`),
      module('\0polyfill:external-require', call('fetch')),
    ];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([]);
  });

  it('fails first-party network code outside the seams, at once', () => {
    const modules = [
      module('../../src/features/tasks/use-tasks-model.ts', call('fetch')),
      module('../../src/config/external-links.ts', call('fetch')),
      module('../../src/ui/logo.tsx', `const uri = ${link};`),
    ];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([
      'ios: src/features/tasks/use-tasks-model.ts: fetch',
      'ios: src/config/external-links.ts: fetch',
      'ios: src/ui/logo.tsx: remoteUrl',
    ]);
  });

  it('passes XML namespace and schema identifiers: they name no request', () => {
    const svg = ['"http', '://www.w3.org/2000/svg"'].join('');
    const schema = ['"https', '://json-schema.org/draft-07/schema"'].join('');
    const modules = [module('/src/ui/check-icon.tsx', `const ns = ${svg}; const s = ${schema};`)];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([]);
  });

  it('fails a URL literal in the API folder: base URLs live in config', () => {
    const modules = [module('/src/api/endpoints.ts', `export const base = ${link};`)];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([
      'ios: src/api/endpoints.ts: remoteUrl',
    ]);
  });

  it('fails a file transfer outside the seams but not a local asset copy', () => {
    const modules = [
      module('/src/features/tasks/attach.ts', `File.${call('downloadFileAsync')}`),
      module('/src/features/tasks/upload.ts', call('uploadAsync')),
      module('/src/ui/icon.tsx', 'await asset.downloadAsync();'),
    ];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([
      'ios: src/features/tasks/attach.ts: fileTransfer',
      'ios: src/features/tasks/upload.ts: fileTransfer',
    ]);
  });

  it('ignores comments in first-party modules, never strings', () => {
    const doc = `/** It never calls ${call('fetch')} itself; see ${link}. */\n// ${call('fetch')}\n`;
    const modules = [
      module('/src/features/tasks/use-tasks-model.ts', `${doc}export const x = 1;`),
      module('/src/ui/logo.tsx', `const uri = ${link}; // a logo`),
    ];

    expect(jsNetworkFindings(modules, SEAMS).firstParty).toStrictEqual([
      'ios: src/ui/logo.tsx: remoteUrl',
    ]);
    expect(maskComments('a // b\nc /* d */')).toBe('a     \nc        ');
  });

  it('allows nothing first-party under the offline-only profile', () => {
    const modules = [module('../../src/api/fetch-api-client.ts', call('fetch'))];

    expect(jsNetworkFindings(modules, { network: [], urls: [] }).firstParty).toHaveLength(1);
  });

  it('groups third-party findings by npm package', () => {
    const modules = [
      module('../../node_modules/@scope/sdk/lib/net.js', `${call('fetch')}; ${link}`),
    ];

    expect(jsNetworkFindings(modules, SEAMS).findings).toStrictEqual(
      new Map([['@scope/sdk', new Set(['fetch', 'remoteUrl'])]]),
    );
  });
});

describe('module helpers', () => {
  it('names packages, repo paths and modules holding a needle outside its package', () => {
    expect(packageOf('../../node_modules/react-native/index.js')).toBe('react-native');
    expect(packageOf('../../src/app/_layout.tsx')).toBeNull();
    expect(repoPathOf('../../src/app/_layout.tsx')).toBe('src/app/_layout.tsx');
    const modules = [
      module('../../node_modules/ads-sdk/src/test-ids.ts', 'sample-123'),
      module('../../src/features/ads/ad-ids.ts', 'sample-123'),
    ];
    expect(modulesContaining(modules, /sample-123/u, 'ads-sdk')).toStrictEqual([
      'ios: src/features/ads/ad-ids.ts',
    ]);
  });
});
