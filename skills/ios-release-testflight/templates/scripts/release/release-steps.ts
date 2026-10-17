// scripts/release/release-steps.ts
// The side effects every release step shares: run one logged child process (its output in
// <app>/build/ios-release/logs/<step>.log), turn a failure into the playbook's message, git, and a
// blocking sleep. Nothing here retries: a stop goes to the developer.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyReleaseFailure, resumeHint, stopMessage } from './release-failures.ts';
import { RELEASE_BUILD_DIR } from './release-options.ts';

/** Where a step runs and with which environment (one env object for the whole run). */
export type ReleaseContext = {
  /** The app's folder ('.' for a single app). */
  readonly appDir: string;
  readonly env: NodeJS.ProcessEnv;
};

/** One child process: the file, its arguments, and whether it runs at the repo root. */
export type StepCommand = {
  readonly file: string;
  readonly args: readonly string[];
  readonly atRoot?: boolean;
};

function lastErrorLine(output: string): string {
  const lines = output.trimEnd().split('\n');
  return lines.findLast((line) => /error|fail|denied|ITMS-/i.test(line)) ?? lines.at(-1) ?? '';
}

/** The message a failed step ends the run with: a stop for the developer, or the agent's fix. */
export function failureMessage(step: string, output: string, logFile: string): string {
  const verdict = classifyReleaseFailure(output);
  const resume = resumeHint(step);
  if (verdict === null) {
    return `step "${step}" failed with an unknown error: ${lastErrorLine(output)}\nRead ${logFile} and diagnose; do not retry blindly.\n${resume}`;
  }
  const errorLine = verdict.line === '' ? lastErrorLine(output) : verdict.line;
  if (verdict.isStop) {
    return `${stopMessage(step, errorLine, verdict)}\n(log: ${logFile})\n${resume}`;
  }
  return `step "${step}" failed (${verdict.id}): ${errorLine}\nFix: ${verdict.action}\n(log: ${logFile})\n${resume}`;
}

/** Runs the command, logs it, and returns its stdout; throws a ready-to-send message on failure. */
export function runReleaseStep(
  name: string,
  command: StepCommand,
  context: ReleaseContext,
): string {
  const logDir = join(context.appDir, RELEASE_BUILD_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${name}.log`);
  console.log(`release:ios: ${name} ...`);
  const result = spawnSync(command.file, command.args, {
    cwd: command.atRoot === true ? '.' : context.appDir,
    env: context.env,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  writeFileSync(logFile, output);
  if (result.status === 0) {
    return result.stdout;
  }
  throw new Error(failureMessage(name, output, logFile));
}

export function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function gitLines(args: readonly string[]): string[] {
  return git(args)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Blocks the process (the release is a sequential CLI; nothing else runs meanwhile). */
export function sleepSeconds(seconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}
