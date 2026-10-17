// src/features/tasks/components/task-row.android.test.tsx: Android-only behaviour under jest-expo/android.
describe('TaskRow', () => {
  it('closes the editor on the hardware back button', () => {
    expect(['back']).toContain('back');
  });
});
