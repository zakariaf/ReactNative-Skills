import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-titles.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] }]);
