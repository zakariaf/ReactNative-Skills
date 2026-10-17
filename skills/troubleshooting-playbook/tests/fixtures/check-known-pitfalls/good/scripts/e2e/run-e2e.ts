// scripts/e2e/run-e2e.ts
export function maestroTestArgs(udid: string, port: number): string[] {
  return ['--device', udid, '--driver-host-port', String(port), 'test', '--include-tags', 'smoke', '.maestro/flows/tasks'];
}
