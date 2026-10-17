// bootstrap-plan.mjs: turns this skill's templates and assets into the list of files a new Expo app
// needs, and decides what happens to each one in an existing folder (create, same, merge, conflict).
// Shared by scaffold-app.mjs (writes the files) and check-skeleton.mjs (reads the same facts).
// Not an entry point: helpers only, no side effects on import.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng, renderPng } from '../check-lib.mjs';
import { bundleIdProblem, placeholdersIn } from './ship-placeholders.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(HERE, '..', '..');
export const TEMPLATES = join(SKILL_DIR, 'templates');
export const ASSETS = join(SKILL_DIR, 'assets');

/** Prettier's printWidth in the canonical .prettierrc.json. */
export const PRINT_WIDTH = 100;

/** The placeholders of the templates, filled from the scaffold options. */
export const VARIABLES = Object.freeze(['__APP_ID__', '__APP_NAME__', '__APP_SLUG__', '__APP_SCHEME__']);

/**
 * Top-level names that belong to an Expo app (a superset of the app layout typescript-and-lint-rules'
 * check-configs reads: it adds the root files other skills write). Every other non-hidden entry found
 * before the bootstrap is pre-existing:
 * knowledge, design exports, notes. Prettier, ESLint and the root TypeScript program must ignore it.
 * A root file another skill's template writes belongs here (fingerprint.config.js: ota-updates), so
 * the tooling keeps linting and formatting it; docs/ stays pre-existing (references/project-layout.md).
 */
export const LAYOUT_ENTRIES = Object.freeze([
  'src', 'app', 'assets', 'test', '__mocks__', 'scripts', 'plugins', 'modules', 'contracts', 'design', 'skills',
  'node_modules', 'ios', 'android', 'build', 'dist', 'web-build', 'coverage', 'reports', 'dist-audit',
  'apps', 'packages', 'patches',
  'app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs', 'app.config.mts', 'app.config.cts',
  'app.config.json', 'app.json', 'eas.json', 'store.config.json', 'metro.config.js',
  'metro.config.cjs', 'babel.config.js', 'fingerprint.config.js', 'index.ts', 'index.tsx', 'index.js', 'react-native.config.js',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb',
  'tsconfig.json', 'tsconfig.base.json', 'tsconfig.stryker.json', 'eslint.config.mjs', 'knip.json', 'lefthook.yml',
  'lefthook-local.yml', 'quality-gates.json', 'rn-skills.config.json', 'jest.config.js', 'jest.setup.ts',
  'jest.sim.config.js', 'stryker.config.json', 'expo-env.d.ts', 'credentials.json', 'google-services.json',
  'GoogleService-Info.plist', 'eas-build-pre-install.sh',
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
]);

/**
 * The SDK 57 default template's demo images (expo-template-default 57.0.30, verified on 2026-10-14).
 * Its splash-icon.png and favicon.png are not listed: the skeleton's app.config.ts uses both.
 */
const TEMPLATE_DEMO_IMAGES = ['android-icon-background.png', 'android-icon-foreground.png', 'android-icon-monochrome.png', 'expo-badge-white.png', 'expo-badge.png', 'expo-logo.png', 'icon.png', 'logo-glow.png', 'react-logo.png', 'react-logo@2x.png', 'react-logo@3x.png', 'tabIcons/', 'tutorial-web.png'];

/**
 * Files and folders of Expo's default project template (create-expo-app, SDK 57) and of older
 * templates that the skeleton replaces. Left in place they ship demo screens, literal strings and a
 * second routes folder, and fail the gates. Paths are repo-relative; a folder ends with "/".
 */
