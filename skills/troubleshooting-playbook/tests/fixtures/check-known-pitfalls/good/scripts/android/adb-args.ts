// scripts/android/adb-args.ts
import { execFileSync } from 'node:child_process';

export function adbArgs(serial: string, ...command: string[]): string[] {
  return ['-s', serial, ...command];
}

export function installApk(serial: string, apk: string): void {
  execFileSync('adb', ['-s', serial, 'install', '-r', apk]);
  execFileSync('adb', adbArgs(serial, 'shell', 'am', 'start', '-n', 'com.acme.tasks/.MainActivity'));
}
