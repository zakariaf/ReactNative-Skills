#!/usr/bin/env node
// check-file-names.mjs: checks the names of files, folders, routes, packages and app ids in an Expo
// app repo: kebab-case, the Expo Router grammar, no grab-bag or barrel files, the path header, a main
// export named after its file, route component names, test/fake/flow/catalog/plugin/fixture file
// patterns, workspace package names, iOS bundle id and Android package, store product ids, npm script
// names and the canonical names the repo declares in contracts/naming.json.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-file-names.mjs [repo-root]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, run, walkRepo } from './check-lib.mjs';
import { jsonKeyLine, looksReverseDns, readAppConfig } from './lib/app-config-ids.mjs';
import { APP_ID, KEBAB, LOCALE_TAG, NPM_SCRIPT, PRODUCT_ID, RULES, camelFromKebab, kebabFromPascal, pascalFromKebab, routeNameProblem, stem } from './lib/names.mjs';
import { missingContractNote, namingContext, prefixed, under } from './lib/naming-scope.mjs';
import { scanSource } from './lib/source-scan.mjs';
import { workspacePackages } from './lib/workspaces.mjs';

const SPEC = {
  name: 'check-file-names',
  summary:
    'Checks file, folder and route names, the path header on line 1, that a file\'s main export is named after it, one hook per use-x.ts, ' +
    'route component names, the test/fake/flow/catalog/plugin/fixture file patterns, workspace package names, the ' +
    'iOS bundle id and Android package, store product ids, npm script names and the declared canonical names.',
  usage: '[repo-root] [options]',
  options: {
    contract: { type: 'string', value: 'file', help: 'The naming contract (default: contracts/naming.json, or rn-skills.config.json "namingContract")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  file-kebab         a file name part outside the routes folder is not kebab-case (task-row.tsx, tasks-db-v1.full.json);',
    '                     catalogs and Maestro flows have their own rules (catalog-file, flow-file)',
    '  folder-kebab       a folder name outside the routes folder is not kebab-case (task-details/; __tests__/ is test-file)',
    '  route-segment      a file or folder in src/app breaks the Expo Router grammar: kebab-case segments, (group),',
    '                     [camelCaseParam], [...rest], _layout, index, +not-found, <name>+api',
    '  route-export-name  a route .tsx file does not default-export a named function <Name>Route (<Name>Layout in _layout.tsx)',
    '  grab-bag-file      utils.ts, helpers.ts, common.ts, shared.ts, misc.ts or stuff.ts',
    '  grab-bag-folder    a folder in src/ named utils/, helpers/, common/, shared/, misc/ or stuff/',
    '  barrel-index       an index.ts(x) outside the routes folder (a barrel), unless contracts/naming.json allows it',
    '  path-header        line 1 of a .ts/.tsx/.js/.mjs/.cjs file is not "// <repo-relative path>" (a note may follow',
    '                     ": " or " "; after a #! line, line 2); expo-env.d.ts (Expo writes it) is exempt',
    '  export-name        the main export is not named after the file (use-x.ts -> useX, x-screen.tsx -> XScreen, x-root-kit.tsx -> createXKit, a',
    '                     src/ui or src/features .tsx -> PascalCase (or a camelCase JSX helper), <vendor>-<concern>-adapter.ts',
    '                     and <vendor>-sql-driver.ts -> create..., fake-x.ts -> createFakeX, x-port.ts -> type XPort,',
    '                     x-context.ts(x) -> XProvider, XContext or useX,',
    '                     src/stores/x-store.ts -> useXStore, x-reducer.ts -> xReducer, plugins/with-x.ts -> withX)',
    '  one-hook-per-file  a use-x.ts(x) exports a second hook that is never called in the file: one hook per file; a',
    '                     second exported hook is only a building block useX calls (useFontScale beside useTextStyle)',
    '  port-file          a type ending in Port is declared outside its <concern>-port.ts file',
    '  test-file          .spec files, __tests__ folders, or a test suffix other than .test/.golden.test/.sim.test/.perf.test',
    '                     or the platform ones .android.test (the Jest project android) and .ios.test',
    '  fake-file          a mock or fake of our own named *.mock.ts, mock-*.ts or *-mock.ts (use fake-<concern>.ts); a',
    '                     test file is named after its subject (test/skia-mock.test.tsx is fine)',
    '  flow-file          a YAML file in the e2e folder outside flows/<area>/<nn>-<name>.yaml, subflows/<name>.yaml and',
    '                     config.yaml: a flow loose at the top, in an area folder directly under <e2e>/ (.maestro/smoke/),',
    '                     nested deeper than one area folder, or not kebab-case; a folder listed in contracts/naming.json',
    '                     "extraE2eFolders" (flows CI does not run) holds kebab-case YAML directly inside it',
    '  catalog-file       a message catalog not named <locale>.json (a BCP 47 tag, or one of contracts/naming.json "locales")',
    '  plugin-file        a local config plugin not named with-<capability>.ts',
    '  fixture-file       a frozen data fixture in a fixtures/ folder of src/data not named <name>-v<N>[.<case>].json',
    '  level-file         (games plugin) a level table in src/games/<game-id>/levels/ not named pack-<n>.json',
    '  package-name       (multi-package) a workspace package is not @<scope>/<folder>, or the scopes differ',
    '  app-id             the iOS bundle id or Android package is not lowercase reverse-DNS valid on both platforms, uses a',
    '                     Java keyword segment, differs between the platforms, or the slug is not kebab-case (multi-package,',
    '                     with contracts/naming.json "slugMatchesAppFolder": true: the slug differs from the app folder);',
    '                     ids and slugs listed in "publishedAppIds" / "publishedSlugs" are live and accepted as they are.',
    '                     Reads literal ids, follows bundleIdentifier: identity.appId / package: id back to a literal,',
    '                     reads every literal of Expo\'s variant shapes (both ternary branches, a ?? or || fallback, the',
    '                     static start of a template literal, the returns of a same-file getUniqueIdentifier()), and',
    '                     reads id consts (BASE_ID, APP_ID) and appId properties; vendor ids (AdMob ca-app-pub-...~...,',
    '                     Firebase 1:...:ios:..., FACEBOOK_APP_ID) are never taken for the app id',
    '  product-id         a store product id in contracts/naming.json is not <app id>.<name> (or <last app-id segment>.<name>',
    '                     when the full form would pass 40 characters), valid on the App Store and Google Play, at most',
    '                     40 characters (a "publishedProductIds" entry is accepted as it is)',
    '  npm-script-name    a root npm script is not <verb> or <area>:<verb> in kebab-case words',
    '  canonical-name     a canonical type, npm script or env variable declared in contracts/naming.json no longer exists',
    '',
    'Scans src/, test/, scripts/, plugins/, __mocks__/, .maestro/, contracts/ and root .ts files (folders from',
    'rn-skills.config.json and tsconfig paths; every workspace in a multi-package repo). Installed skills (any',
    'folder holding a SKILL.md, .agents/, .claude/, skills/) are never scanned.',
    'Example: node check-file-names.mjs .            (from the app repo root)',
  ].join('\n'),
};

const NAMED_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|ya?ml)$/;
const SOURCE = /\.tsx?$/;
/** JavaScript the repo writes (config files, scripts): only the path header applies to it. */
const JS_SOURCE = /\.[cm]?js$/;