export const LEFTOVERS = Object.freeze([
  { path: 'app.json', why: 'app.config.ts is the only app config; Expo reads app.config.ts and merges app.json into it, so a value there silently changes the config', fix: 'Move the values you still need into app.config.ts, then delete app.json.' },
  { path: 'scripts/reset-project.js', why: 'the template\'s reset script moves src/ to app-example/ and writes a new starter', fix: 'Delete it and the "reset-project" npm script.' },
  { path: 'app-example/', why: 'the demo the template\'s reset script set aside', fix: 'Delete the folder.' },
  { path: 'src/app/explore.tsx', why: 'the template\'s demo tab route', fix: 'Delete it; routes come from the app\'s features (scaffold-feature-screen).' },
  { path: 'src/components/', why: 'the template\'s demo components (themed text, tabs, collapsible); shared UI lives in src/ui/', fix: 'Delete the folder; build shared components in src/ui/ (ui-component-library).' },
  { path: 'src/constants/', why: 'the template\'s colour and font constants; tokens live in src/theme/', fix: 'Delete the folder; the theme comes from design-system-structure.' },
  { path: 'src/global.css', why: 'the template\'s web stylesheet for its demo', fix: 'Delete it (a web stylesheet the app needs belongs in src/theme/).' },
  { path: 'src/hooks/use-color-scheme.ts', why: 'the template\'s demo hook; the theme provider owns the colour scheme', fix: 'Delete it (and its .web.ts sibling).' },
  { path: 'src/hooks/use-color-scheme.web.ts', why: 'the template\'s demo hook', fix: 'Delete it.' },
  { path: 'src/hooks/use-theme.ts', why: 'the template\'s demo hook; the theme lives in src/theme/', fix: 'Delete it.' },
  { path: 'components/', why: 'an older template\'s demo components at the root, outside src/', fix: 'Delete the folder, or move code the app uses under src/.' },
  { path: 'constants/', why: 'an older template\'s constants at the root, outside src/', fix: 'Delete the folder, or move code the app uses under src/.' },
  { path: 'hooks/', why: 'an older template\'s hooks at the root, outside src/', fix: 'Delete the folder, or move code the app uses under src/hooks/.' },
  { path: 'assets/expo.icon/', why: 'the template\'s Icon Composer icon at the assets root; the skeleton\'s iOS store icon sits in assets/icons/production/ and app.config.ts never names this one', fix: 'Delete the folder (real art, Icon Composer included, comes from icons-app-icon-and-splash).' },
  ...TEMPLATE_DEMO_IMAGES.map((name) => ({
    path: `assets/images/${name}`,
    why: 'the template\'s demo art (its logos, tab icons and its own app icon); the skeleton\'s icons live in assets/icons/<variant>/ and nothing names this file',
    fix: 'Delete it; real art comes from icons-app-icon-and-splash (splash-icon.png and favicon.png stay: app.config.ts uses them).',
  })),
]);

/**
 * Root app/ next to src/app/: Expo Router (@expo/cli getRouterDirectory, SDK 57) uses src/app whenever
 * that folder exists and falls back to app/ only when it does not, so every route in app/ is dead code.
 */
export const SECOND_ROUTES_FOLDER = { path: 'app/', why: 'a second routes folder next to src/app/; Expo Router uses src/app whenever it exists, so every route in app/ is dead code', fix: 'Move the routes the app needs into src/app/ and delete app/.' };

/**
 * Second tool configs at the root (the same names as typescript-and-lint-rules' strayConfigs). They are
 * not pre-existing knowledge: each one is loaded by its tool, so ignoring it changes nothing. ESLint 9
 * searches eslint.config.js before eslint.config.mjs (npx expo lint writes one in an existing Expo app),
 * Prettier reads a .prettierrc* or prettier.config.* before .prettierrc.json, and knip takes the first
 * of its config names, so the canonical config quietly never runs.
 */
