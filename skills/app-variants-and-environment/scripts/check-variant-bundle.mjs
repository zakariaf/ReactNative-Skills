// check-variant-bundle.mjs: proves what an exported JS bundle contains for its variant.
// A production bundle holds no test-only sentinel and no secret; a development or preview bundle
// holds every sentinel (otherwise the proof proves nothing). Reads `npx expo export` output (plain JS
// or Hermes bytecode, which keeps string literals) or an embedded main.jsbundle/index.android.bundle.
// Zero dependencies. It prints variable names, never secret values.
import { readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';

import { createReporter, lineOf, notYetCreated, parseArgs, readProjectConfig, requireDir, resolveLayout, run, toPosix, UsageError, walk } from './check-lib.mjs';
import { appCode, findSecretValues, isFile, isSecretName, parseDotenv, PUBLIC_PREFIX, VARIANTS } from './lib/env-scan.mjs';

const SPEC = {
  name: 'check-variant-bundle',
  summary: 'Checks an exported JS bundle against its variant: a production bundle contains no test-only sentinel and no secret value; a development or preview bundle contains every sentinel.',
  usage: '[repo-root] --bundle <dir|file> --variant <development|preview|production> [options]',
  options: {
    bundle: { type: 'string', value: 'path', help: 'The export folder (npx expo export --output-dir) or one bundle file, relative to the repo root' },
    variant: { type: 'string', value: 'name', help: 'The variant the bundle was built as: development, preview or production' },
    sentinel: { type: 'string', multiple: true, value: 'text', help: 'A string only test-only code contains (default: every exported *SENTINEL* string constant in the app code, plus rn-skills.config.json testOnlySentinels)' },
    'env-file': { type: 'string', multiple: true, value: 'file', help: 'A dotenv file whose secret-named values must not appear in the bundle (for example what eas env:pull writes)' },
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  bundle-sentinel  production: no sentinel anywhere; development and preview: every sentinel present;',
    '                   a test-only gate in the app code (a test-only.ts file, or a require() behind the literal',
    '                   variant comparison) with no sentinel known is a problem (the proof would prove nothing).',
    '                   SKIP when the app has no test-only gate yet (debug-menu-and-test-hooks creates',
    '                   src/test-only.ts); bundle-secret still runs',
    'App code: srcDir, a routes folder outside it (a root app/), the app entry and every local file they import.',
    '  bundle-secret    no secret-looking value (private key, OpenAI/Anthropic/Stripe keys, token formats) and no value',
    '                   of a secret-named variable from --env-file appears in the bundle',
    'rn-skills.config.json key read: "testOnlySentinels": ["TASKS_TEST_BUILD_ONLY"].',
    'Make the two bundles back to back without --clear, so a stale Metro cache would show:',
    '  APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo export --platform ios --output-dir dist/variant-proof/development',
    '  APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --output-dir dist/variant-proof/production',
    'dist/ is already ignored by git, Prettier and the repo scans; delete dist/variant-proof/ after the proof.',
  ].join('\n'),
};

const BUNDLE_FILES = ['*.js', '*.hbc', '*.jsbundle', '*.bundle'];
const GATE_LITERAL = /process\.env\.EXPO_PUBLIC_APP_VARIANT\s*[!=]==?\s*(['"])(?:development|preview|production)\1|(['"])(?:development|preview|production)\2\s*[!=]==?\s*process\.env\.EXPO_PUBLIC_APP_VARIANT/;
const SENTINEL_CONST = /\bexport\s+const\s+([A-Z0-9_]*SENTINEL[A-Z0-9_]*)\s*(?::\s*[\w.<>|[\] ]+)?=\s*(['"])([^'"\n]{6,})\2/g;
const MIN_SECRET_LENGTH = 8;

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(resolve(positionals[0] ?? '.'), 'repo root');
  if (!options.variant || !VARIANTS.includes(options.variant)) {
    throw new UsageError(`--variant must be one of ${VARIANTS.join('|')}${options.variant ? `, got "${options.variant}"` : ''}`, 'Pass the variant the bundle was built as: --variant production.');
  }
  if (!options.bundle) throw new UsageError('nothing to check: no --bundle given', 'Pass the export folder: --bundle dist/variant-proof/production (npx expo export --output-dir dist/variant-proof/production).');
  const bundlePath = resolve(root, options.bundle);
  const bundles = bundleFiles(bundlePath, root);
  const report = createReporter({ name: 'check-variant-bundle', json: options.json });
  const layout = resolveLayout(root);
  const sources = appSources(root, layout);
  const sentinels = sentinelsFor(root, sources, options.sentinel);
  // Hermes bytecode keeps string literals as plain bytes, so latin1 text finds them in .hbc files too.
  const contents = bundles.map((rel) => {
    const buffer = readFileSync(join(root, rel));
    return { rel, text: buffer.toString('latin1'), binary: buffer.includes(0) };
  });

  if (sentinels.length > 0) checkSentinels({ report, contents, sentinels, variant: options.variant, bundleRel: toPosix(relative(root, bundlePath)) });
  else noSentinel({ report, root, layout, sources });
  checkSecrets({ report, root, contents, envFiles: options['env-file'] });
  return report.finish({ checked: bundles.length, unit: 'bundle files' });
});

/** Repo-relative bundle files under a folder (source maps left out), or the one file given. */
function bundleFiles(path, root) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new UsageError(`nothing to check: ${toPosix(relative(process.cwd(), path))} does not exist`, 'Export the bundle first (npx expo export --output-dir <dir>) and pass that folder.');
  }
  if (stat.isFile()) return [toPosix(relative(root, path))];
  const files = walk(path, { include: BUNDLE_FILES }).filter((rel) => !rel.endsWith('.map'));
  if (files.length === 0) throw new UsageError(`nothing to check: no bundle (${BUNDLE_FILES.join(', ')}) under ${toPosix(relative(process.cwd(), path))}`, 'Pass the folder npx expo export wrote (it holds _expo/static/js/<platform>/).');
  return files.map((rel) => toPosix(relative(root, join(path, rel))));
}

/** --sentinel values, else rn-skills.config.json testOnlySentinels plus *SENTINEL* constants in app code. */
function sentinelsFor(root, sources, given) {
  if (given.length > 0) return [...new Set(given)];
  const found = new Set();
  const configured = readProjectConfig(root).testOnlySentinels;
  if (Array.isArray(configured)) configured.filter((value) => typeof value === 'string' && value !== '').forEach((value) => found.add(value));
  for (const rel of sources) {
    for (const match of readFileSync(join(root, rel), 'utf8').matchAll(SENTINEL_CONST)) found.add(match[3]);
  }
  return [...found].sort();
}

/**
 * App code, the same set check-env scans (tests and declarations left out): srcDir, a routes folder
 * outside it (a root app/), the app entry and every local file they import.
 */
function appSources(root, layout) {
  return appCode(root, layout).code;
}

/**
 * No sentinel is known. With a test-only gate in the app (the gate file, or any require() behind the
 * literal variant comparison) that is a problem: a clean production bundle would prove nothing. Without
 * one there is no test-only code to strip yet: SKIP until debug-menu-and-test-hooks creates the gate.
 */
function noSentinel({ report, root, layout, sources }) {
  const gateFile = posix.join(layout.srcDir, 'test-only.ts');
  const named = sources.find((rel) => /(?:^|\/)test-only\.[cm]?[jt]sx?$/.test(rel));
  let gate = isFile(join(root, gateFile)) ? { rel: gateFile, line: 1 } : named ? { rel: named, line: 1 } : null;
  for (const rel of gate ? [] : sources) {
    const text = readFileSync(join(root, rel), 'utf8');
    const match = GATE_LITERAL.exec(text);
    if (match && /\brequire\s*\(/.test(text)) {
      gate = { rel, line: lineOf(text, match.index) };
      break;
    }
  }
  if (gate === null) {
    report.skip({ file: gateFile, rule: 'bundle-sentinel', message: notYetCreated(root, { file: gateFile, owner: 'debug-menu-and-test-hooks' }) ?? 'not yet created (debug-menu-and-test-hooks creates it)' });
    return;
  }
  report.problem({ file: gate.rel, line: gate.line, rule: 'bundle-sentinel', message: `${gate.rel} gates test-only code, but no test-only sentinel is known: the bundle proof cannot tell whether that code shipped`, fix: "Export one from the test-only entry (export const TEST_BUILD_SENTINEL = 'TASKS_TEST_BUILD_ONLY'; debug-menu-and-test-hooks), list it in rn-skills.config.json testOnlySentinels, or pass --sentinel <text>." });
}

function checkSentinels({ report, contents, sentinels, variant, bundleRel }) {
  for (const sentinel of sentinels) {
    const holders = contents.filter(({ text }) => text.includes(sentinel));
    if (variant === 'production') {
      for (const { rel, text, binary } of holders) {
        report.problem({ file: rel, line: binary ? 0 : lineIn(text, text.indexOf(sentinel)), rule: 'bundle-sentinel', message: `the production bundle contains the test-only sentinel "${sentinel}": test-only code shipped`, fix: "Gate it with process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require(...) in one expression, key Metro's cacheVersion on the EXPO_PUBLIC_* values, then export again." });
      }
    } else if (holders.length === 0) {
      report.problem({ file: bundleRel, line: 0, rule: 'bundle-sentinel', message: `the ${variant} bundle lacks the test-only sentinel "${sentinel}": the gate strips test code from a testing build, or the sentinel is not reachable`, fix: 'Check that the gate keeps test-only code for development and preview (it compares with production only) and that the entry exporting the sentinel is required by it.' });
    }
  }
}

function checkSecrets({ report, root, contents, envFiles }) {
  for (const { rel, text, binary } of contents) {
    for (const { entry, index } of findSecretValues(text, { binary })) {
      report.problem({ file: rel, line: binary ? 0 : lineIn(text, index), rule: 'bundle-secret', message: `the bundle contains ${entry.what}`, fix: 'Find where it enters (an EXPO_PUBLIC_ variable, a committed file, the app config), remove it, export again, and rotate the secret: anything in a bundle is public.' });
    }
  }
  for (const file of envFiles) {
    const path = resolve(root, file);
    if (!isFile(path)) throw new UsageError(`--env-file ${file} does not exist`, 'Pass an existing dotenv file (eas env:pull --environment production writes .env.local).');
    for (const { name, value } of parseDotenv(readFileSync(path, 'utf8'))) {
      if (name.startsWith(PUBLIC_PREFIX) || !isSecretName(name) || value.length < MIN_SECRET_LENGTH) continue;
      for (const { rel, text, binary } of contents) {
        const index = text.indexOf(value);
        if (index >= 0) report.problem({ file: rel, line: binary ? 0 : lineIn(text, index), rule: 'bundle-secret', message: `the bundle contains the value of ${name} (from ${toPosix(file)})`, fix: `Stop passing ${name} into app code or the app config; rotate it, because this bundle exposed it.` });
      }
    }
  }
}

function lineIn(text, index) {
  if (index < 0) return 0;
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}