function inSkipFolder(rel, ctx) {
  const parts = rel.split('/');
  if (parts.some((part) => RULES.skipFolders.includes(part))) return true;
  const mocks = ctx.appOf(rel).layout.mocksDir;
  return rel.startsWith(`${mocks}/`) || rel.startsWith(`${ctx.layout.mocksDir}/`);
}

function catalogDirOf(rel, ctx) {
  const i18n = ctx.roleOf(rel, 'i18nDir');
  return i18n !== null && rel.startsWith(`${i18n}/catalogs/`) ? `${i18n}/catalogs` : null;
}

function checkNames(files, ctx, report) {
  const folders = new Set();
  for (const rel of files) {
    if (!ctx.isOwned(rel) || inSkipFolder(rel, ctx)) continue;
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i += 1) folders.add(parts.slice(0, i).join('/'));
    const name = parts.at(-1);
    if (name.startsWith('.') || !NAMED_EXTENSIONS.test(name) || RULES.toolOwnedFiles.includes(name)) continue;
    const routes = ctx.roleOf(rel, 'routesDir');
    if (routes !== null) {
      const why = routeNameProblem(name, { isFolder: false });
      if (why) report.problem({ file: rel, rule: 'route-segment', message: `route file "${name}": ${why}`, fix: 'Route files are kebab-case URL segments, [camelCaseParam], [...rest], (group) folders, _layout, index or +not-found (task-details.tsx, [taskId].tsx).' });
      continue;
    }
    if (catalogDirOf(rel, ctx) !== null || isFlowFileTarget(rel, ctx)) continue;
    const bad = name.split('.').find((piece) => !KEBAB.test(piece));
    if (bad !== undefined) {
      report.problem({ file: rel, rule: 'file-kebab', message: `file name "${name}" is not kebab-case ("${bad}")`, fix: 'Rename to lowercase words joined by hyphens, e.g. task-row.tsx, use-tasks-model.ts.' });
    }
  }
  for (const folder of [...folders].sort()) {
    if (!ctx.isOwned(`${folder}/x`) || ctx.ownedRoots.includes(folder)) continue;
    const name = folder.split('/').at(-1);
    const routes = ctx.roleOf(`${folder}/x`, 'routesDir');
    if (routes !== null && folder !== routes && folder.startsWith(`${routes}/`)) {
      const why = routeNameProblem(name, { isFolder: true });
      if (why) report.problem({ file: `${folder}/`, rule: 'route-segment', message: `route folder "${name}": ${why}`, fix: 'Route folders are kebab-case URL segments, (group) folders or [camelCaseParam] folders.' });
      continue;
    }
    // __tests__/ is test-file's finding (move the tests next to their units), not a rename.
    if (!KEBAB.test(name) && name !== '__tests__') report.problem({ file: `${folder}/`, rule: 'folder-kebab', message: `folder name "${name}" is not kebab-case`, fix: 'Rename to lowercase words joined by hyphens, e.g. task-details/, error-log/.' });
    if (ctx.isAppCode(`${folder}/x`) && RULES.grabBagNames.includes(name)) {
      report.problem({ file: `${folder}/`, rule: 'grab-bag-folder', message: `"${name}/" is a grab-bag folder`, fix: 'Move each file next to the feature or layer that uses it (src/features/<feature>/, src/core/, src/ui/); a grab-bag folder grows without limit.' });
    }
  }
}

