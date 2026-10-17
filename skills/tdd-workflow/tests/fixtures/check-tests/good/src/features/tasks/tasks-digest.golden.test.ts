// src/features/tasks/tasks-digest.golden.test.ts: readable data snapshots live in golden tests only.
import { digestNotificationId } from './tasks-digest';

describe('digestNotificationId', () => {
  it('keeps the identifier format of an installed version', () => {
    expect(digestNotificationId('inbox', '2026-10-10')).toMatchSnapshot();
  });
});
