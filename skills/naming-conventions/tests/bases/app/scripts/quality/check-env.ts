// scripts/quality/check-env.ts: Node tooling may read any variable.
export function isCi(): boolean {
  return process.env.CI === 'true' || process.env['GITHUB_ACTIONS'] === 'true';
}
