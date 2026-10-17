// scripts/ios/toolchain.ts
import { execFileSync } from 'node:child_process';

export function simctl(developerDir: string, udid: string, command: string): string {
  return execFileSync('xcrun', ['simctl', command, udid], { env: { ...process.env, DEVELOPER_DIR: developerDir }, encoding: 'utf8' });
}
