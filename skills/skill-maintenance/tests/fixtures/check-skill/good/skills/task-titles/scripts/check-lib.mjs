// check-lib.mjs: a stub of the shared helper (fixture). check-skill reads it for @deprecated exports and runs --help.
const HELP = 'Usage: node check-titles.mjs [repo-root]\n\nRules:\n  title-clock    a title helper reads the clock\n';

/** Runs main, or prints the help (with the rules the sample checker declares) for --help. */
export function run(main) {
  if (process.argv.includes('--help')) return void console.log(HELP);
  return main();
}
export const REPO_SCAN_IGNORES = [];
export function createReporter() {
  return { skip() {}, finish: () => 0 };
}
export function walkRepo() {
  return [];
}
export function walk() {
  return [];
}
export function notYetCreated() {
  return null;
}