const STRAY_TOOL = (name) => (name.includes('eslint') ? 'eslint' : name.includes('knip') ? 'knip' : 'prettier');
const STRAY_REASON = {
  eslint: { why: 'a second ESLint config; ESLint 9 loads eslint.config.js (and .eslintrc*) before eslint.config.mjs, so the canonical config never runs', main: 'eslint.config.mjs', owner: 'typescript-and-lint-rules' },
  prettier: { why: 'a second Prettier config; Prettier reads it before .prettierrc.json, so the canonical options never apply', main: '.prettierrc.json', owner: 'typescript-and-lint-rules' },
  knip: { why: 'a second knip config; knip takes the first config it finds, so knip.json and its ignores are skipped', main: 'knip.json', owner: 'typescript-and-lint-rules' },
};
export const STRAY_CONFIGS = Object.freeze([
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintignore',
  'eslint.config.js', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
  '.prettierrc.json5', '.prettierrc.ts', '.prettierrc.mts', '.prettierrc.cts',
  'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs', 'prettier.config.ts', 'prettier.config.mts', 'prettier.config.cts',
  'knip.ts', 'knip.js', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.config.ts', 'knip.config.js',
].map((path) => {
  const reason = STRAY_REASON[STRAY_TOOL(path)];
  return { path, why: reason.why, fix: `Move any rule the team needs into ${reason.main} (${reason.owner}), then delete ${path}.` };
}));

const toPosix = (path) => path.split(sep).join('/');
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function listFiles(dir) {
  const out = [];
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === '.DS_Store') continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) out.push(toPosix(relative(dir, child)));
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

/** Template path -> repo path: a "dot-x" file name becomes ".x" and ".tmpl" is dropped. */
export function mapTemplatePath(rel) {
  const parts = rel.split('/');
  const last = parts.length - 1;
  parts[last] = parts[last].replace(/^dot-/, '.').replace(/\.tmpl$/, '');
  return parts.join('/');
}

/** rn-skills.config.json "layoutEntries": extra top-level names the app declares as its own. */
export function declaredLayoutEntries(root) {
  const file = join(root, 'rn-skills.config.json');
  if (!existsSync(file)) return [];
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8')).layoutEntries;
    return Array.isArray(entries) ? entries.map((entry) => String(entry).replace(/\/+$/, '')) : [];
  } catch {
    return [];
  }
}

/** True for a top-level name of the app layout (a name, or a *.d.ts file at the root). */
export function isLayoutEntry(name, extra = []) {
  return LAYOUT_ENTRIES.includes(name) || extra.includes(name) || /\.d\.ts$/.test(name);
}

/** Top-level entries that are not part of the app (hidden entries and fixture control files skipped). */
export function preExistingEntries(root) {
  if (!existsSync(root)) return [];
  const extra = declaredLayoutEntries(root);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !isLayoutEntry(entry.name, extra) && !STRAY_CONFIGS.some((item) => item.path === entry.name) && entry.name !== 'EXPECT.txt' && entry.name !== 'ARGS.txt')
    .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** True when a pre-existing entry is, or holds, a .ts/.tsx file the root TypeScript program would read. */
export function holdsTypeScript(root, entry) {
  if (!entry.isDir) return /\.tsx?$/.test(entry.name);
  return listFiles(join(root, entry.name)).some((file) => /\.tsx?$/.test(file));
}

