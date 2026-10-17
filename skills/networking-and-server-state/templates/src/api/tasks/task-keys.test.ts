// src/api/tasks/task-keys.test.ts
import { QueryClient } from '@tanstack/react-query';

import { taskKeys } from './task-keys';

import type { QueryKey } from '@tanstack/react-query';

/** Which of `keys` an invalidation of `prefix` marks stale, in a real cache. */
async function invalidatedBy(
  prefix: QueryKey,
  keys: readonly QueryKey[],
): Promise<readonly boolean[]> {
  const queryClient = new QueryClient();
  for (const key of keys) queryClient.setQueryData(key, []);
  await queryClient.invalidateQueries({ queryKey: prefix, refetchType: 'none' });
  const marks = keys.map((key) => queryClient.getQueryState(key)?.isInvalidated === true);
  queryClient.clear();
  return marks;
}

describe('taskKeys', () => {
  it('nests every list and detail under the resource key', async () => {
    const keys = [taskKeys.list('open'), taskKeys.list('done'), taskKeys.detail('t1')];

    await expect(invalidatedBy(taskKeys.all, keys)).resolves.toStrictEqual([true, true, true]);
    await expect(invalidatedBy(taskKeys.lists(), keys)).resolves.toStrictEqual([true, true, false]);
    await expect(invalidatedBy(taskKeys.detail('t1'), keys)).resolves.toStrictEqual([
      false,
      false,
      true,
    ]);
  });

  it('gives each filter and id its own key', () => {
    expect(taskKeys.list('open')).not.toStrictEqual(taskKeys.list('done'));
    expect(taskKeys.detail('t1')).toStrictEqual(['tasks', 'detail', 't1']);
  });
});