function checkFilePatterns(rel, ctx, report) {
  const name = rel.split('/').at(-1);
  const base = stem(name);
  const isTs = SOURCE.test(name);
  const app = ctx.appOf(rel);
  const isRoute = ctx.roleOf(rel, 'routesDir') !== null;
  if (isTs && RULES.grabBagNames.includes(base)) {
    report.problem({ file: rel, rule: 'grab-bag-file', message: `"${name}" is a grab-bag module`, fix: 'Name the file after what it does (format-due-date.ts, sort-tasks.ts); grab-bags grow without limit.' });
  }
  const isEntry = /^index\.[cm]?[jt]sx?$/.test(app.isRoot ? rel : rel.slice(app.dir.length + 1));
  if (/^index\.tsx?$/.test(name) && !isRoute && !isEntry && !ctx.contract.allowedIndexFiles.includes(rel)) {
    report.problem({ file: rel, rule: 'barrel-index', message: 'barrel index file', fix: 'Delete it and import the file that defines the symbol; only route files (src/app/**/index.tsx) and files listed in contracts/naming.json "allowedIndexFiles" are named index.' });
  }
  if (/\.spec\.[cm]?[jt]sx?$/.test(name) || rel.split('/').includes('__tests__')) {
    report.problem({ file: rel, rule: 'test-file', message: 'spec file or __tests__ folder', fix: 'Colocate the test as <unit>.test.ts(x) next to the unit (Node-API tests go in the root test/ folder).' });
  } else if (isTs && name.includes('.test.')) {
    const suffix = name.slice(base.length + 1).replace(/\.tsx?$/, '');
    if (!RULES.testSuffixes.includes(suffix)) report.problem({ file: rel, rule: 'test-file', message: `test suffix ".${suffix}"`, fix: `Use one of ${RULES.testSuffixes.map((item) => `<unit>.${item}.ts`).join(', ')}: the Jest projects select by suffix.` });
  }
  // A test file is named after its subject (test/skia-mock.test.tsx proves the vendor mock), not a mock itself.
  const isMockName = /\.mock\.tsx?$/.test(name) || /^mock-/.test(base) || /-mock$/.test(base);
  if (isTs && isMockName && !name.includes('.test.') && !rel.startsWith(`${app.layout.mocksDir}/`) && !rel.startsWith(`${ctx.layout.mocksDir}/`)) {
    report.problem({ file: rel, rule: 'fake-file', message: `"${name}" is a mock of our own code`, fix: 'Write an in-memory fake-<concern>.ts exporting createFake<Concern>(); root __mocks__/ is only for vendor SDKs that crash on import in Jest.' });
  }
  checkFlowFile(rel, name, ctx, report);
  const catalogs = catalogDirOf(rel, ctx);
  if (catalogs !== null && /\.json$/.test(name) && rel === `${catalogs}/${name}`) {
    const locales = ctx.contract.locales;
    const isLocale = locales === null ? LOCALE_TAG.test(base) && name === `${base}.json` : locales.includes(name.replace(/\.json$/, ''));
    if (!isLocale) {
      report.problem({ file: rel, rule: 'catalog-file', message: `catalog "${name}" is not ${locales === null ? 'a BCP 47 locale tag' : `one of the app's locales (${locales.join(', ')})`}`, fix: locales === null ? 'Name catalogs after the locale tag with its canonical casing: en.json, ar.json, pt-BR.json, zh-Hans.json.' : `One file per locale in contracts/naming.json "locales": ${locales.map((code) => `${code}.json`).join(', ')}.` });
    }
  }
  if (under(rel, prefixed(app.dir, 'plugins')) && rel.split('/').length === (app.isRoot ? 2 : app.dir.split('/').length + 2) && isTs && !/^with-[a-z0-9]+(-[a-z0-9]+)*$/.test(base)) {
    report.problem({ file: rel, rule: 'plugin-file', message: `config plugin "${name}" is not with-<capability>.ts`, fix: 'Name local config plugins with-<capability>.ts and export with<Capability>, e.g. with-android-manifest-queries.ts.' });
  }
  const data = ctx.roleOf(rel, 'dataDir');
  if (data !== null && /\/fixtures\/[^/]+\.json$/.test(rel) && !/^[a-z0-9]+(-[a-z0-9]+)*-v\d+(\.[a-z0-9]+(-[a-z0-9]+)*)?\.json$/.test(name)) {
    report.problem({ file: rel, rule: 'fixture-file', message: `frozen fixture "${name}" is not <name>-v<N>[.<case>].json`, fix: 'Put the schema version in the name, e.g. tasks-db-v1.json, backup-v2.empty.json: migration tests load every old version by name.' });
  }
  const src = ctx.roleOf(rel, 'srcDir');
  if (src !== null && new RegExp(`^${src.replaceAll('.', '\\.')}/games/[^/]+/levels/[^/]+\\.json$`).test(rel) && !/^pack-\d+\.json$/.test(name)) {
    report.problem({ file: rel, rule: 'level-file', message: `level table "${name}" is not pack-<n>.json`, fix: 'Name level tables pack-1.json, pack-2.json, ... (games plugin).' });
  }
}

/** Where a YAML file sits in its app's e2e folder ({ e2e, local }), or null: flow-file owns every YAML name there. */
function flowPlace(rel, ctx) {
  const e2e = ctx.roleOf(rel, 'e2eDir');
  if (e2e === null || e2e === '.' || e2e === '' || !/\.ya?ml$/.test(rel)) return null;
  return { e2e, local: rel.slice(e2e.length + 1) };
}

const isFlowFileTarget = (rel, ctx) => flowPlace(rel, ctx) !== null;

// A YAML file in the e2e folder lives in one of four places: Maestro's config.yaml at the top, a flow in
// flows/<area>/ (what CI runs, one area folder per Maestro run), a sub-flow in subflows/ (run only
// through runFlow), or a folder contracts/naming.json "extraE2eFolders" declares (flows run by hand or by
// their own script). Anything else is a flow no CI run and no reader finds.
function checkFlowFile(rel, name, ctx, report) {
  const place = flowPlace(rel, ctx);
  if (place === null) return;
  const { e2e, local } = place;
  const kebabYaml = /^[a-z0-9]+(-[a-z0-9]+)*\.ya?ml$/;
  if (!local.includes('/')) {
    if (!/^config\.ya?ml$/.test(name)) report.problem({ file: rel, rule: 'flow-file', message: `"${name}" sits loose in ${e2e}/`, fix: `Put flows in ${e2e}/flows/<area>/<nn>-<name>.yaml and shared steps in ${e2e}/subflows/; only Maestro's config.yaml lives at the top.` });
    return;
  }
  if (local.startsWith('flows/')) {
    if (!/^\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.ya?ml$/.test(name)) {
      report.problem({ file: rel, rule: 'flow-file', message: `flow "${name}" is not <nn>-<name>.yaml`, fix: `Name flows ${e2e}/flows/<area>/<nn>-<name>.yaml, e.g. 01-add-task.yaml.` });
    } else if (!/^flows\/[^/]+\/[^/]+$/.test(local)) {
      report.problem({ file: rel, rule: 'flow-file', message: `flow "${name}" is not inside one area folder`, fix: `Put flows in ${e2e}/flows/<area>/ (smoke, journeys, rtl, a11y, ...): Maestro runs only the top-level files of the folder it is given.` });
    }
    return;
  }
  if (local.startsWith('subflows/')) {
    if (!kebabYaml.test(name)) report.problem({ file: rel, rule: 'flow-file', message: `sub-flow "${name}" is not <name>.yaml in kebab-case`, fix: 'Name sub-flows by what they do (sign-in.yaml, seed-tasks.yaml); they never run on their own and carry no number.' });
    return;
  }
  const extra = ctx.contract.extraE2eFolders.find((entry) => local.startsWith(`${entry.folder}/`));
  if (extra !== undefined) {
    if (local.slice(extra.folder.length + 1).includes('/')) {
      report.problem({ file: rel, rule: 'flow-file', message: `"${name}" is nested below the declared folder ${e2e}/${extra.folder}/`, fix: `Put it directly in ${e2e}/${extra.folder}/: Maestro runs only the top-level files of the folder it is given.` });
    } else if (!kebabYaml.test(name)) {
      report.problem({ file: rel, rule: 'flow-file', message: `flow "${name}" in ${e2e}/${extra.folder}/ is not kebab-case`, fix: 'Name it in kebab-case, with a two-digit order first when the flows run in sequence (01-buy.yaml, matrix.yaml).' });
    }
    return;
  }
  const folder = local.split('/').slice(0, -1).join('/');
  report.problem({ file: rel, rule: 'flow-file', message: `flow "${name}" sits in ${e2e}/${folder}/, outside flows/<area>/ and subflows/`, fix: `Move it to ${e2e}/flows/<area>/<nn>-<name>.yaml (CI runs the area folders of ${e2e}/flows/ one at a time, so a flow anywhere else never runs), or, for a folder of flows run only by hand or by their own script, declare it in contracts/naming.json "extraE2eFolders" ({ "folder": "${folder.split('/')[0]}", "why": "..." }).` });
}

function exportedNames(code) {
  const names = new Set();
  for (const match of code.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|type|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const item of match[1].split(',')) {
      const alias = item.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '').trim();
      if (alias) names.add(alias);
    }
  }
  return names;
}

