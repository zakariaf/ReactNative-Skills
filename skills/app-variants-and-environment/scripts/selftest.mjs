// selftest.mjs: proves every checker of this skill against planted-bug fixtures.
// Each suite assembles its cases from tests/bases/app, tests/bases/decoys and this skill's templates
// (so the shipped templates are the good case), plus each case's mutation.json. make-variant-icons runs
// on generated store icons and writes the badged copies into the assembled case.
//   node scripts/selftest.mjs [--case <glob>]... [--materialize <dir>]
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'check-variants.mjs', fixtures: '../tests/fixtures/check-variants', args: (dir) => [dir] },
  { script: 'check-env.mjs', fixtures: '../tests/fixtures/check-env', args: (dir) => [dir] },
  { script: 'make-variant-icons.mjs', fixtures: '../tests/fixtures/make-variant-icons', args: (dir) => [dir] },
  {
    script: 'check-variant-bundle.mjs',
    fixtures: '../tests/fixtures/check-variant-bundle',
    args: (dir) => [dir, '--bundle', 'dist/variant-proof/production', '--variant', 'production'],
  },
]);
