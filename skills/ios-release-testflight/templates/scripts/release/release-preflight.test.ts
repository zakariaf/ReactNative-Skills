// scripts/release/release-preflight.test.ts
// The pure parts of the preflight, on a temp folder: no git, no key, no network.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseReleaseConfig } from './release-config.ts';
import {
  plannedBuildNumber,
  reviewPendingLines,
  unfinishedMarkersFound,
} from './release-preflight.ts';

const OPTIONS = {
  variant: 'preview',
  adsMode: null,
  notes: [],
  knownIssues: [],
  resume: null,
} as const;

describe('plannedBuildNumber', () => {
  it('is the next build number, read before the bump commit writes it', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'release-preflight-'));
    const config = join(appDir, 'app.config.ts');
    writeFileSync(config, "const APP_VERSION = '1.4.0';\nconst IOS_BUILD_NUMBER = 7;\n");
    const releaseConfig = { ...parseReleaseConfig({ appId: 'com.acme.tasks' }), appDir };
    expect(plannedBuildNumber(OPTIONS, releaseConfig)).toBe(8);
    expect(readFileSync(config, 'utf8')).toContain('const IOS_BUILD_NUMBER = 7;\n');
  });
});

describe('unfinishedMarkersFound', () => {
  it('names the markers that exist and ignores the others', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-markers-'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'unfinished-screens.md'), '- settings\n');
    expect(unfinishedMarkersFound(root, ['docs/unfinished-screens.md', 'WIP.md'])).toStrictEqual([
      'docs/unfinished-screens.md',
    ]);
  });
});

describe('reviewPendingLines', () => {
  it("keeps only the review sheet's not-blocking pending lines", () => {
    const output = [
      'review-sheet: ar: 4 texts drafted',
      'REVIEW PENDING (not blocking): 4 drafted texts in reports/i18n/; list them in the report.',
      '',
    ].join('\n');
    expect(reviewPendingLines(output)).toStrictEqual([
      'REVIEW PENDING (not blocking): 4 drafted texts in reports/i18n/; list them in the report.',
    ]);
    expect(reviewPendingLines('review-sheet: nothing pending\n')).toStrictEqual([]);
  });
});