/** The names a file's main export may have, or null when the file has no fixed pattern. */
function expectedExport(rel, ctx) {
  const want = expectedExportName(rel, ctx);
  if (!want) return null;
  const names = [want.name, ...(want.also ?? [])];
  if (want.what === 'component') {
    // A component in a nested feature folder may carry its parent folders: features/settings/language/
    // language-row.tsx -> LanguageRow or SettingsLanguageRow. A .tsx JSX helper keeps camelCase.
    const features = ctx.roleOf(rel, 'featuresDir');
    const nested = features === null ? [] : rel.slice(features.length + 1).split('/').slice(0, -1).filter((part) => part !== 'components');
    if (nested.length > 1) names.push(`${nested.slice(0, -1).map(pascalFromKebab).join('')}${want.name}`);
    names.push(camelFromKebab(stem(rel)));
  }
  return { names, what: want.what };
}

function expectedExportName(rel, ctx) {
  const name = rel.split('/').at(-1);
  if (/\.(test|spec|d)\.|\.golden\.|\.sim\./.test(name) || !SOURCE.test(name)) return null;
  if (ctx.roleOf(rel, 'routesDir') !== null) return null;
  const base = stem(name);
  const app = ctx.appOf(rel);
  if (/^use-[a-z0-9-]+$/.test(base)) return { name: camelFromKebab(base), what: 'hook' };
  if (/-screen$/.test(base) && name.endsWith('.tsx')) return { name: pascalFromKebab(base), what: 'screen component' };
  if (under(rel, prefixed(app.dir, 'plugins')) && /^with-/.test(base)) return { name: camelFromKebab(base), what: 'config plugin' };
  if (/^fake-[a-z0-9-]+$/.test(base)) return { name: `create${pascalFromKebab(base)}`, what: 'fake factory' };
  if (/-adapter$/.test(base) || (/-sql-driver$/.test(base) && base !== 'sql-driver')) return { name: `create${pascalFromKebab(base)}`, what: 'adapter factory' };
  if (/-port$/.test(base)) return { name: pascalFromKebab(base), what: 'port type' };
  if (ctx.roleOf(rel, 'storesDir') !== null && /-store$/.test(base)) return { name: `use${pascalFromKebab(base)}`, what: 'store hook' };
  if (/-reducer$/.test(base)) return { name: camelFromKebab(base), what: 'reducer' };
  // A root kit module (app-startup-and-bootstrap's slots) exports its kit factory: push-root-kit.tsx -> createPushKit.
  if (/^[a-z0-9]+(-[a-z0-9]+)*-root-kit$/.test(base)) return { name: `create${pascalFromKebab(base.replace(/-root-kit$/, ''))}Kit`, what: 'root kit factory' };
  // A context module keeps its context private beside the provider and the hook that read it.
  if (/^[a-z0-9]+(-[a-z0-9]+)*-context$/.test(base)) {
    const subject = pascalFromKebab(base.replace(/-context$/, ''));
    return { name: `${subject}Provider`, also: [`${subject}Context`, `use${subject}`], what: 'context module' };
  }
  if (name.endsWith('.tsx') && (ctx.roleOf(rel, 'uiDir') !== null || ctx.roleOf(rel, 'featuresDir') !== null)) return { name: pascalFromKebab(base), what: 'component' };
  return null;
}

