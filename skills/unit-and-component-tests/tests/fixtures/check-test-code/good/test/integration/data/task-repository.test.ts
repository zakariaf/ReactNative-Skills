// test/integration/data/task-repository.test.ts
import { createTaskRepository } from '@/data/task-repository';
import { createNodeSqliteSqlDriver } from '@test/sqlite/node-sqlite-sql-driver';

describe('createTaskRepository', () => {
  it('reads back what it saved', async () => {
    const repository = createTaskRepository(createNodeSqliteSqlDriver(':memory:'));
    await repository.save({ id: 'task-1', title: 'Buy milk', isDone: false });

    await expect(repository.byId('task-1')).resolves.toStrictEqual({
      id: 'task-1',
      title: 'Buy milk',
      isDone: false,
    });
  });
});
