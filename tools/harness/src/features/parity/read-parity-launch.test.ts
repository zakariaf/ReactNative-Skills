// src/features/parity/read-parity-launch.test.ts
import { paramsFromQuery, parityLaunchHref, readParityLaunchArgument } from './read-parity-launch';

const QUERY = 'frame=test-plain&theme=dark&lang=ar&motion=still&nonce=a1b2c3d4';

describe('readParityLaunchArgument', () => {
  it('reads the -parity launch argument on iOS', () => {
    const get = jest.fn().mockReturnValue(QUERY);

    expect(readParityLaunchArgument({ os: 'ios', get })).toBe(QUERY);
    expect(get).toHaveBeenCalledWith('parity');
  });

  it('is null without one, and on Android (the launch arrives as a link there)', () => {
    const get = jest.fn().mockReturnValue(undefined);
    expect(readParityLaunchArgument({ os: 'ios', get })).toBeNull();

    const android = jest.fn().mockReturnValue(QUERY);
    expect(readParityLaunchArgument({ os: 'android', get: android })).toBeNull();
    expect(android).not.toHaveBeenCalled();
  });
});

describe('paramsFromQuery', () => {
  it('turns a query into search params, a repeated key into a list', () => {
    expect(paramsFromQuery(`?${QUERY}&theme=light`)).toStrictEqual({
      frame: 'test-plain',
      theme: ['dark', 'light'],
      lang: 'ar',
      motion: 'still',
      nonce: 'a1b2c3d4',
    });
  });

  it('builds the in-app href of the launch route', () => {
    expect(parityLaunchHref(QUERY)).toBe(`/debug/parity?${QUERY}`);
  });
});
