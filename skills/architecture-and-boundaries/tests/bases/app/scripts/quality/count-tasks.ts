// scripts/quality/count-tasks.ts: Node tooling may import neutral app files by relative path.
import { readFileSync } from 'node:fs';

import { isTaskDone } from '../../src/core/tasks/task.ts';

const tasks = JSON.parse(readFileSync(process.argv[2] ?? 'tasks.json', 'utf8')) as { done: boolean }[];
console.log(tasks.filter((task) => isTaskDone(task)).length);