function hasPathHeader(text, rel) {
  const lines = text.split('\n');
  const first = (lines[0]?.startsWith('#!') ? lines[1] : lines[0] ?? '')?.trimEnd() ?? '';
  return first === `// ${rel}` || first.startsWith(`// ${rel} `) || first.startsWith(`// ${rel}:`);
}

// Files a tool writes and rewrites itself: Expo regenerates expo-env.d.ts on every start.
const GENERATED_SOURCES = ['expo-env.d.ts'];

function checkPathHeader(rel, text, ctx, report) {
  if (!ctx.contract.pathHeader || GENERATED_SOURCES.includes(rel.split('/').at(-1)) || hasPathHeader(text, rel)) return;
  const shebang = text.startsWith('#!') ? ' (line 2: the #! line stays first)' : '';
  report.problem({ file: rel, line: shebang ? 2 : 1, rule: 'path-header', message: `line ${shebang ? 2 : 1} is not "// ${rel}"`, fix: `Make line ${shebang ? 2 : 1}: // ${rel}${shebang}  (a short note may follow after ": " or a space). Moving a file moves its header in the same commit.` });
}

function checkSource(root, rel, ctx, report) {
  const text = readFileSync(join(root, rel), 'utf8');
  checkPathHeader(rel, text, ctx, report);
  const app = ctx.appOf(rel);
  if (rel.startsWith(`${app.layout.mocksDir}/`) || rel.startsWith(`${ctx.layout.mocksDir}/`)) return;
  const { code, lineOf } = scanSource(text);
  if (ctx.roleOf(rel, 'routesDir') !== null) {
    checkRouteExport(rel, code, lineOf, report);
    return;
  }
  const exported = exportedNames(code);
  const defaulted = /\bexport\s+default\s+(?:function\s+)?([A-Za-z_$][\w$]*)/.exec(code)?.[1];
  if (defaulted) exported.add(defaulted);
  const want = expectedExport(rel, ctx);
  if (want && !want.names.some((item) => exported.has(item))) {
    report.problem({ file: rel, rule: 'export-name', message: `the ${want.what} in "${rel.split('/').at(-1)}" must export ${want.names.join(' or ')}`, fix: `Name the main export ${want.names[0]} (the file name alone must tell what to import), or rename the file after its export.` });
  } else if (want?.what === 'hook') {
    // A missing useX is export-name's finding; one-hook-per-file only judges the hooks beside a present one.
    checkHookFile(rel, code, lineOf, want.names[0], report);
  }
  for (const match of code.matchAll(/\bexport\s+type\s+([A-Z][A-Za-z0-9]*Port)\b/g)) {
    const expected = `${kebabFromPascal(match[1])}.ts`;
    if (rel.split('/').at(-1) !== expected) {
      const services = ctx.appOf(rel).layout.servicesDir;
      report.problem({ file: rel, rule: 'port-file', message: `port type ${match[1]} is declared outside ${expected}`, fix: `Move it to ${services}/<concern>/${expected}; one port per file.` });
    }
  }
}

/**
 * One hook per use-x.ts: any other hook it exports must be a building block the file itself calls
 * (useFontScale inside useTextStyle). An unrelated hook gets its own use-<name>.ts. Heuristic: a call
 * anywhere in the file counts, not only inside useX.
 */
