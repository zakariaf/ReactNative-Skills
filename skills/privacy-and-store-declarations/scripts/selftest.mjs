#!/usr/bin/env node
// selftest.mjs: proves the four audits against assembled fixtures (check-lib's overlay format):
//   audit-repo.mjs             the shipped templates + tests/bases/repo (a filled single-app Tasks repo)
//   audit-bundle.mjs           tests/bases/bundle (a release export's source maps + the contracts)
//   audit-privacy-manifest.mjs tests/bases/pods (a prebuilt ios/ folder's pod manifests + the contracts)
//   audit-app-bundle.mjs       tests/bases/app (a built .app, a merged Android manifest + the contracts)
// Every bad-* case plants one problem and must fail for its rule; pass-* and error-* cases pin SKIP,
// NOT APPLICABLE-free passes and bad input. Run: node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs
import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [
  { script: 'audit-repo.mjs', fixtures: '../tests/fixtures/audit-repo', args: (dir) => [dir] },
  { script: 'audit-bundle.mjs', fixtures: '../tests/fixtures/audit-bundle', args: (dir) => [dir] },
  { script: 'audit-privacy-manifest.mjs', fixtures: '../tests/fixtures/audit-privacy-manifest', args: (dir) => [dir] },
  { script: 'audit-app-bundle.mjs', fixtures: '../tests/fixtures/audit-app-bundle', args: (dir) => [dir, '--app', `${dir}/build/Tasks.app`, '--android-manifest', `${dir}/build/AndroidManifest.xml`] },
]);
