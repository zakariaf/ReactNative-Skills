// sim-app-sentinels.mjs: the test-code rule of check-sim-app (a helper, not an entry point).
// A test-only entry exports one string that exists nowhere else (export const TEST_BUILD_SENTINEL =
// 'TASKS_TEST_BUILD_ONLY'; debug-menu-and-test-hooks owns the entry). Hermes bytecode keeps string
// literals as plain bytes, so the string is found in the embedded main.jsbundle: in every
// development and preview build, and in no production build. Sentinels are found the way
// app-variants-and-environment's bundle check finds them: --sentinel, else rn-skills.config.json
// testOnlySentinels plus every exported *SENTINEL* string constant in the app source.
//
//   checkTestCode(ctx)   ctx: { root, app, where, options, layout, report, projectConfig }
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { lineOf, notYetCreated, walkRepo } from '../check-lib.mjs';

const SOURCE = /\.[cm]?[jt]sx?$/;
const NOT_APP_CODE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)__tests__\/|\.d\.ts$/;
const SENTINEL_CONST = /\bexport\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\2/g;
const GATE_LITERAL = /process\.env\.EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview|production)\1/;
const GATE_OWNER = 'debug-menu-and-test-hooks';

function appSources(root, layout) {
  return walkRepo(root, { include: [`${layout.srcDir}/**`] }).filter((rel) => SOURCE.test(rel) && !NOT_APP_CODE.test(rel));
}

function sentinelsOf(ctx, sources) {
  if (ctx.options.sentinel.length > 0) return [...new Set(ctx.options.sentinel)];
  const found = new Set();
  const configured = ctx.projectConfig.testOnlySentinels;
  if (Array.isArray(configured)) configured.filter((value) => typeof value === 'string' && value !== '').forEach((value) => found.add(value));
  for (const rel of sources) {
    for (const match of readFileSync(join(ctx.root, rel), 'utf8').matchAll(SENTINEL_CONST)) found.add(match[3]);
  }
  return [...found].sort();
}

/** The test-only gate: a test-only.ts file, or a require() behind the literal variant comparison. */
function findGate(ctx, sources) {
  const named = sources.find((rel) => /(?:^|\/)test-only\.[cm]?[jt]sx?$/.test(rel));
  if (named) return { rel: named, line: 1 };
  for (const rel of sources) {
    const text = readFileSync(join(ctx.root, rel), 'utf8');
    const match = GATE_LITERAL.exec(text);
    if (match && /\brequire\s*\(/.test(text)) return { rel, line: lineOf(text, match.index) };
  }
  return null;
}

function countIn(text, sentinel) {
  return text.split(sentinel).length - 1;
}

/** test-code: main.jsbundle embedded, every sentinel present (testing builds) or absent (production). */
export function checkTestCode(ctx) {
  const file = `${ctx.where}/main.jsbundle`;
  const bundlePath = join(ctx.app, 'main.jsbundle');
  if (!existsSync(bundlePath)) {
    ctx.report.problem({ file, rule: 'test-code', message: 'main.jsbundle is missing, so no JS was embedded (a Release build embeds it)', fix: 'Build with -configuration Release; a Debug build loads its JS from Metro, which is not what users run.' });
    return;
  }
  const sources = appSources(ctx.root, ctx.layout);
  const sentinels = sentinelsOf(ctx, sources);
  if (sentinels.length === 0) {
    const gate = findGate(ctx, sources);
    const gateFile = posix.join(ctx.layout.srcDir, 'test-only.ts');
    if (gate === null) {
      ctx.report.skip({ file: gateFile, rule: 'test-code', message: notYetCreated(ctx.root, { file: gateFile, owner: GATE_OWNER }) ?? `not yet created (${GATE_OWNER} creates it)` });
      return;
    }
    ctx.report.problem({ file: gate.rel, line: gate.line, rule: 'test-code', message: `${gate.rel} gates test-only code, but no test-only sentinel is known: the build cannot prove whether that code shipped`, fix: "Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'), list it in rn-skills.config.json testOnlySentinels, or pass --sentinel <text>." });
    return;
  }
  const text = readFileSync(bundlePath).toString('latin1');
  for (const sentinel of sentinels) {
    const count = countIn(text, sentinel);
    if (ctx.options.variant === 'production' && count > 0) ctx.report.problem({ file, rule: 'test-code', message: `the production build contains the test-only sentinel "${sentinel}" ${count} time(s): the debug menu and test hooks shipped`, fix: "Key Metro's cacheVersion on the EXPO_PUBLIC_* values, gate test-only code with the literal process.env.EXPO_PUBLIC_APP_VARIANT === 'production' comparison at its require(), export the variant once for the whole run, then rebuild." });
    if (ctx.options.variant !== 'production' && count === 0) ctx.report.problem({ file, rule: 'test-code', message: `the ${ctx.options.variant} build lacks the test-only sentinel "${sentinel}": it was bundled as production, or the entry is not reachable`, fix: `Export APP_VARIANT=${ctx.options.variant} and EXPO_PUBLIC_APP_VARIANT=${ctx.options.variant} for the whole run (variantEnv) and rebuild; a stale Metro cache or a lost variable causes this.` });
  }
}