function checkHookFile(rel, code, lineOf, main, report) {
  const declared = /\bexport\s+(?:async\s+)?(?:function\s+|const\s+|let\s+)(use[A-Z][\w$]*)/g;
  for (const match of code.matchAll(declared)) {
    const hook = match[1];
    if (hook === main) continue;
    const calls = new RegExp(`(?<!function\\s+)\\b${hook}\\s*(?:<[^>()]*>)?\\(`, 'g');
    if ([...code.matchAll(calls)].length > 0) continue;
    const file = rel.split('/').at(-1);
    const kebab = kebabFromPascal(hook);
    report.problem({ file: rel, line: lineOf(match.index), rule: 'one-hook-per-file', message: `"${file}" exports a second hook ${hook} that it never calls`, fix: `Move ${hook} to its own ${kebab}.ts (one hook per file, found by its name), or keep it here only as a building block ${main} calls.` });
  }
}

function checkRouteExport(rel, code, lineOf, report) {
  const name = rel.split('/').at(-1);
  if (!name.endsWith('.tsx') || RULES.routeExportExempt.some((exempt) => name.startsWith(`${exempt}.`))) return;
  const isLayout = name.startsWith('_layout.');
  const suffix = isLayout ? 'Layout' : 'Route';
  const forms = [/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/, /\bexport\s+default\s+([A-Z][\w$]*)\s*;/, /\bexport\s*\{[^}]*\b([A-Z][\w$]*)\s+as\s+default\b/];
  const match = forms.map((form) => form.exec(code)).find(Boolean);
  const named = match?.[1];
  // The line of the default export when there is one; a file with none is a finding about the whole file.
  const defaultAt = match?.index ?? /\bexport\s+default\b/.exec(code)?.index;
  if (named === undefined || !new RegExp(`^[A-Z][A-Za-z0-9]*${suffix}$`).test(named)) {
    report.problem({
      file: rel,
      line: defaultAt === undefined ? undefined : lineOf(defaultAt),
      rule: 'route-export-name',
      message: named === undefined ? `the route has no named default-exported function` : `the route's default export ${named} does not end in ${suffix}`,
      fix: `Write export default function <Name>${suffix}() (${isLayout ? 'RootLayout, TabsLayout' : 'TaskDetailsRoute, NotFoundRoute'}): the router reads the default export, and the screen it renders keeps the name <Name>Screen in src/features/.`,
    });
  }
}

function checkWorkspaces(ctx, report) {
  const packages = workspacePackages(ctx.root);
  const scopes = new Map();
  for (const entry of packages) {
    const folder = entry.dir.split('/').at(-1);
    const match = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(entry.name);
    if (!match || match[2] !== folder) {
      const manifest = `${entry.dir}/package.json`;
      const line = jsonKeyLine(readFileSync(join(ctx.root, manifest), 'utf8'), 'name');
      report.problem({ file: manifest, line, rule: 'package-name', message: `name "${entry.name}" is not @<scope>/${folder}`, fix: `Set "name": "@<scope>/${folder}" (the folder name, kebab-case).` });
      continue;
    }
    scopes.set(match[1], [...(scopes.get(match[1]) ?? []), entry.dir]);
  }
  if (scopes.size > 1) {
    const list = [...scopes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([scope, dirs]) => `@${scope} (${dirs.join(', ')})`).join('; ');
    const line = jsonKeyLine(readFileSync(join(ctx.root, 'package.json'), 'utf8'), 'workspaces');
    report.problem({ file: 'package.json', line, rule: 'package-name', message: `workspaces use more than one scope: ${list}`, fix: 'Use one scope for every workspace package; rename it with one search-and-replace.' });
  }
  return packages.length;
}

/** Why an app id breaks the shape, or null. An open-ended template start (`com.acme.tasks${suffix}`) may
 * still grow its last segment, so that segment is not judged as a Java keyword. */
function appIdProblem(value, { isOpenEnd = false } = {}) {
  if (!APP_ID.test(value)) return `does not match ${APP_ID.source}`;
  const segments = value.split('.');
  const keyword = (isOpenEnd ? segments.slice(0, -1) : segments).find((segment) => RULES.javaKeywords.includes(segment));
  return keyword === undefined ? null : `has the Java keyword segment "${keyword}"`;
}

const PUBLISHED_FIRST = 'If this id is already live on a store it is permanent: stop and ask the developer, then record it in contracts/naming.json "publishedAppIds" ({ "id", "platform", "why" }) instead of changing it.';

function checkSlugs(app, slugs, ctx, report) {
  for (const slug of slugs) {
    if (slug.isPartial || ctx.isPublishedSlug(slug.value)) continue;
    const folder = app.dir.split('/').at(-1);
    if (!KEBAB.test(slug.value)) {
      report.problem({ file: slug.file, line: slug.line, rule: 'app-id', message: `slug '${slug.value}' is not kebab-case`, fix: 'If an EAS project already uses this slug it stays (it names the project, its builds, updates and credentials): stop and ask the developer, then record it in contracts/naming.json "publishedSlugs" ({ "slug", "why" }). A new app: use a kebab-case slug (tasks, task-planner) before the first EAS build.' });
    } else if (ctx.contract.slugMatchesAppFolder && !app.isRoot && slug.value !== folder) {
      const renamed = [...app.dir.split('/').slice(0, -1), slug.value].join('/');
      report.problem({ file: slug.file, line: slug.line, rule: 'app-id', message: `slug '${slug.value}' differs from the app folder ${app.dir} (contracts/naming.json "slugMatchesAppFolder" is on)`, fix: `Rename the folder to ${renamed}; never change an existing slug (it names the EAS project). Or set "slugMatchesAppFolder": false.` });
    }
  }
}

