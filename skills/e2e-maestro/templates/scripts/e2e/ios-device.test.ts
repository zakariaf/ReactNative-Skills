// scripts/e2e/ios-device.test.ts
import { bootFailureMessage, IOS_CONTENT_SIZE } from './ios-device.ts';

describe('bootFailureMessage', () => {
  it('explains a full Mac and names only own simulators', () => {
    const message = bootFailureMessage(
      'tasks-e2e-phone',
      'Unable to boot device because of insufficient system resources',
    );
    expect(message).toContain('tasks-e2e-phone');
    expect(message).toContain("never another session's");
  });

  it('leaves other errors alone', () => {
    expect(bootFailureMessage('tasks-e2e-phone', 'Invalid device state')).toBeNull();
  });
});

describe('IOS_CONTENT_SIZE', () => {
  it('uses the largest accessibility size for the large-text step', () => {
    expect(IOS_CONTENT_SIZE).toStrictEqual({
      default: 'large',
      largest: 'accessibility-extra-extra-extra-large',
    });
  });
});
