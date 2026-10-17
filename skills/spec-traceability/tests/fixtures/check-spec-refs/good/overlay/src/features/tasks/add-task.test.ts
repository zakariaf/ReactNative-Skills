// src/features/tasks/add-task.test.ts
import { addTask } from './add-task';

// Short codes in code are data, not citations: S16 and D12 have no configured prefix.
const CODES = ['S16', 'D12', 'N40'];
// PKCE (S256) is a standards name. TASKS-12 is a tracker key, not a spec prefix.

describe('addTask', () => {
  it('puts a new task at the top of the open tasks (REQ-1)', () => {
    expect(addTask(['b'], 'a')).toStrictEqual(['a', 'b']);
  });

  it('keeps unknown IDs out of the lookup (fixture data)', () => {
    // spec-refs-ignore: the next line uses a missing ID on purpose
    expect(CODES.includes('REQ-99')).toBe(false);
  });
});
