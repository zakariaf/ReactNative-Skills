// scripts/build/emu-build-args.test.ts
import { EMU_BUILD_USAGE, isHelpRequest, parseEmuBuildArgs } from './emu-build-args.ts';

describe('parseEmuBuildArgs', () => {
  it('defaults to a preview build on the smoke emulator of the host ABI', () => {
    expect(parseEmuBuildArgs([])).toStrictEqual({
      variant: 'preview',
      purpose: 'smoke',
      appDir: '.',
      abi: null,
      link: null,
      keepEmulator: false,
    });
  });

  it('reads every flag, booleans included', () => {
    const argv = ['--variant', 'production', '--emu', 'release-check', '--app-dir', 'apps/mobile'];
    const more = ['--keep-emulator', '--abi', 'x86_64', '--link', 'tasks/42'];
    expect(parseEmuBuildArgs([...argv, ...more])).toStrictEqual({
      variant: 'production',
      purpose: 'release-check',
      appDir: 'apps/mobile',
      abi: 'x86_64',
      link: 'tasks/42',
      keepEmulator: true,
    });
  });

  it('refuses an unknown variant through the app resolver', () => {
    expect(() => parseEmuBuildArgs(['--variant', 'staging'])).toThrow('APP_VARIANT=staging');
  });

  it('refuses an unknown flag, a missing value, a bad purpose, ABI or link', () => {
    expect(() => parseEmuBuildArgs(['--device', 'emulator-5554'])).toThrow('unexpected argument');
    expect(() => parseEmuBuildArgs(['--variant'])).toThrow('unexpected argument');
    expect(() => parseEmuBuildArgs(['--emu', 'Pixel 8'])).toThrow('kebab-case');
    expect(() => parseEmuBuildArgs(['--abi', 'armeabi-v7a'])).toThrow('arm64-v8a or x86_64');
    expect(() => parseEmuBuildArgs(['--link', 'tasks-dev://tasks'])).toThrow('the path after');
  });

  it('recognises a help request and documents every flag', () => {
    expect(isHelpRequest(['--variant', 'preview', '-h'])).toBe(true);
    for (const flag of ['--variant', '--emu', '--app-dir', '--abi', '--link', '--keep-emulator']) {
      expect(EMU_BUILD_USAGE).toContain(flag);
    }
  });
});