/**
 * The iOS and Android ids to compare: one literal each, or two lists of whole literals of one length
 * paired in order (both branches of IS_DEV ? 'com.myapp.dev' : 'com.myapp', or the returns of one
 * getUniqueIdentifier()). A template start or lists of different lengths are not compared.
 */
function platformPairs(ios, android) {
  const isWhole = (list) => list.length > 0 && list.every((entry) => !entry.isPartial);
  if (!isWhole(ios) || !isWhole(android) || ios.length !== android.length) return [];
  return ios.map((entry, index) => [entry, android[index]]);
}

function checkPlatformIds(config, ctx, report) {
  // One literal can feed both platforms (bundleIdentifier and package set from one constant or one
  // function): it is reported once, when any platform it feeds has not recorded it as live.
  const reported = new Set();
  const checks = [...config.ios.map((entry) => ({ entry, platform: 'ios' })), ...config.android.map((entry) => ({ entry, platform: 'android' })), ...config.ids.map((entry) => ({ entry, platform: undefined }))];
  for (const { entry, platform } of checks) {
    if (ctx.isPublishedAppId(entry.value, platform)) continue;
    const key = `${entry.file}:${entry.line}:${entry.value}`;
    const why = reported.has(key) ? null : appIdProblem(entry.value, entry);
    if (why === null) continue;
    reported.add(key);
    const notOurs = entry.isConst === true && !looksReverseDns(entry.value) ? ` If ${entry.name} is not the app's bundle id (a store or vendor id), rename it after its owner (APP_STORE_ID, ADMOB_IOS_APP_ID).` : '';
    const shown = entry.isPartial ? `'${entry.value}' (the start of a template literal)` : `'${entry.value}'`;
    report.problem({ file: entry.file, line: entry.line, rule: 'app-id', message: `app id ${shown} ${why}`, fix: `${PUBLISHED_FIRST} A new app: use lowercase reverse-DNS segments that start with a letter (com.acme.tasks), valid as an iOS bundle id and an Android package, and no Java keyword segment (the Android namespace becomes a Java package).${notOurs}` });
  }
  const compared = new Set();
  for (const [ios, android] of platformPairs(config.ios, config.android)) {
    if (ios.value === android.value || compared.has(`${ios.value} ${android.value}`)) continue;
    compared.add(`${ios.value} ${android.value}`);
    const isIosLive = ctx.isPublishedAppId(ios.value, 'ios');
    const isAndroidLive = ctx.isPublishedAppId(android.value, 'android');
    // Two live ids stay as they are; a live id that breaks the shape cannot be matched by a valid new one.
    const isLiveMismatch = (isIosLive && isAndroidLive) || (isIosLive && appIdProblem(ios.value) !== null) || (isAndroidLive && appIdProblem(android.value) !== null);
    if (isLiveMismatch) continue;
    const live = isIosLive ? `iOS id '${ios.value}'` : isAndroidLive ? `Android id '${android.value}'` : null;
    report.problem({ file: android.file, line: android.line, rule: 'app-id', message: `iOS bundle id '${ios.value}' and Android package '${android.value}' differ`, fix: live === null ? `${PUBLISHED_FIRST} A new app: use one id for both platforms (derive both from one constant), so store listings, deep-link files and support tooling name the app the same way.` : `The live ${live} is permanent: give the new platform the same id, or, if that id is live too, record it in contracts/naming.json "publishedAppIds".` });
  }
}

function checkAppIds(ctx, report) {
  let checked = 0;
  let productBase = null;
  for (const app of ctx.apps.filter((item) => item.isExpoApp)) {
    const config = readAppConfig(ctx.root, app);
    if (config === null) continue;
    checked += 1;
    checkSlugs(app, config.slug, ctx, report);
    checkPlatformIds(config, ctx, report);
    // Only a valid whole id is a base for product ids; an invalid one is already an app-id finding or a
    // live exception. Among variant ids (com.acme.tasks.dev, com.acme.tasks) the shortest is the base.
    const platformIds = [...config.ios, ...config.android].filter((entry) => !entry.isPartial).sort((a, b) => a.value.length - b.value.length);
    productBase ??= [...config.ids, ...platformIds].find((entry) => appIdProblem(entry.value) === null)?.value ?? null;
  }
  // <app id>.<product> by default; when that would pass the length limit, <last app-id segment>.<product>
  // (com.acmecorporation.taskplanner -> taskplanner.premium_yearly).
  const max = RULES.productIdMaxLength;
  const short = productBase?.split('.').at(-1) ?? null;
  const shortForm = (product) => (productBase !== null && `${productBase}.${product}`.length > max ? `${short}.${product}` : null);
  for (const id of ctx.contract.storeProductIds) {
    checked += 1;
    if (ctx.isPublishedProductId(id)) continue;
    const at = { file: ctx.contractFile, line: ctx.contractLine(id), rule: 'product-id' };
    const live = 'If this product already exists on a store it is permanent: stop and ask the developer, then record it in contracts/naming.json "publishedProductIds" ({ "id", "why" }).';
    const product = productBase !== null && id.startsWith(`${productBase}.`) ? id.slice(productBase.length + 1) : null;
    if (!PRODUCT_ID.test(id) || id.length > max || id.startsWith(RULES.reservedProductPrefix)) {
      const shorter = product !== null && id.length > max ? shortForm(product) : null;
      const hint = shorter !== null && shorter.length <= max ? ` With this app id, <app id>.<product> is too long: use <last app-id segment>.<product> (${shorter}).` : '';
      report.problem({ ...at, message: `store product id '${id}' is not valid on both stores`, fix: `${live} A new product: lowercase letters, digits, "_" and "." only, starting with a letter or digit, at most ${max} characters (Google Play's subscription limit), never ${RULES.reservedProductPrefix}*.${hint}` });
    } else if (productBase !== null && product === null && !(id.startsWith(`${short}.`) && shortForm(id.slice(short.length + 1)) !== null)) {
      const rest = id.startsWith(`${short}.`) ? id.slice(short.length + 1) : 'premium';
      report.problem({ ...at, message: `store product id '${id}' does not start with the app id '${productBase}.'`, fix: `${live} A new product: name it <app id>.<product>, e.g. ${productBase}.${rest}, so a receipt server, dashboard or report that sees several apps tells their products apart; only when that passes ${max} characters, <last app-id segment>.<product> (${short}.${rest}).` });
    }
  }
  return checked;
}

