#!/usr/bin/env node
// check-titles.mjs: a sample checker (fixture); it scans the repo with walkRepo.
import { createReporter, run, walkRepo } from './check-lib.mjs';

run(async () => {
  const report = createReporter({ name: 'check-titles' });
  const files = walkRepo('.', { include: ['*.ts'] });
  return report.finish({ checked: files.length, unit: 'files' });
});
