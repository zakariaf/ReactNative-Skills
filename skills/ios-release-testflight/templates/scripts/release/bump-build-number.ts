// scripts/release/bump-build-number.ts
// CLI: node scripts/release/bump-build-number.ts
// Raises the single `const IOS_BUILD_NUMBER = <int>;` line of the app's app.config.ts by one and
// prints the new number. release:ios calls the same function and commits; run this by hand only to
// recover, and never to lower a number.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bumpBuildNumber } from './build-number.ts';
import { readReleaseConfig } from './release-config.ts';

const file = join(readReleaseConfig('.').appDir, 'app.config.ts');
const bump = bumpBuildNumber(readFileSync(file, 'utf8'));
writeFileSync(file, bump.text);
console.log(`${file}: IOS_BUILD_NUMBER ${String(bump.previous)} -> ${String(bump.next)}`);