/** The root package.json as { data, text }, or null when it is missing or not JSON. */
function readPackage(root) {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf8');
    return { data: JSON.parse(text), text };
  } catch {
    return null;
  }
}

function checkScripts(manifest, report) {
  for (const name of Object.keys(manifest.data?.scripts ?? {})) {
    if (!NPM_SCRIPT.test(name)) report.problem({ file: 'package.json', line: jsonKeyLine(manifest.text, name), rule: 'npm-script-name', message: `script "${name}" is not <verb> or <area>:<verb>`, fix: 'Use kebab-case words joined by ":" (test:golden, build:ios:sim, check:unused).' });
  }
}

function checkCanonical(ctx, pkg, sources, report) {
  const { types, npmScripts, envVars } = ctx.contract.canonical;
  const where = (name) => ({ file: ctx.contractFile, line: ctx.contractLine(name), rule: 'canonical-name' });
  for (const script of npmScripts) {
    const at = where(script);
    if (!Object.hasOwn(pkg?.scripts ?? {}, script)) report.problem({ ...at, message: `canonical npm script "${script}" is not in package.json`, fix: `Restore the script "${script}" (CI, hooks and docs call it by name), or stop and ask the reviewer before renaming a canonical name, then update contracts/naming.json.` });
  }
  for (const type of types) {
    const at = where(type);
    const file = `${kebabFromPascal(type)}.ts`;
    const found = sources.some(({ rel, code }) => rel.split('/').at(-1) === file && new RegExp(`\\bexport\\s+type\\s+${type}\\b`).test(code));
    if (!found) report.problem({ ...at, message: `canonical type ${type} is not exported from a ${file}`, fix: `Keep export type ${type} in its own ${file} (tests, fakes and lint exemptions match the name), or stop and ask the reviewer before renaming it.` });
  }
  const envTexts = [...sources.map(({ text }) => text), ...['eas.json', 'app.json'].filter((rel) => existsSync(join(ctx.root, rel))).map((rel) => readFileSync(join(ctx.root, rel), 'utf8'))];
  for (const name of envVars) {
    const at = where(name);
    if (!envTexts.some((text) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text))) {
      report.problem({ ...at, message: `canonical env variable ${name} is read nowhere`, fix: `Read ${name} where it belongs (app.config.ts, eas.json "env", the app's EXPO_PUBLIC_ reads) or stop and ask the reviewer before renaming it: a renamed variable silently becomes undefined.` });
    }
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  const report = createReporter({ name: 'check-file-names', json: options.json });
  const ctx = namingContext(root, { contract: options.contract });
  const note = missingContractNote(ctx);
  if (note) report.note(note);
  const files = walkRepo(root);
  checkNames(files, ctx, report);
  let checked = 0;
  const sources = [];
  for (const rel of files) {
    if (JS_SOURCE.test(rel) && (ctx.isOwned(rel) || !rel.includes('/'))) {
      checked += 1;
      checkPathHeader(rel, readFileSync(join(root, rel), 'utf8'), ctx, report);
      continue;
    }
    const isRootTs = /^[^/]+\.tsx?$/.test(rel);
    if (!(ctx.isOwned(rel) || isRootTs) || !/\.(ts|tsx|json|ya?ml)$/.test(rel)) continue;
    checked += 1;
    if (!isRootTs) checkFilePatterns(rel, ctx, report);
    if (SOURCE.test(rel)) {
      checkSource(root, rel, ctx, report);
      const text = readFileSync(join(root, rel), 'utf8');
      sources.push({ rel, text, code: scanSource(text).code });
    }
  }
  const manifest = readPackage(root);
  checked += checkWorkspaces(ctx, report);
  checked += checkAppIds(ctx, report);
  if (manifest !== null) {
    checked += 1;
    checkScripts(manifest, report);
  }
  checkCanonical(ctx, manifest?.data ?? null, sources, report);
  return report.finish({ checked, unit: 'files, configs and manifests' });
});
