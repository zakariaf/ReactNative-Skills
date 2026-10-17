// src/services/local-notifications/local-notifications-port.test.ts
import { isNotificationAllowed } from './local-notifications-port';

import type { NotificationPermission } from './local-notifications-port';

describe('isNotificationAllowed', () => {
  it('allows granted and provisional, and nothing else', () => {
    const all: readonly NotificationPermission[] = [
      'granted',
      'provisional',
      'undetermined',
      'denied',
      'blocked',
    ];

    expect(all.filter(isNotificationAllowed)).toStrictEqual(['granted', 'provisional']);
  });
});