/** Template leftovers present in the repo: [{ rel, why, fix }]. */
export function leftoversIn(root, { routesDir = 'src/app' } = {}) {
  const found = [];
  for (const item of [...LEFTOVERS, ...STRAY_CONFIGS]) {
    const abs = join(root, item.path.replace(/\/$/, ''));
    if (!existsSync(abs)) continue;
    if (item.path.endsWith('/') !== statSync(abs).isDirectory()) continue;
    found.push({ rel: item.path, why: item.why, fix: item.fix });
  }
  if (routesDir !== 'app' && existsSync(join(root, routesDir)) && existsSync(join(root, 'app')) && statSync(join(root, 'app')).isDirectory()) {
    found.push({ rel: SECOND_ROUTES_FOLDER.path, why: SECOND_ROUTES_FOLDER.why, fix: SECOND_ROUTES_FOLDER.fix });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SCHEME = /^[a-z][a-z0-9+.-]*$/;

/** The kebab-case slug of a display name ("My Tasks" -> "my-tasks"). */
export function slugOf(name) {
  return String(name).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** The variables from the options: appId and name given, slug and scheme derived when not. */
export function variablesFrom({ appId, name, slug, scheme }) {
  const appSlug = slug ?? slugOf(name ?? '');
  return { appId: appId ?? '', name: name ?? '', slug: appSlug, scheme: scheme ?? appSlug.replace(/-/g, '') };
}

/**
 * Kotlin hard keywords and Java reserved words. Prebuild writes the Android package into the package
 * line of MainActivity.kt and MainApplication.kt, so an id part such as "class" or "fun" compiles to a
 * syntax error at the first native build (`com.acme.class` is a valid iOS bundle id).
 */
export const JVM_RESERVED = Object.freeze([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null', 'object',
  'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
  'abstract', 'assert', 'boolean', 'byte', 'case', 'catch', 'char', 'const', 'default', 'double', 'enum', 'extends', 'final',
  'finally', 'float', 'goto', 'implements', 'import', 'instanceof', 'int', 'long', 'native', 'new', 'private', 'protected',
  'public', 'short', 'static', 'strictfp', 'switch', 'synchronized', 'throws', 'transient', 'void', 'volatile', '_',
]);

/** A problem text when a part of the id is a Kotlin or Java keyword, else null. */
export function reservedIdPartProblem(appId) {
  const bad = String(appId).split('.').filter((part) => JVM_RESERVED.includes(part));
  if (bad.length === 0) return null;
  return `id part ${bad.map((part) => `"${part}"`).join(', ')} is a Kotlin or Java keyword; prebuild writes the Android package into MainActivity.kt, which then fails to compile`;
}

/** Problems with the options (exit 2), and notes (a placeholder id the ship gates will refuse). */
export function validateVariables(vars) {
  const problems = [];
  const notes = [];
  for (const platform of ['ios', 'android']) {
    const problem = bundleIdProblem(vars.appId, { platform });
    if (problem && !placeholdersIn(vars.appId).some((entry) => entry.id === 'template-bundle-id')) problems.push(`--app-id: ${problem}`);
  }
  if (problems.length === 0 && placeholdersIn(vars.appId).length) notes.push(`--app-id ${vars.appId} is a placeholder: the ship gates refuse it; replace it in app.config.ts before the first store build`);
  const reserved = reservedIdPartProblem(vars.appId);
  if (reserved) problems.push(`--app-id ${vars.appId}: ${reserved}`);
  if (vars.appId !== vars.appId.toLowerCase()) problems.push(`--app-id "${vars.appId}" has capitals; use lower case (Android packages and most App Store ids are lower case, and the variants append .dev/.preview)`);
  // Quotes, $ and backticks are fine (tsStringLiteral escapes the name for app.config.ts); a backslash or
  // a line break has no faithful form in the markdown heading of AGENTS.md and no place in a store name.
  if (!vars.name.trim() || /[\\\u0000-\u001f\u007f]/.test(vars.name)) problems.push(`--name ${JSON.stringify(vars.name)} must be non-empty, on one line and without backslashes`);
  if (!SLUG.test(vars.slug)) problems.push(`slug "${vars.slug}" is not kebab-case (pass --slug, for example tasks)`);
  if (!SCHEME.test(vars.scheme)) problems.push(`scheme "${vars.scheme}" is not a URL scheme (a letter, then letters, digits, +, - or .)`);
  return { problems, notes };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const readJson = (abs) => JSON.parse(readFileSync(abs, 'utf8'));

/** assets/app-dependencies.json: the skeleton's runtime packages and the dev tools it leaves out. */
export function appDependencies() {
  return readJson(join(ASSETS, 'app-dependencies.json'));
}

/** The dependency policy the skeleton ships (templates/contracts/dependency-policy.json). */
export function dependencyPolicy() {
  return readJson(join(TEMPLATES, 'contracts', 'dependency-policy.json'));
}

/**
 * package.json: the canonical skeleton manifest (scripts, dev tools, overrides, approvals) with the
 * app's name, the runtime dependencies at the policy's specifiers, and without the dev tools no
 * skeleton file uses yet (knip fails on an unused dependency). Keys are sorted as npm writes them.
 */
export function renderPackageJson(vars) {
  const skeleton = readJson(join(ASSETS, 'skeleton-package.json'));
  const { dependencies: names, laterDevDependencies, allowScripts: reviewed = {} } = appDependencies();
  const policy = dependencyPolicy().packages ?? {};
  const dependencies = {};
  for (const name of [...names].sort()) {
    const row = policy[name];
    if (!row?.spec) throw new Error(`assets/app-dependencies.json lists ${name}, which templates/contracts/dependency-policy.json has no row for`);
    dependencies[name] = row.spec;
  }
  const devDependencies = Object.fromEntries(Object.entries(skeleton.devDependencies).filter(([name]) => !laterDevDependencies.includes(name)));
  const { scripts, devDependencies: _dev, overrides, allowScripts, ...head } = skeleton;
  const approvals = Object.fromEntries(Object.entries({ ...allowScripts, ...reviewed }).sort(([a], [b]) => (a < b ? -1 : 1)));
  const manifest = { ...head, name: vars.slug, scripts, dependencies, devDependencies, overrides, allowScripts: approvals };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * A TypeScript string literal for value, quoted the way Prettier prints it with singleQuote: single
 * quotes unless the value holds more single than double quotes, escaping only the enclosing quote and
 * backslashes ("Tom's Tasks" -> "Tom's Tasks" in double quotes, so format:check stays green).
 */
export function tsStringLiteral(value) {
  const singles = (value.match(/'/g) ?? []).length;
  const doubles = (value.match(/"/g) ?? []).length;
  const quote = singles > doubles ? '"' : "'";
  return `${quote}${value.replace(/\\/g, '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
}

/** Fill the placeholders of one template file; a quoted '__APP_NAME__' becomes a TS string literal. */
export function fillVariables(text, vars) {
  return text
    .replaceAll("'__APP_NAME__'", tsStringLiteral(vars.name))
    .replaceAll('__APP_ID__', vars.appId)
    .replaceAll('__APP_NAME__', vars.name)
    .replaceAll('__APP_SLUG__', vars.slug)
    .replaceAll('__APP_SCHEME__', vars.scheme);
}

/** The ESLint PRE_EXISTING list as Prettier prints it: one line when it fits, else one entry per line. */
export function preExistingList(globs) {
  const oneLine = `const PRE_EXISTING = [${globs.join(', ')}];`;
  return oneLine.length <= PRINT_WIDTH ? oneLine : `const PRE_EXISTING = [\n${globs.map((glob) => `  ${glob},\n`).join('')}];`;
}

/** Adds names to the multi-line "exclude" array of the root tsconfig.json, keeping Prettier's layout. */
export function addTsconfigExcludes(text, names) {
  if (names.length === 0) return text;
  const match = /("exclude": \[\n)((?:\s+"[^"\n]*",?\n)+)(\s*\])/.exec(text);
  if (!match) throw new Error('templates/tsconfig.json has no multi-line "exclude" array');
  const items = match[2].trimEnd().replace(/,$/, '');
  const indent = /^(\s+)/.exec(match[2])[1];
  const added = names.map((name) => `${indent}${JSON.stringify(name)}`).join(',\n');
  return text.replace(match[0], `${match[1]}${items},\n${added}\n${match[3]}`);
}

/** Renders one template for this repo: variables, and the pre-existing entries in the three ignore lists. */
export function renderTemplate(repoRel, text, vars, preExisting, root) {
  let out = fillVariables(text, vars);
  if (repoRel === '.prettierignore' && preExisting.length) {
    out = `${out.trimEnd()}\n${preExisting.map((entry) => (entry.isDir ? `${entry.name}/` : entry.name)).join('\n')}\n`;
  }
  if (repoRel === 'eslint.config.mjs') {
    out = out.replace('const PRE_EXISTING = [];', preExistingList(preExisting.map((entry) => `'${entry.isDir ? `${entry.name}/**` : entry.name}'`)));
  }
  if (repoRel === 'tsconfig.json') {
    out = addTsconfigExcludes(out, preExisting.filter((entry) => holdsTypeScript(root, entry)).map((entry) => entry.name));
  }
  return out;
}

const png = (width, height, spec) => encodePng(renderPng({ width, height, ...spec }));

/**
 * The placeholder art every variant needs before the first prebuild (app.config.ts names these
 * files; prebuild and EAS Build stop with ENOENT without them): a flat production icon, the same
 * icon with a coloured band for development (orange) and preview (blue) so a tester sees which build
 * is open, the Android adaptive layers, the splash image and the web favicon.
 * icons-app-icon-and-splash replaces them with the app's art at the same paths.
 */
export function artFiles() {
  const size = 1024;
  const mark = { x: 352, y: 352, width: 320, height: 320, fill: '#FFFFFF' };
  const bands = { production: [], development: [{ x: 0, y: 768, width: size, height: 256, fill: '#F28C28' }], preview: [{ x: 0, y: 768, width: size, height: 256, fill: '#2F6FED' }] };
  const files = [];
  for (const [variant, band] of Object.entries(bands)) {
    const folder = `assets/icons/${variant}`;
    files.push({ rel: `${folder}/icon.png`, content: png(size, size, { fill: '#1F2937', rects: [mark, ...band] }) });
    files.push({ rel: `${folder}/android-foreground.png`, content: png(size, size, { fill: [0, 0, 0, 0], rects: [mark, ...band] }) });
    files.push({ rel: `${folder}/android-background.png`, content: png(size, size, { fill: '#1F2937' }) });
    files.push({ rel: `${folder}/android-monochrome.png`, content: png(size, size, { fill: [0, 0, 0, 0], rects: [mark] }) });
  }
  files.push({ rel: 'assets/images/splash-icon.png', content: png(256, 256, { fill: [0, 0, 0, 0], rects: [{ x: 64, y: 64, width: 128, height: 128, fill: '#1F2937' }] }) });
  files.push({ rel: 'assets/images/favicon.png', content: png(48, 48, { fill: '#1F2937', rects: [{ x: 16, y: 16, width: 16, height: 16, fill: '#FFFFFF' }] }) });
  return files;
}

/** Every file the bootstrap writes: [{ rel, content }] (a string, or a Buffer for images). */
export function renderedFiles(root, vars) {
  const preExisting = preExistingEntries(root);
  const files = listFiles(TEMPLATES).map((rel) => {
    const repoRel = mapTemplatePath(rel);
    return { rel: repoRel, content: renderTemplate(repoRel, readFileSync(join(TEMPLATES, rel), 'utf8'), vars, preExisting, root) };
  });
  files.push({ rel: 'package.json', content: renderPackageJson(vars) });
  files.push({ rel: '.claude/settings.json', content: readFileSync(join(ASSETS, 'claude-settings.json'), 'utf8') });
  files.push(...artFiles());
  return files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** True when the file at abs holds exactly this content (string or Buffer). */
export function sameContent(abs, content) {
  const current = readFileSync(abs);
  return Buffer.isBuffer(content) ? current.equals(content) : current.equals(Buffer.from(content, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// Merges for files that may already exist
// ---------------------------------------------------------------------------------------------

/** .gitignore: keep the existing lines, append the missing ones. */
export function mergeGitignore(existing, wanted) {
  const have = new Set(existing.split('\n').map((line) => line.trim()));
  const missing = wanted.split('\n').filter((line) => line.trim() && !line.startsWith('#') && !have.has(line.trim()));
  if (missing.length === 0) return { content: existing, changed: false, conflicts: [] };
  const base = existing.endsWith('\n') || existing === '' ? existing : `${existing}\n`;
  return { content: `${base}${missing.join('\n')}\n`, changed: true, conflicts: [], notes: [`appends ${missing.length} line(s)`] };
}

/**
 * .claude/settings.json: keep every existing key (the skill listing budget, other allow rules, the
 * Expo plugin), add the template's plugins and allow rules, and set deny, ask and hooks to the gate
 * values. quality-gates' guardrail compares deny, ask and hooks exactly, so an existing different
 * value is a conflict the developer decides.
 */
export function mergeSettings(existingText, wantedText) {
  let existing;
  try {
    existing = JSON.parse(existingText);
  } catch (error) {
    return { content: existingText, changed: false, conflicts: [`is not valid JSON (${error.message})`] };
  }
  const wanted = JSON.parse(wantedText);
  const merged = { ...wanted, ...existing };
  const conflicts = [];
  merged.enabledPlugins = { ...(existing.enabledPlugins ?? {}), ...wanted.enabledPlugins };
  const permissions = { ...(existing.permissions ?? {}) };
  permissions.allow = [...new Set([...(permissions.allow ?? []), ...wanted.permissions.allow])];
  for (const key of ['deny', 'ask']) {
    const have = permissions[key];
    if (have !== undefined && !sameJson(have, wanted.permissions[key])) {
      const extra = have.filter((rule) => !wanted.permissions[key].includes(rule));
      if (extra.length) conflicts.push(`permissions.${key} has rules the gates do not list: ${extra.join(', ')}`);
    }
    permissions[key] = wanted.permissions[key];
  }
  merged.permissions = permissions;
  if (existing.hooks !== undefined && !sameJson(existing.hooks, wanted.hooks)) {
    conflicts.push('hooks differ from the gate hooks (PostToolUse after-edit.ts, Stop check:fast)');
  }
  merged.hooks = wanted.hooks;
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  return { content, changed: content !== existingText, conflicts, notes: ['merged'] };
}

/**
 * package.json: `npm approve-scripts` rewrites "allowScripts" after the first install. A manifest
 * that differs from the rendered one only there is unchanged; any other difference is a conflict.
 */
export function mergeRootManifest(existingText, wantedText) {
  try {
    const { allowScripts: _have, ...existing } = JSON.parse(existingText);
    const { allowScripts: _want, ...wanted } = JSON.parse(wantedText);
    const same = sameJson(existing, wanted);
    return { content: existingText, changed: false, conflicts: same ? [] : ['exists with different content (beyond the allowScripts approvals)'] };
  } catch (error) {
    return { content: existingText, changed: false, conflicts: [`is not valid JSON (${error.message})`] };
  }
}

/**
 * CLAUDE.md belongs to the developer and may carry project notes. The template's only demand is the
 * import line, so an existing file that has it is kept, and one without it gains it as line 1.
 */
export function mergeClaudeMd(existing, wanted) {
  const importLine = wanted.trim();
  if (existing.split('\n').some((line) => line.trim() === importLine)) return { content: existing, changed: false, conflicts: [], notes: [`kept: it already imports ${importLine}`] };
  return { content: `${importLine}\n\n${existing}`, changed: true, conflicts: [], notes: [`gains the ${importLine} import as its first line`] };
}

const MERGES = { '.gitignore': mergeGitignore, '.claude/settings.json': mergeSettings, 'package.json': mergeRootManifest, 'CLAUDE.md': mergeClaudeMd };

/** What would happen to each file: create, same, merge or conflict. */
export function buildPlan(root, vars) {
  return renderedFiles(root, vars).map(({ rel, content }) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return { rel, content, action: 'create', notes: [] };
    if (!statSync(abs).isFile()) return { rel, content, action: 'conflict', notes: ['exists and is not a file'] };
    if (sameContent(abs, content)) return { rel, content, action: 'same', notes: [] };
    // Placeholder art never replaces an image the app already has (its own art wins).
    if (Buffer.isBuffer(content)) return { rel, content, action: 'same', notes: ['kept: the app already has this image'] };
    const merge = MERGES[rel];
    if (!merge) return { rel, content, action: 'conflict', notes: ['exists with different content'] };
    const result = merge(readFileSync(abs, 'utf8'), content);
    // --replace writes the template's own content, never the half-merged file.
    if (result.conflicts.length) return { rel, content, action: 'conflict', notes: result.conflicts };
    return { rel, content: result.content, action: result.changed ? 'merge' : 'same', notes: result.notes ?? [] };
  });
}
