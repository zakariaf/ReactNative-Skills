// Loads Playwright (pinned in scripts/package.json) at run time, so --help and argument errors work
// before any install. Only shoot-design.mjs renders the mockup in a browser; every other script is
// zero-dependency. The package lives in a tooling folder: --tooling <dir>, else
// $DESIGN_VISUAL_PARITY_TOOLING_DIR, else this skill's own scripts/ folder. A session whose skill folder
// must stay read-only (or is shared) installs it into the app repo instead:
//   mkdir -p .skill-tooling/design-visual-parity
//   cp <skill>/scripts/package.json <skill>/scripts/package-lock.json .skill-tooling/design-visual-parity/
//   npm ci --prefix .skill-tooling/design-visual-parity
// and passes --tooling .skill-tooling/design-visual-parity. No browser download: the installed Google
// Chrome renders (channel "chrome").
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, importPackage, packageInstallFix, resolveToolingDir, toolingEnvVar } from '../check-lib.mjs';

export const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const SKILL = 'design-visual-parity';
export const TOOLING_ENV = toolingEnvVar(SKILL);
export const PLAYWRIGHT_VERSION = '1.63.0';

/** The --tooling option of a script that loads Playwright. */
export const TOOLING_OPTION = Object.freeze({
  type: 'string',
  value: 'dir',
  help: `Folder whose node_modules holds playwright ${PLAYWRIGHT_VERSION} (default: $${TOOLING_ENV}, else the skill's scripts folder)`,
});

export function toolingDirOf(options = {}) {
  return resolveToolingDir({ given: options.tooling, envVar: TOOLING_ENV, skill: SKILL, scriptsDir: SCRIPTS_DIR });
}

export function installFix() {
  return packageInstallFix({ scriptsDir: SCRIPTS_DIR, envVar: TOOLING_ENV, skill: SKILL });
}

/** True when the tooling folder holds Playwright (the self-test uses it to decide what it can run). */
export function hasPlaywright(tooling) {
  return existsSync(join(tooling, 'node_modules', 'playwright', 'package.json'));
}

export async function loadPlaywright(tooling) {
  const mod = await importPackage('playwright', tooling, { what: `playwright ${PLAYWRIGHT_VERSION}`, fix: `${installFix()} No browser download: the scripts use the installed Google Chrome.` });
  const pw = mod.chromium ? mod : mod.default;
  if (!pw?.chromium) fail(`playwright in ${tooling} has no chromium export`, installFix());
  return pw;
}

/** The installed playwright version (for the reference manifest), or 'unknown'. */
export function playwrightVersion(tooling) {
  try {
    return JSON.parse(readFileSync(join(tooling, 'node_modules', 'playwright', 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

// --disable-gpu: software rasterisation. With GPU rasterisation two renders of the same frame
// differed in 2 to 2,451 edge pixels (up to 57/255) from one Chrome process to the next; in software
// mode repeated renders were identical, and the probe app's verdicts did not change.
export const CHROME_ARGS = Object.freeze(['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-gpu']);

/** Launch the installed Google Chrome with the flags that make renders deterministic. */
export async function launchChrome(pw) {
  try {
    return await pw.chromium.launch({ channel: 'chrome', headless: true, args: [...CHROME_ARGS] });
  } catch (error) {
    return fail(
      `Google Chrome could not be launched through Playwright (${String(error.message).split('\n')[0]})`,
      'Install Google Chrome (references are rendered with the "chrome" channel); never swap in another browser, it rasterises text differently.',
    );
  }
}
