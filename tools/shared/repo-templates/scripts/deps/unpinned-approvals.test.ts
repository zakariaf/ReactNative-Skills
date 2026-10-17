// scripts/deps/unpinned-approvals.test.ts
import { nameOnlyPackage, unpinnedApprovals } from './unpinned-approvals.ts';

describe('nameOnlyPackage', () => {
  it('names the package of a bare name, name@ and name@*, scoped or not', () => {
    expect(nameOnlyPackage('fsevents')).toBe('fsevents');
    expect(nameOnlyPackage('fsevents@*')).toBe('fsevents');
    expect(nameOnlyPackage('lefthook@')).toBe('lefthook');
    expect(nameOnlyPackage('@sentry/cli')).toBe('@sentry/cli');
    expect(nameOnlyPackage('@sentry/cli@*')).toBe('@sentry/cli');
  });

  it('returns null for pinned keys and for sources that are not registry names', () => {
    expect(nameOnlyPackage('fsevents@2.3.3')).toBeNull();
    expect(nameOnlyPackage('fsevents@2.3.2 || 2.3.3')).toBeNull();
    expect(nameOnlyPackage('@sentry/cli@2.58.4')).toBeNull();
    expect(nameOnlyPackage('github:acme/tool')).toBeNull();
    expect(nameOnlyPackage('file:../tool')).toBeNull();
  });
});

describe('unpinnedApprovals', () => {
  it('passes pinned approvals and denials of every version', () => {
    const allowScripts = {
      'unrs-resolver@1.12.2': true,
      'fsevents@2.3.2 || 2.3.3': true,
      lefthook: false,
      '@shopify/react-native-skia': false,
    };
    expect(unpinnedApprovals(allowScripts)).toStrictEqual([]);
    expect(unpinnedApprovals(undefined)).toStrictEqual([]);
  });

  it('reports every key that approves all versions of a package', () => {
    const problems = unpinnedApprovals({ fsevents: true, '@sentry/cli@*': true, knip: 'true' });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('allowScripts "fsevents": true approves the install script');
    expect(problems[0]).toContain('npm approve-scripts fsevents');
    expect(problems[1]).toContain('"@sentry/cli@*": true approves the install script of every');
  });
});
