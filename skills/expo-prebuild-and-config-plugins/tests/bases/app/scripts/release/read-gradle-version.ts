// scripts/release/read-gradle-version.ts
// Reads the versionCode prebuild wrote into the generated Gradle file (read-only).
import { readFileSync } from 'node:fs';

export function readVersionCode(): number {
  const gradle = readFileSync('android/app/build.gradle', 'utf8');
  const match = /versionCode (\d+)/.exec(gradle);
  return match ? Number(match[1]) : 0;
}
