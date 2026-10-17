// selftest.mjs: proves both scripts against tests/fixtures/ (overlay suites on the shipped templates
// plus tests/bases/app): the good app passes, every planted bug fails for its own rule, the NOT
// APPLICABLE facts hold, and bad input exits 2.
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-deep-links.mjs', fixtures: '../tests/fixtures/check-deep-links', args: (dir) => [dir] },
  { script: 'write-well-known.mjs', fixtures: '../tests/fixtures/write-well-known', args: (dir) => [dir, '--check'] },
]);
