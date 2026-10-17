// src/features/tasks/components/task-check.test.tsx
// Decoy: tests may sequence with timers; check-motion never reads them.
import { withSpring } from 'react-native-reanimated';

describe('TaskCheck', () => {
  it('runs a timer in a test', () => {
    setTimeout(() => withSpring(1), 10);
    expect(true).toBe(true);
  });
});
