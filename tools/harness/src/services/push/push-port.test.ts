// src/services/push/push-port.test.ts
import { isPushAllowed } from './push-port';

import type { PushPermission } from './push-port';

describe('isPushAllowed', () => {
  it.each<[PushPermission, boolean]>([
    ['granted', true],
    ['provisional', true],
    ['undetermined', false],
    ['denied', false],
    ['blocked', false],
  ])('returns %s for %s', (permission, isAllowed) => {
    expect(isPushAllowed(permission)).toBe(isAllowed);
  });
});
