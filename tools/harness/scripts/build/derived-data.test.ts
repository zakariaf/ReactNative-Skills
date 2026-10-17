// scripts/build/derived-data.test.ts
import { isStaleDerivedData, moduleCachePathIn, normalizedPath } from './derived-data.ts';

const PRIVATE = ['', 'private'].join('/');

describe('isStaleDerivedData', () => {
  it('is stale when the recorded workspace lies in another folder', () => {
    const recorded = '/tmp/old-copy/tasks/ios/Tasks.xcworkspace';
    expect(isStaleDerivedData(recorded, `${PRIVATE}/tmp/new-copy/tasks/ios`)).toBe(true);
    expect(isStaleDerivedData(recorded, `${PRIVATE}/tmp/old-copy/tasks/ios`)).toBe(false);
  });

  it('keeps DerivedData whose recorded path is unknown', () => {
    expect(isStaleDerivedData(null, '/repo/ios')).toBe(false);
  });

  it('treats /private/tmp and /tmp as one folder', () => {
    expect(normalizedPath(`${PRIVATE}/tmp/a/`)).toBe('/tmp/a');
  });
});

describe('moduleCachePathIn', () => {
  it('finds the module cache path inside a precompiled module', () => {
    const pcm = `\u0000\u0003[AM/tmp/old-copy/tasks/build/ios-sim/dd/ModuleCache.noindex/K2H/SwiftShims-1.pcm\u0000`;
    expect(moduleCachePathIn(pcm)).toBe(
      '/tmp/old-copy/tasks/build/ios-sim/dd/ModuleCache.noindex/',
    );
    expect(moduleCachePathIn('no path here')).toBeNull();
  });
});
