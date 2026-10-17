#!/usr/bin/env node
// check-configs.mjs: checks that the app repo's TypeScript, ESLint, Prettier and knip configuration is
// the canonical strict set from assets/ts-lint-baseline.json and has not been weakened.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-configs.mjs [repo-root] [options]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { createReporter, fail, globToRegExp, parseArgs, parseJsonc, readTsconfigPaths, requireDir, resolveLayout, run, walk, walkRepo } from './check-lib.mjs';
import { appFiles, appTops, coversAppCode, nativeScope } from './lib/app-scope.mjs';
import { blockDifferences, configModel, elementsOf, isExactGlob, sameBlockFamily, scopeKey, scopeLabel } from './lib/eslint-structure.mjs';
import { matchBracket, scanSource } from './lib/source-scan.mjs';
import { isExpoApp } from './lib/workspaces.mjs';

const BASELINE = JSON.parse(readFileSync(new URL('../assets/ts-lint-baseline.json', import.meta.url), 'utf8'));
/** The canonical config this skill ships: the blocks, file groups and shared lists the app's config must keep. */
const CANONICAL_ESLINT = new URL('../templates/eslint.config.mjs', import.meta.url);

const SPEC = {
  name: 'check-configs',
  summary:
    'Checks the app configuration against the canonical strict set: tsconfig.base.json options, the two TypeScript ' +
    'programs (root: Node and tests; src/tsconfig.json: the app, no Node types) with their types, include, exclude and ' +
    'aliases, src/app-env.d.ts, eslint.config.mjs (compared with templates/eslint.config.mjs: canonical blocks, file ' +
    'groups and shared lists unchanged, extra blocks name exact files; required rules, limit values, no warn tier, no ' +
    'extra "off", Prettier last), .prettierrc.json, .prettierignore, pre-existing top-level folders in the ignore lists, ' +
    'knip.json, stray configs, the exact lint/type tool versions and the lint scripts.',
  usage: '[repo-root] [options]',
  options: {
    only: { type: 'string', value: 'area', help: 'Check one area only: tsconfig, eslint, prettier, package or knip' },
    'src-dir': { type: 'string', value: 'dir', help: 'The app source folder (default: from resolveLayout, "src")' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  tsconfig-missing        tsconfig.base.json, tsconfig.json, src/tsconfig.json (or an Expo app workspace tsconfig) is missing',
    '  tsconfig-base-option    tsconfig.base.json lacks a required compiler option, has a weaker value, sets a member of',
    '                          strict (noImplicitAny, strictNullChecks, ...) to false, sets an option outside the canonical',
    '                          set, turns on noUnused*, or sets include, exclude, files or references (every program inherits them)',
    '  tsconfig-program        a program tsconfig does not extend tsconfig.base.json, or sets keys beyond types, paths,',
    '                          tsBuildInfoFile, include and exclude (compiler options live in the base; never lib)',
    '  tsconfig-world          a program has the wrong types or lib for its world, lacks a required include/exclude entry',
    '                          (typed routes, src/app-env.d.ts kept out of the root program), pulls Node-world files into the',
    '                          app, or the app program excludes a folder (it would lose the no-Node-types guarantee)',
    '  tsconfig-expo-env       expo-env.d.ts can enter a program (expo/types breaks Text props under the Strict TypeScript API)',
    '  tsconfig-alias          the root program and the app program resolve an alias (@/*, @test/*) to different folders',
    '  app-env                 src/app-env.d.ts is missing or does not declare process for EXPO_PUBLIC_* dot access',
    '  eslint-missing          eslint.config.mjs does not exist',
    '  eslint-required         a required setting, rule, selector or canonical message of the config is missing',
    '  eslint-limit-changed    a size or complexity limit has a value other than the canonical one, in any shape ESLint',
    '                          accepts (a number, an options object, severity 2), or is declared bare (ESLint\'s default applies)',
    "  eslint-rule-off         a rule is switched off ('off', ['off'] or 0) more often than the canonical config does",
    '  eslint-weakened         the structure differs from templates/eslint.config.mjs: a canonical block changed, missing or',
    '                          out of order [canonical-block], a block beyond the canonical ones that reaches more than named',
    '                          files or a files value the checker cannot resolve [exemption-scope], a file group without a',
    '                          canonical glob or (in an exemption group) with a folder-wide one [file-group], a shared list or',
    '                          helper that differs [canonical-const], an extra config item [config-item], a statement that',
    '                          mutates a shared list [side-effect] or any other top-level statement [top-level-statement];',
    '                          also disableTypeChecked, noInlineConfig: false, a second linterOptions block, an extra allow list,',
    '                          a fresh no-restricted-* list or a restrictedImports() call without RUNTIME_PATHS [fresh-list], a',
    '                          rule whose options carry a guarantee (or a limit rule) declared again [option-redeclared], an extra',
    '                          globalIgnores entry [global-ignores] or ignores key [block-ignores]',
    '  eslint-warn             a rule uses the "warn" severity or 1 (there is no warning tier)',
    '  eslint-forbidden-import the config imports a forbidden plugin (eslint-plugin-prettier)',
    '  config-stray            a second ESLint, Prettier or knip config exists (.eslintrc*, prettier.config.js, a workspace config,',
    '                          a nested .prettierrc*, a "prettier", "eslintConfig" or "knip" key in a package.json)',
    '  prettier-option         .prettierrc.json is missing or an option differs from the canonical value',
    '  prettier-ignore         .prettierignore is missing, lacks a required line or still holds the __PRE_EXISTING__ placeholder;',
    '                          when multi-package, no line ignores an Expo app workspace\'s generated ios/ or android/',
    '  ignore-pre-existing     a top-level folder or file outside the app layout is not ignored by .prettierignore, by',
    '                          PRE_EXISTING in eslint.config.mjs, or (when it holds .ts/.tsx) by the root tsconfig.json exclude',
    '  ignore-app-code         a PRE_EXISTING or extra globalIgnores entry, a .prettierignore line or a root tsconfig.json',
    '                          exclude entry reaches app code (src/, test/, __mocks__/, scripts/, plugins/, app.config.ts,',
    '                          the workspaces, layoutEntries); a line naming exactly an Expo app workspace\'s generated',
    '                          native folder (apps/*/ios/, apps/*/android/) is not app code',
    '  knip-config             knip.json is missing, lacks a required rule, ranks a rule below "error", filters issue types',
    '                          (exclude, include), or drops a canonical entry or project glob',
    '  package-pin             a lint/type tool is missing from package.json or not pinned to the verified version',
    '  package-overrides       package.json overrides do not hold every @typescript-eslint/* package at the typescript-eslint pin',
    '  lint-script             an npm script that runs eslint lacks --max-warnings 0, passes an override or ignore flag',
    '                          (--rule, --config, --ignore-pattern, ...), lints a narrower target than ., or swallows eslint\'s',
    '                          exit code (|| true, ; echo, a pipe)',
    '',
    'Reads from rn-skills.config.json (optional): the layout keys (srcDir, ...) and "layoutEntries", a list of extra',
    'top-level folders or files that belong to the app (so ignore-pre-existing does not ask to ignore them, and',
    'ignore-app-code keeps every ignore list out of them).',
    'When multi-package (package.json "workspaces"): every workspace tsconfig extends the root tsconfig.base.json and an',
    'Expo app workspace never lists node types; workspace ESLint, Prettier or knip configs are strays; .prettierignore',
    'ignores each Expo app workspace\'s ios/ and android/ (apps/*/ios/, apps/*/android/).',
    'Example: node check-configs.mjs .            (from the app repo root)',
  ].join('\n'),
};

const AREAS = ['tsconfig', 'eslint', 'prettier', 'package', 'knip'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value);

/** A repo JSON file, or { error } when it does not parse. */
function readJson(root, file) {
  try {
    return { data: parseJsonc(readFileSync(join(root, file), 'utf8')) };
  } catch (error) {
    return { error: String(error.message).split('\n')[0] };
  }
}

/** The relative path from a program folder back to the repo root ('' for the root, '../' for src/). */
const toRoot = (file) => (posix.dirname(file) === '.' ? '' : `${posix.dirname(file).split('/').map(() => '..').join('/')}/`);
const fillPath = (text, layout, file) => text.replaceAll('{srcDir}', layout.srcDir).replaceAll('{toRoot}', toRoot(file));

function checkBase(root, report) {
  const spec = BASELINE.tsconfigBase;
  if (!existsSync(join(root, spec.file))) {
    report.problem({ file: spec.file, rule: 'tsconfig-missing', message: `${spec.file} does not exist`, fix: 'Copy templates/tsconfig.base.json to the repo root.' });
    return;
  }
  const { data, error } = readJson(root, spec.file);
  if (error) {
    report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `is not valid JSON (${error})`, fix: 'Restore templates/tsconfig.base.json.' });
    return;
  }
  if (data.extends !== spec.extends) {
    report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `extends is ${show(data.extends)}, expected "${spec.extends}"`, fix: `Set "extends": "${spec.extends}".` });
  }
  // include, exclude, files and references in the base are inherited by every program that sets none.
  for (const key of Object.keys(data).filter((name) => !spec.topLevelKeys.includes(name))) {
    report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `sets the top-level key "${key}", which every program that does not set its own inherits (an exclude here quietly drops files from the app program)`, fix: `Remove it: the base holds only ${spec.topLevelKeys.join(', ')}; each program tsconfig sets its own include and exclude.` });
  }
  const options = data.compilerOptions ?? {};
  for (const [key, want] of Object.entries(spec.compilerOptions)) {
    if (!same(options[key], want)) {
      report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `compilerOptions.${key} is ${show(options[key])}, expected ${show(want)}`, fix: `Set "${key}": ${show(want)} (templates/tsconfig.base.json).` });
    }
  }
  for (const key of spec.notTrue) {
    if (options[key] === true) {
      report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `compilerOptions.${key} is true; ESLint's no-unused-vars is the one reporter for unused code`, fix: `Remove "${key}" (it stays off so "_"-prefixed parameters work and there is one reporter).` });
    }
  }
  // strict turns these on; setting one to false quietly drops that part of strict for every program.
  for (const key of spec.strictFamily) {
    if (options[key] === false) {
      report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `compilerOptions.${key} is false, which turns off part of "strict" for every program`, fix: `Remove "${key}" and fix the type errors it hid; strict stays whole.` });
    }
  }
  const known = new Set([...Object.keys(spec.compilerOptions), ...spec.notTrue, ...spec.strictFamily, ...spec.optional]);
  for (const key of Object.keys(options).filter((name) => !known.has(name) || (spec.strictFamily.includes(name) && options[name] !== true && options[name] !== false))) {
    report.problem({ file: spec.file, line: 1, rule: 'tsconfig-base-option', message: `compilerOptions.${key} is not in the canonical set`, fix: `Remove "${key}": a new compiler option changes the guarantees of every program, so it is a baseline change (stop and ask the developer; Gate-Change trailer).` });
  }
}

/** Program checks shared by both layouts: extends the base, allowed keys only, expo-env.d.ts kept out. */
function checkProgramShape(file, config, report, { isRoot, worldChecked }) {
  const allowed = BASELINE.programAllowed;
  const wantExtends = `${toRoot(file) || './'}tsconfig.base.json`;
  if (config.extends !== wantExtends) {
    report.problem({ file, line: 1, rule: 'tsconfig-program', message: `extends is ${show(config.extends)}, expected "${wantExtends}"`, fix: `Set "extends": "${wantExtends}"; every program shares one set of compiler guarantees.` });
  }
  const extraKeys = Object.keys(config).filter((key) => !allowed.keys.includes(key));
  // tsconfig-world reports lib with its reason wherever it checks the program's world.
  const extraOptions = Object.keys(config.compilerOptions ?? {}).filter((key) => !allowed.compilerOptions.includes(key) && !(worldChecked && key === 'lib'));
  for (const key of [...extraKeys, ...extraOptions.map((name) => `compilerOptions.${name}`)]) {
    report.problem({ file, line: 1, rule: 'tsconfig-program', message: `sets ${key}; a program tsconfig sets only ${allowed.compilerOptions.join(', ')}, include and exclude`, fix: 'Remove it; compiler options live in tsconfig.base.json so every program gets the same guarantees.' });
  }
  const include = config.include ?? [];
  const exclude = config.exclude ?? [];
  if (isRoot && !exclude.includes('expo-env.d.ts')) {
    report.problem({ file, line: 1, rule: 'tsconfig-expo-env', message: 'exclude lacks "expo-env.d.ts"; expo start adds it to include and expo/types then enters the program', fix: 'List "expo-env.d.ts" in both include and exclude (templates/tsconfig.json): expo/types breaks Text props and styles under the Strict TypeScript API (TS2344/TS2322 on Expo SDK 57).' });
  }
  for (const entry of include.filter((value) => /(^|\/)expo-env\.d\.ts$/.test(value))) {
    if (!exclude.includes(entry) && !(isRoot && entry === 'expo-env.d.ts')) {
      report.problem({ file, line: 1, rule: 'tsconfig-expo-env', message: `include lists "${entry}" without excluding it`, fix: 'Remove it from include (or list it in exclude too, as the root tsconfig.json does): expo/types breaks Text props and styles under the Strict TypeScript API (TS2344/TS2322 on Expo SDK 57).' });
    }
  }
}

function checkWorld(file, config, spec, layout, report) {
  const types = config.compilerOptions?.types;
  if (!same(types, spec.types)) {
    report.problem({ file, line: 1, rule: 'tsconfig-world', message: `compilerOptions.types is ${show(types)}, expected ${show(spec.types)} (${spec.world})`, fix: `Set "types": ${show(spec.types)}; app code never sees Node types, and TypeScript 6 loads none by default.` });
  }
  const lib = config.compilerOptions?.lib ?? null;
  if (!same(lib, spec.lib)) {
    report.problem({ file, line: 1, rule: 'tsconfig-world', message: `compilerOptions.lib is ${show(lib)}, expected no lib (the Expo base decides)`, fix: 'Remove "lib".' });
  }
  const include = config.include ?? [];
  const exclude = config.exclude ?? [];
  for (const raw of spec.includeContains) {
    const entry = fillPath(raw, layout, file);
    if (!include.includes(entry)) {
      const why = spec.includeWhy?.[raw];
      report.problem({ file, line: 1, rule: 'tsconfig-world', message: `include lacks "${entry}"${why ? ` (${why})` : ''}`, fix: `Add "${entry}" to include (templates/${file === 'tsconfig.json' ? 'tsconfig.json' : 'src/tsconfig.json'}).` });
    }
  }
  for (const raw of spec.excludeContains) {
    const entry = fillPath(raw, layout, file);
    if (!exclude.includes(entry)) {
      const why = spec.excludeWhy?.[raw];
      report.problem({ file, line: 1, rule: 'tsconfig-world', message: `exclude lacks "${entry}"${why ? ` (${why})` : ''}`, fix: `Add "${entry}" to exclude (templates/tsconfig.json).` });
    }
  }
  if (Array.isArray(spec.excludeAllowed)) {
    for (const entry of exclude.filter((value) => !spec.excludeAllowed.includes(value))) {
      report.problem({ file, line: 1, rule: 'tsconfig-world', message: `exclude lists "${entry}"; ${spec.excludeWhy}`, fix: 'Remove it: every file under the app folder is app code and type-checks without Node types. Move a file that needs Node out of the app folder (scripts/, plugins/).' });
    }
  }
  for (const raw of spec.forbiddenInclude ?? []) {
    const prefix = fillPath(raw, layout, file);
    for (const entry of include.filter((value) => value === prefix || value.startsWith(`${prefix}/`))) {
      if (/expo-env\.d\.ts$/.test(entry)) continue;
      report.problem({ file, line: 1, rule: 'tsconfig-world', message: `include "${entry}" pulls Node-world files into the app program`, fix: 'Remove it; app.config.ts, config plugins and scripts are checked by the root program and never bundled.' });
    }
  }
}

function checkAliases(root, appFile, report) {
  const rootPaths = readTsconfigPaths(root, 'tsconfig.json')?.aliases ?? [];
  const appPaths = readTsconfigPaths(root, appFile)?.aliases ?? [];
  const byPattern = (list) => new Map(list.map((alias) => [alias.pattern, alias.targets]));
  const app = byPattern(appPaths);
  const top = byPattern(rootPaths);
  for (const [pattern, targets] of top) {
    if (!app.has(pattern)) {
      report.problem({ file: appFile, line: 1, rule: 'tsconfig-alias', message: `the root program maps ${pattern} but the app program does not`, fix: `Add "${pattern}" to compilerOptions.paths, relative to this file (templates/src/tsconfig.json).` });
    } else if (!same(app.get(pattern), targets)) {
      report.problem({ file: appFile, line: 1, rule: 'tsconfig-alias', message: `${pattern} resolves to ${show(app.get(pattern))} here but to ${show(targets)} in tsconfig.json`, fix: 'Point both at the same folder: an import that type-checks in one program must resolve in the other.' });
    }
  }
  for (const pattern of app.keys()) {
    if (!top.has(pattern)) {
      report.problem({ file: 'tsconfig.json', line: 1, rule: 'tsconfig-alias', message: `the app program maps ${pattern} but the root program does not`, fix: `Add "${pattern}" to compilerOptions.paths in tsconfig.json (jest-expo and ESLint read the root program).` });
    }
  }
}

function checkAppEnv(root, layout, report) {
  const file = fillPath(BASELINE.appEnv.file, layout, '.');
  const path = join(root, file);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (!new RegExp(BASELINE.appEnv.declares).test(text)) {
    report.problem({ file, line: 1, rule: 'app-env', message: existsSync(path) ? 'does not declare `process`' : 'does not exist', fix: 'Copy templates/src/app-env.d.ts: the app program has no @types/node, so process (for EXPO_PUBLIC_* dot access) is declared there.' });
  }
}

function readProgram(root, file, report) {
  if (!existsSync(join(root, file))) {
    report.problem({ file, rule: 'tsconfig-missing', message: `${file} does not exist`, fix: 'Copy the matching tsconfig template; each program is its own tsc run (npm run typecheck).' });
    return null;
  }
  const { data, error } = readJson(root, file);
  if (error) {
    report.problem({ file, line: 1, rule: 'tsconfig-program', message: `is not valid JSON (${error})`, fix: 'Restore it from the template.' });
    return null;
  }
  return data;
}

function checkTsconfigs(root, layout, report) {
  checkBase(root, report);
  const [rootSpec, appSpec] = BASELINE.programs;
  const rootConfig = readProgram(root, rootSpec.file, report);
  if (rootConfig) {
    checkProgramShape(rootSpec.file, rootConfig, report, { isRoot: true, worldChecked: true });
    if (layout.mode === 'single') checkWorld(rootSpec.file, rootConfig, rootSpec, layout, report);
    else checkWorld(rootSpec.file, rootConfig, { ...rootSpec, includeContains: [], excludeContains: [] }, layout, report);
  }
  if (layout.mode === 'monorepo') {
    checkWorkspaceTsconfigs(root, layout, report);
    return;
  }
  const appFile = fillPath(appSpec.file, layout, '.');
  const appConfig = readProgram(root, appFile, report);
  if (appConfig) {
    checkProgramShape(appFile, appConfig, report, { isRoot: false, worldChecked: true });
    checkWorld(appFile, appConfig, appSpec, layout, report);
    if (rootConfig) checkAliases(root, appFile, report);
  }
  checkAppEnv(root, layout, report);
}

/** When multi-package: each workspace program extends the root base; an Expo app never sees Node types. */
function checkWorkspaceTsconfigs(root, layout, report) {
  for (const workspace of layout.workspaces) {
    const file = `${workspace.dir}/tsconfig.json`;
    const isApp = isExpoApp(root, workspace.dir);
    if (!existsSync(join(root, file))) {
      if (isApp) report.problem({ file, rule: 'tsconfig-missing', message: `${file} does not exist (an Expo app workspace is its own program)`, fix: 'Add one that extends the root tsconfig.base.json and sets only types, paths, include and exclude.' });
      continue;
    }
    const config = readProgram(root, file, report);
    if (!config) continue;
    checkProgramShape(file, config, report, { isRoot: false, worldChecked: false });
    const types = config.compilerOptions?.types ?? [];
    if (isApp && types.includes('node')) {
      report.problem({ file, line: 1, rule: 'tsconfig-world', message: `an Expo app workspace lists ${show(types)}; app code never sees Node types`, fix: 'Set "types": ["jest"]; Node code (app.config.ts, plugins, scripts) is checked by the root program.' });
    }
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** A rule key in a rules object, quoted or (for a plain identifier such as complexity) bare. */
const ruleKey = (name) => new RegExp(/^[A-Za-z_$][\w$]*$/.test(name) ? `(?<![\\w$'".-])${name}\\s*:|(['"])${name}\\1\\s*:` : `(['"])${escapeRegExp(name)}\\1\\s*:`, 'g');
const OFF = /^(?:'off'|"off"|0)$/;

/** The extent of a property value that starts at `from` (up to the comma or brace of depth 0). */
function valueEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (c === ',' && depth === 0) return i;
  }
  return code.length;
}

/**
 * Every declaration of a limit rule with the value ESLint will use: a number, ['error', 6],
 * ['error', { max: 6 }], { variant, max } in any key order, 2 / 'error' / "error" severities, and a
 * bare severity (ESLint's default then applies). 'off' is left to eslint-rule-off.
 */
function limitDeclarations(scan, limit) {
  const found = [];
  for (const match of scan.codeKeep.matchAll(ruleKey(limit.rule))) {
    let at = match.index + match[0].length;
    while (/\s/.test(scan.code[at])) at += 1;
    const end = scan.code[at] === '[' ? matchBracket(scan.code, at) + 1 : valueEnd(scan.code, at);
    const text = scan.codeKeep.slice(at, end).trim();
    const entry = { index: match.index, value: null, bare: false, expression: false };
    if (scan.code[at] !== '[') {
      if (OFF.test(text)) continue;
      if (/^(?:'(?:error|warn)'|"(?:error|warn)"|[12])$/.test(text)) Object.assign(entry, { bare: true, value: limit.eslintDefault });
      else entry.expression = true;
    } else {
      const { items } = elementsOf(scan.code, at);
      const parts = items.map((item) => scan.codeKeep.slice(item.start, item.end).trim());
      if (parts.length === 0 || OFF.test(parts[0])) continue;
      const option = parts[1];
      if (option === undefined) Object.assign(entry, { bare: true, value: limit.eslintDefault });
      else if (/^\d+$/.test(option)) entry.value = Number(option);
      else if (option.startsWith('{') && limit.options.length > 0) {
        const key = new RegExp(`(?:^|[{,\\s])(?:${limit.options.join('|')})\\s*:\\s*(\\d+)`).exec(option);
        if (key) entry.value = Number(key[1]);
        else Object.assign(entry, { bare: true, value: limit.eslintDefault });
      } else entry.expression = true;
    }
    found.push(entry);
  }
  return found;
}

function checkLimits(scan, spec, report) {
  for (const limit of spec.limitValues) {
    for (const entry of limitDeclarations(scan, limit)) {
      const line = scan.lineOf(entry.index);
      const fix = 'Put the canonical value back and split the code by responsibility; a limit change is a stop-and-ask decision with a Gate-Change trailer.';
      if (entry.expression) {
        report.problem({ file: spec.file, line, rule: 'eslint-limit-changed', message: `${limit.rule} is declared through an expression the checker cannot read`, fix: `Write the value inline, as templates/eslint.config.mjs does (${limit.allowed.join(' or ')}).` });
      } else if (!limit.allowed.includes(entry.value)) {
        const what = entry.bare ? `is declared without a value, so ESLint's default ${entry.value} applies` : `is ${entry.value}`;
        report.problem({ file: spec.file, line, rule: 'eslint-limit-changed', message: `${limit.rule} ${what}; the canonical values are ${limit.allowed.join(' or ')}`, fix });
      }
    }
  }
}

/** The string literals and spread identifiers of the globalIgnores([...]) list. */
function checkGlobalIgnores(scan, spec, report, scope) {
  const at = scan.code.search(/globalIgnores\s*\(\s*\[/);
  if (at === -1) return;
  const open = scan.code.indexOf('[', at);
  const { items } = elementsOf(scan.code, open);
  for (const item of items) {
    const text = scan.codeKeep.slice(item.start, item.end).trim();
    const line = scan.lineOf(item.start + scan.codeKeep.slice(item.start, item.end).search(/\S/));
    const literal = /^(['"`])(.*)\1$/.exec(text);
    const spread = /^\.\.\.([A-Za-z_$][\w$]*)$/.exec(text);
    if (spread && spec.globalIgnores.spreads.includes(spread[1])) continue;
    if (literal && spec.globalIgnores.literals.includes(literal[2])) continue;
    const covers = literal ? scope.covers(literal[2], 'anchored') : null;
    if (covers) {
      report.problem({ file: spec.file, line, rule: 'ignore-app-code', message: `globalIgnores lists '${literal[2]}', which ${covers.reason}, so ESLint and check-source skip app code`, fix: scope.fix });
    } else {
      report.problem({ file: spec.file, line, rule: 'eslint-weakened', message: `globalIgnores lists ${text}; only the canonical entries and ...PRE_EXISTING belong there [global-ignores]`, fix: 'Move a folder that predates the app into PRE_EXISTING (and .prettierignore and the root tsconfig.json exclude), where both checkers read it; delete anything else.' });
    }
  }
}

/** The globs a files value names: string literals, plus the const arrays its identifiers refer to. */
function globsOf(scan, from, to, seen = new Set()) {
  const globs = scan.strings.filter((entry) => entry.index >= from && entry.index < to).map((entry) => entry.value);
  for (const match of scan.code.slice(from, to).matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (seen.has(name)) continue;
    seen.add(name);
    const decl = new RegExp(`const ${name}\\s*=\\s*\\[`).exec(scan.code);
    if (!decl) continue;
    const open = decl.index + decl[0].length - 1;
    globs.push(...globsOf(scan, open, matchBracket(scan.code, open), seen));
  }
  return globs;
}

// Workspace folder prefixes (apps/<star>/, apps/mobile/) a multi-package config puts in front of the canonical globs.
function workspacePrefixes(root, layout) {
  if (layout.mode !== 'monorepo') return [];
  const pkg = readJson(root, 'package.json').data ?? {};
  const raw = Array.isArray(pkg.workspaces) ? pkg.workspaces : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : [];
  const prefixes = [...raw.filter((entry) => typeof entry === 'string' && !entry.startsWith('!')), ...layout.workspaces.map((workspace) => workspace.dir)];
  return [...new Set(prefixes.map((entry) => `${entry.replace(/\/+$/, '')}/`))].sort((a, b) => b.length - a.length);
}

let canonicalModel = null;
/** The model of the skill's own templates/eslint.config.mjs (the canonical structure), read once. */
function canonicalEslint() {
  if (canonicalModel === null) {
    if (!existsSync(CANONICAL_ESLINT)) fail('the skill\'s templates/eslint.config.mjs is missing', 'Reinstall the skill: check-configs compares the app\'s config with that file.');
    canonicalModel = configModel(readFileSync(CANONICAL_ESLINT, 'utf8'));
  }
  return canonicalModel;
}

const STRUCTURE_FIX = 'Restore it from templates/eslint.config.mjs. An exception is a new block that names exact files (references/eslint-config-guide.md, "Adding an exception"); any other change is a stop-and-ask decision with a Gate-Change trailer.';
/** The canonical file groups: the const arrays the canonical blocks name in files or ignores. */
const groupsOf = (model) => [...new Set(model.items.filter((item) => item.kind === 'block').flatMap((block) => [...(block.files?.units ?? []), ...(block.ignores?.units ?? [])]).map((entry) => entry.group).filter((group) => group !== null))];

/** Each canonical file group keeps its globs; an exemption group adds only exact file names. */
function checkFileGroups(canonical, app, spec, report) {
  const widening = new Set(spec.structure.wideningGroups);
  for (const group of groupsOf(canonical)) {
    const want = canonical.constGlobs(group).globs;
    const decl = app.consts.get(group);
    const got = decl === undefined ? null : app.constGlobs(group);
    if (decl === undefined || got === null) {
      report.problem({ file: spec.file, line: decl?.line ?? 1, rule: 'eslint-weakened', message: `the file group ${group} is ${decl === undefined ? 'not declared' : 'not a list of glob strings the checker can read'} [file-group]`, fix: `Declare it as templates/eslint.config.mjs does: const ${group} = [${want.map((glob) => `'${glob}'`).join(', ')}];` });
      continue;
    }
    for (const glob of want.filter((entry) => !got.globs.includes(entry))) {
      report.problem({ file: spec.file, line: decl.line, rule: 'eslint-weakened', message: `the file group ${group} lacks '${glob}', so its rules no longer reach those files [file-group]`, fix: `Put '${glob}' back; ${group} is [${want.map((entry) => `'${entry}'`).join(', ')}] in templates/eslint.config.mjs.` });
    }
    if (widening.has(group)) continue;
    for (const glob of got.globs.filter((entry) => !want.includes(entry) && !isExactGlob(entry))) {
      report.problem({ file: spec.file, line: decl.line, rule: 'eslint-weakened', message: `the file group ${group} adds '${glob}', which reaches a whole folder; an exemption group adds only exact file names [file-group]`, fix: 'List the one file the tool or library contract needs (src/services/<concern>/<library>-<concern>-adapter.ts). A wider exemption is a stop-and-ask decision with a Gate-Change trailer.' });
    }
  }
}

/** The first place two normalized texts differ, as a short excerpt of each. */
function firstDifference(want, got) {
  let at = 0;
  while (at < want.length && at < got.length && want[at] === got[at]) at += 1;
  const cut = (text) => (text.length - at > 48 ? `${text.slice(at, at + 48)}...` : text.slice(at)) || '(end)';
  return `expected ${JSON.stringify(cut(want))}, found ${JSON.stringify(cut(got))}`;
}

/** Shared lists and helpers stay verbatim; the vendor and banned lists may only grow. */
function checkConsts(canonical, app, spec, report) {
  const groups = new Set(groupsOf(canonical));
  const knobs = new Set(spec.structure.knobs);
  const supersets = new Set(spec.structure.supersets);
  for (const [name, want] of canonical.consts) {
    if (groups.has(name) || knobs.has(name)) continue;
    const got = app.consts.get(name);
    if (got === undefined) {
      report.problem({ file: spec.file, line: 1, rule: 'eslint-weakened', message: `the shared const ${name} is not declared [canonical-const]`, fix: STRUCTURE_FIX });
      continue;
    }
    if (supersets.has(name)) {
      const elements = (model, decl) => {
        const range = model.trimRange(decl.valueStart, decl.valueEnd);
        return model.elementsOf(range.start).items.map((item) => model.norm(item.start, item.end));
      };
      const have = new Set(elements(app, got));
      for (const entry of elements(canonical, want).filter((item) => !have.has(item))) {
        report.problem({ file: spec.file, line: got.line, rule: 'eslint-weakened', message: `${name} lacks the canonical entry ${entry} [canonical-const]`, fix: `Put it back: ${name} may gain entries (a new SDK, a new ban) but never lose one.` });
      }
      continue;
    }
    if (got.text !== want.text) {
      report.problem({ file: spec.file, line: got.line, rule: 'eslint-weakened', message: `the shared const ${name} differs from templates/eslint.config.mjs (${firstDifference(want.text, got.text)}) [canonical-const]`, fix: STRUCTURE_FIX });
    }
  }
}

/** The units of an extra block that reach more than named files ('**' for a block without files). */
function wideUnits(block, canonicalExact) {
  if (block.files === null) return { wide: ['**'], unresolved: [] };
  const wide = [];
  for (const entry of block.files.units) {
    if (entry.group !== null && canonicalExact.has(entry.group)) {
      if (!canonicalExact.get(entry.group)) wide.push(entry.group);
    } else for (const glob of entry.globs.filter((value) => !isExactGlob(value))) wide.push(`'${glob}'`);
  }
  return { wide, unresolved: block.files.unresolved };
}

/**
 * Every canonical block is present, unchanged and in order; every other block names exact files. A
 * later block replaces a rule's options for its files, so a new folder-wide block (or a changed scope)
 * can drop any ban, however it is spelled.
 */
function checkBlocks(canonical, app, spec, report, multiPackage) {
  const groupExact = new Map(groupsOf(canonical).map((group) => [group, canonical.constGlobs(group).globs.every(isExactGlob)]));
  const keyOf = (item) => (item.kind === 'block' ? `block:${scopeKey(item)}` : `other:${item.head}`);
  const equal = (want, got) => (want.kind === 'block' ? blockDifferences(want, got, { multiPackage }).length === 0 : want.head === 'globalIgnores' || want.text === got.text);
  const used = new Set();
  let next = 0;
  const firstLine = app.arrayRange ? app.scan.lineOf(app.arrayRange.start) : 1;
  for (const want of canonical.items) {
    const key = keyOf(want);
    const candidates = app.items.map((item, index) => ({ item, index })).filter(({ item, index }) => !used.has(index) && keyOf(item) === key);
    const exact = candidates.find(({ item, index }) => index >= next && equal(want, item));
    if (exact) {
      used.add(exact.index);
      next = exact.index + 1;
      continue;
    }
    const label = want.kind === 'block' ? `the block for ${scopeLabel(want)}${want.rules.size > 0 ? ` (rules ${[...want.rules.keys()].slice(0, 3).join(', ')}${want.rules.size > 3 ? ', ...' : ''})` : ''}` : `the config item ${want.head}`;
    const changed = candidates.find(({ item, index }) => index >= next && want.kind === 'block' && sameBlockFamily(want, item));
    if (changed) {
      used.add(changed.index);
      next = changed.index + 1;
      const differences = blockDifferences(want, changed.item, { multiPackage });
      report.problem({ file: spec.file, line: changed.item.line, rule: 'eslint-weakened', message: `${label} differs from templates/eslint.config.mjs: it ${differences.slice(0, 3).join(', ')} [canonical-block]`, fix: STRUCTURE_FIX });
      continue;
    }
    const moved = candidates.find(({ item }) => equal(want, item));
    if (moved) {
      used.add(moved.index);
      report.problem({ file: spec.file, line: moved.item.line, rule: 'eslint-weakened', message: `${label} is out of order: a later block replaces an earlier one's options, so the order is part of the config [canonical-block]`, fix: 'Move it back to its place in templates/eslint.config.mjs.' });
      continue;
    }
    report.problem({ file: spec.file, line: firstLine, rule: 'eslint-weakened', message: `${label} is missing or its files/ignores changed [canonical-block]`, fix: STRUCTURE_FIX });
  }
  app.items.forEach((item, index) => {
    if (used.has(index)) return;
    if (item.kind !== 'block') {
      report.problem({ file: spec.file, line: item.line, rule: 'eslint-weakened', message: `defineConfig lists ${item.head}, which is not a canonical config item; a shared config can switch any rule off for every file [config-item]`, fix: 'Remove it. Only the canonical items, the canonical blocks and blocks that name exact files belong in defineConfig([...]).' });
      return;
    }
    const { wide, unresolved } = wideUnits(item, groupExact);
    for (const text of unresolved) {
      report.problem({ file: spec.file, line: item.filesLine ?? item.line, rule: 'eslint-weakened', message: `a block's files value ${text} cannot be resolved to globs [exemption-scope]`, fix: "Write the files as string literals or a const array of them: files: ['src/i18n/direction.ts']." });
    }
    for (const unit of wide) {
      const where = unit === '**' ? 'every file (a block without files)' : `every file under ${unit}`;
      report.problem({ file: spec.file, line: item.filesLine ?? item.line, rule: 'eslint-weakened', message: `a block beyond the canonical ones reaches ${where}; it replaces those files' rule options [exemption-scope]`, fix: 'Name the exact file the tool or library contract needs (src/services/<concern>/<library>-<concern>-adapter.ts, src/i18n/direction.ts). A folder-wide block is a stop-and-ask decision with a Gate-Change trailer.' });
    }
  });
}

/** Mutations of a shared list (RESTRICTED_PROPERTIES.length = 0, SYNTAX.x.selector = ..., push, splice, delete). */
const MUTATIONS = [
  /[.\]][A-Za-z_$][\w$]*\s*(?:[-+*/%&|^?]{1,3})?=(?![=>])|\]\s*(?:[-+*/%&|^?]{1,3})?=(?![=>])/g,
  /\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\s*\(/g,
  /\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\s*\.)/g,
  /\bdelete\s|\+\+|--/g,
];
const TOP_LEVEL = /^(?:import\s|const\s|export default defineConfig\(|[\])};,]+\s*$)/;

function checkStatements(app, spec, report) {
  const { code } = app.scan;
  for (const pattern of MUTATIONS) {
    for (const match of code.matchAll(pattern)) {
      report.problem({ file: spec.file, line: app.scan.lineOf(match.index), rule: 'eslint-weakened', message: `${match[0].trim()} mutates a value the config shares [side-effect]`, fix: 'Remove it: the shared lists are read by every block, so a mutation changes rules far from where it is written.' });
    }
  }
  code.split('\n').forEach((line, index) => {
    if (/^\S/.test(line) && !TOP_LEVEL.test(line)) {
      report.problem({ file: spec.file, line: index + 1, rule: 'eslint-weakened', message: `the top-level statement ${JSON.stringify(line.trim().slice(0, 40))} is not an import, a const or the config [top-level-statement]`, fix: 'Remove it; the config holds imports, const declarations and export default defineConfig([...]) only.' });
    }
  });
}

/** The structural comparison with templates/eslint.config.mjs (the canonical blocks, groups and lists). */
function checkStructure(text, spec, report, root, layout) {
  const app = configModel(text, { prefixes: workspacePrefixes(root, layout) });
  const canonical = canonicalEslint();
  checkFileGroups(canonical, app, spec, report);
  checkConsts(canonical, app, spec, report);
  checkBlocks(canonical, app, spec, report, layout.mode === 'monorepo');
  checkStatements(app, spec, report);
}

function checkEslint(root, layout, report) {
  const spec = BASELINE.eslint;
  const path = join(root, spec.file);
  if (!existsSync(path)) {
    report.problem({ file: spec.file, rule: 'eslint-missing', message: 'eslint.config.mjs does not exist', fix: 'Copy templates/eslint.config.mjs to the repo root.' });
    return;
  }
  const scan = scanSource(readFileSync(path, 'utf8'));
  const code = scan.codeKeep;
  for (const item of spec.required) {
    if (!new RegExp(item.pattern, 'm').test(code)) {
      report.problem({ file: spec.file, rule: 'eslint-required', message: `missing ${item.what} [${item.id}]`, fix: 'Restore it from templates/eslint.config.mjs; the canonical config is the only place rules live.' });
    }
  }
  checkLimits(scan, spec, report);
  checkGlobalIgnores(scan, spec, report, ignoreScope(root, layout));
  checkStructure(readFileSync(path, 'utf8'), spec, report, root, layout);
  // Every rule switched off, in any spelling: 'rule': 'off', 'rule': ['off'], 'rule': 0, bare: 'off'.
  const offHits = new Map();
  const offPattern = /(?:(['"])([^'"\n]+)\1\s*:\s*(?:\[\s*)?(?:'off'|"off"|0)|(?<![\w$'".-])([A-Za-z_$][\w$]*)\s*:\s*(?:\[\s*)?(?:'off'|"off"))(?![\w.])/g;
  for (const match of code.matchAll(offPattern)) {
    const name = match[2] ?? match[3];
    offHits.set(name, [...(offHits.get(name) ?? []), match.index]);
  }
  for (const [name, hits] of offHits) {
    const allowed = spec.offAllowed[name] ?? 0;
    if (hits.length > allowed) {
      report.problem({ file: spec.file, line: scan.lineOf(hits[allowed] ?? hits[0]), rule: 'eslint-rule-off', message: `${name} is switched off ${hits.length} times; the canonical config does it ${allowed} times`, fix: 'Remove the extra "off"; fix the code, or add a file-exact exception block that rebuilds the rule from the shared lists.' });
    }
  }
  for (const item of spec.maxOccurrences) {
    const hits = [...code.matchAll(new RegExp(item.pattern, 'g'))];
    if (hits.length > item.max) {
      report.problem({ file: spec.file, line: scan.lineOf(hits[item.max].index), rule: 'eslint-weakened', message: `${item.what} appears ${hits.length} times; the canonical config has ${item.max} [${item.id}]`, fix: item.fix ?? 'Remove it; exceptions name single files and rebuild the rule from the shared lists.' });
    }
  }
  // A severity is the value of a rule key; no-console's { allow: ['warn', 'error'] } is not one.
  for (const match of code.matchAll(/(?:(['"])([^'"\n]+)\1|([A-Za-z_$][\w$]*))\s*:\s*(\[\s*)?(['"])warn\5/g)) {
    if (match[3] === 'allow') continue;
    report.problem({ file: spec.file, line: scan.lineOf(match.index), rule: 'eslint-warn', message: 'a rule uses the "warn" severity', fix: "Use 'error': every rule is an error and lint runs with --max-warnings 0." });
  }
  // The numeric spelling of warn: 'rule-name': 1 or 'rule-name': [1, ...].
  for (const match of code.matchAll(/(['"])([^'"\n]*[-/][^'"\n]*)\1\s*:\s*(?:\[\s*)?1(?![\w.])/g)) {
    report.problem({ file: spec.file, line: scan.lineOf(match.index), rule: 'eslint-warn', message: `${match[2]} uses severity 1 (warn)`, fix: "Use 'error': every rule is an error and lint runs with --max-warnings 0." });
  }
  for (const name of spec.forbiddenImports) {
    const at = code.indexOf(`'${name}'`);
    if (at !== -1) report.problem({ file: spec.file, line: scan.lineOf(at), rule: 'eslint-forbidden-import', message: `imports ${name}`, fix: 'Prettier runs as its own check (format:check); eslint-config-prettier only turns conflicting rules off.' });
  }
  checkPreExistingList(scan, spec, report, ignoreScope(root, layout));
}

const IGNORE_APP_CODE_FIX =
  'Remove it: app code (src/, test/, __mocks__/, scripts/, plugins/, app.config.ts, the workspaces and every ' +
  'rn-skills.config.json "layoutEntries" item) is always linted, formatted and type-checked. Code the app imports ' +
  'moves under src/ or is declared in "layoutEntries"; only folders that are not app code go in the ignore lists.';
const scopes = new Map();

/** What counts as app code in this repo, computed once per root. */
function ignoreScope(root, layout) {
  if (!scopes.has(root)) {
    const tops = appTops(layout, BASELINE.appScope.fixed);
    const native = nativeScope(root, layout);
    let files = null;
    scopes.set(root, {
      fix: IGNORE_APP_CODE_FIX,
      covers: (entry, style) => {
        files ??= appFiles(root, tops);
        return coversAppCode(entry, { style, tops, files, native });
      },
    });
  }
  return scopes.get(root);
}

/** PRE_EXISTING lists folders that predate the app; none of its globs may reach app code. */
function checkPreExistingList(scan, spec, report, scope) {
  const decl = /const PRE_EXISTING\s*=\s*\[/.exec(scan.code);
  if (!decl) return;
  const open = decl.index + decl[0].length - 1;
  const globs = globsOf(scan, open, matchBracket(scan.code, open));
  for (const glob of globs) {
    const covers = scope.covers(glob, 'anchored');
    if (!covers) continue;
    const literal = scan.strings.find((entry) => entry.index > open && entry.value === glob);
    report.problem({ file: spec.file, line: scan.lineOf(literal?.index ?? decl.index), rule: 'ignore-app-code', message: `PRE_EXISTING lists '${glob}', which ${covers.reason}, so ESLint and check-source skip app code`, fix: scope.fix });
  }
}

/** .prettierignore lines and root tsconfig.json exclude entries beyond the canonical ones may not reach app code. */
function checkIgnoreLists(root, layout, wants, report) {
  const scope = ignoreScope(root, layout);
  if (wants('prettier') && existsSync(join(root, BASELINE.prettierIgnore.file))) {
    const canonical = new Set([...BASELINE.prettierIgnore.canonicalLines, BASELINE.prettierIgnore.placeholder]);
    readFileSync(join(root, BASELINE.prettierIgnore.file), 'utf8').split('\n').forEach((raw, index) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#') || line.startsWith('!') || canonical.has(line)) return;
      const covers = scope.covers(line, 'gitignore');
      if (covers) report.problem({ file: BASELINE.prettierIgnore.file, line: index + 1, rule: 'ignore-app-code', message: `the line ${line} ${covers.reason}, so format:check skips app code`, fix: scope.fix });
    });
  }
  const exclude = wants('tsconfig') ? rootExclude(root) : null;
  if (exclude !== null) {
    const canonical = new Set(BASELINE.programs[0].excludeCanonical.map((entry) => fillPath(entry, layout, 'tsconfig.json')));
    const text = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    for (const entry of exclude.filter((value) => !canonical.has(value))) {
      const covers = scope.covers(entry, 'anchored');
      const at = text.indexOf(JSON.stringify(entry));
      if (covers) report.problem({ file: 'tsconfig.json', line: at === -1 ? 1 : text.slice(0, at).split('\n').length, rule: 'ignore-app-code', message: `exclude lists "${entry}", which ${covers.reason}, so npm run typecheck skips app code`, fix: scope.fix });
    }
  }
}

const strayArea = (name) => (name.includes('eslint') ? 'eslint' : name.includes('knip') ? 'knip' : 'prettier');

/** Prettier reads package.json and package.yaml before .prettierrc.json, and a nested config wins for the files below it. */
function checkPackageStrays(root, layout, wants, report) {
  const seen = new Set();
  const prettierNames = BASELINE.strayConfigs.filter((name) => strayArea(name) === 'prettier');
  const tops = appTops(layout, BASELINE.appScope.fixed);
  const nested = walkRepo(root, { include: ['package.json', 'package.yaml', '.prettierrc.json', ...prettierNames] }).filter((rel) => rel === 'package.json' || rel === 'package.yaml' || tops.has(rel.split('/')[0]));
  for (const rel of nested) {
    const base = posix.basename(rel);
    if (base === 'package.json') {
      const { data } = readJson(root, rel);
      for (const [key, area] of Object.entries(BASELINE.strayPackageKeys)) {
        if (data === undefined || data === null || typeof data !== 'object' || !(key in data) || !wants(area)) continue;
        seen.add(`${rel}#${key}`);
        report.problem({ file: rel, line: 1, rule: 'config-stray', message: `the "${key}" key is a second ${area} config${area === 'prettier' ? ' (Prettier reads package.json before .prettierrc.json)' : ''}`, fix: `Delete the key; the only config is ${{ eslint: 'eslint.config.mjs', prettier: '.prettierrc.json', knip: 'knip.json' }[area]} at the repo root.` });
      }
    } else if (base === 'package.yaml') {
      if (wants('prettier') && /^prettier\s*:/m.test(readFileSync(join(root, rel), 'utf8'))) report.problem({ file: rel, line: 1, rule: 'config-stray', message: 'the prettier key in package.yaml is a second Prettier config (Prettier reads it before .prettierrc.json)', fix: 'Delete the key; the only config is .prettierrc.json at the repo root.' });
    } else if (rel.includes('/') && wants('prettier') && !layout.workspaces.some((workspace) => rel === `${workspace.dir}/${base}`)) {
      report.problem({ file: rel, line: 1, rule: 'config-stray', message: `${rel} is a nested Prettier config: Prettier resolves the config per folder, so it wins for every file below it`, fix: 'Delete it; the only config is .prettierrc.json at the repo root.' });
    }
  }
}

function checkStray(root, layout, wants, report) {
  checkPackageStrays(root, layout, wants, report);
  for (const name of BASELINE.strayConfigs) {
    if (!wants(strayArea(name)) || !existsSync(join(root, name))) continue;
    const main = { eslint: 'eslint.config.mjs', prettier: '.prettierrc.json and .prettierignore', knip: 'knip.json' }[strayArea(name)];
    report.problem({ file: name, rule: 'config-stray', message: `${name} is a second ${strayArea(name)} config`, fix: `Delete it; the only config is ${main} at the repo root.` });
  }
  for (const workspace of layout.workspaces) {
    for (const name of BASELINE.workspaceStrayConfigs) {
      if (!wants(strayArea(name)) || !existsSync(join(root, workspace.dir, name))) continue;
      report.problem({ file: `${workspace.dir}/${name}`, rule: 'config-stray', message: `a workspace has its own ${strayArea(name)} config`, fix: 'Delete it; one config at the repo root covers every workspace.' });
    }
  }
}

function checkPrettier(root, report) {
  const spec = BASELINE.prettier;
  if (!existsSync(join(root, spec.file))) {
    report.problem({ file: spec.file, rule: 'prettier-option', message: '.prettierrc.json does not exist', fix: 'Copy templates/dot-prettierrc.json to .prettierrc.json at the repo root.' });
    return;
  }
  const { data, error } = readJson(root, spec.file);
  if (error) {
    report.problem({ file: spec.file, line: 1, rule: 'prettier-option', message: `is not valid JSON (${error})`, fix: 'Restore it from templates/dot-prettierrc.json.' });
    return;
  }
  for (const [key, want] of Object.entries(spec.options)) {
    if (!same(data[key], want)) {
      report.problem({ file: spec.file, line: 1, rule: 'prettier-option', message: `${key} is ${show(data[key])}, expected ${show(want)}`, fix: `Set "${key}": ${show(want)}.` });
    }
  }
}

function ignoreLines(root) {
  const path = join(root, BASELINE.prettierIgnore.file);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
}

function checkPrettierIgnore(root, layout, report) {
  const spec = BASELINE.prettierIgnore;
  const lines = ignoreLines(root);
  if (lines === null) {
    report.problem({ file: spec.file, rule: 'prettier-ignore', message: '.prettierignore does not exist', fix: 'Copy templates/dot-prettierignore to .prettierignore and replace __PRE_EXISTING__ with one line per pre-existing top-level entry.' });
    return;
  }
  for (const line of spec.requiredLines) {
    if (!lines.includes(line)) report.problem({ file: spec.file, line: 1, rule: 'prettier-ignore', message: `.prettierignore lacks "${line}"`, fix: `Add the line ${line} (templates/dot-prettierignore): Prettier must not reformat generated, vendored or skill files.` });
  }
  if (lines.includes(spec.placeholder)) report.problem({ file: spec.file, line: 1, rule: 'prettier-ignore', message: `.prettierignore still holds the ${spec.placeholder} placeholder`, fix: 'Replace it with one line per pre-existing top-level entry (handbook/, notes.md), or delete it when there is none.' });
  checkWorkspaceNative(root, layout, lines, report);
}

/** Whether a .prettierignore line (gitignore semantics) ignores the folder `<dir>/<native>/`. */
function ignoresFolder(line, dir, native) {
  const clean = line.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/\*\*$/, '');
  const unanchored = !line.replace(/\/+$/, '').includes('/');
  if (unanchored) return clean === native;
  if (clean === `**/${native}`) return true;
  return clean.endsWith(`/${native}`) && globToRegExp(clean.slice(0, -native.length - 1)).test(dir);
}

/**
 * When multi-package, prebuild writes apps/<app>/ios and apps/<app>/android, which the anchored /ios/ and
 * /android/ lines do not reach; Prettier reads only the root .prettierignore and .gitignore, so
 * format:check would fail on Xcode's JSON after the first local build.
 */
function checkWorkspaceNative(root, layout, lines, report) {
  for (const dir of nativeScope(root, layout).appDirs) {
    for (const native of ['ios', 'android']) {
      if (lines.some((line) => !line.startsWith('!') && ignoresFolder(line, dir, native))) continue;
      report.problem({ file: BASELINE.prettierIgnore.file, line: 1, rule: 'prettier-ignore', message: `no line ignores ${dir}/${native}/, the native project prebuild generates for that Expo app workspace`, fix: `Add the line ${dir.includes('/') ? `${dir.split('/')[0]}/*` : dir}/${native}/ next to /${native}/ (references/eslint-config-guide.md, When multi-package).` });
    }
  }
}

/** appTopLevel entries with a `*` (`*.d.ts`) match a name; the rest are exact names. */
const TOP_LEVEL_PATTERNS = BASELINE.appTopLevel.filter((entry) => entry.includes('*')).map((entry) => new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`));

/** Top-level entries outside the app layout: knowledge folders, design exports, notes that predate the app. */
function preExistingEntries(root, layout) {
  // Stray configs are reported by config-stray, not as pre-existing entries.
  const known = new Set([...BASELINE.appTopLevel, ...BASELINE.strayConfigs]);
  const keys = ['srcDir', 'routesDir', 'testDir', 'mocksDir', 'scriptsDir', 'e2eDir', 'contractsDir'];
  for (const key of keys) known.add(layout[key].split('/')[0]);
  for (const workspace of layout.workspaces) known.add(workspace.dir.split('/')[0]);
  for (const entry of Array.isArray(layout.config.layoutEntries) ? layout.config.layoutEntries : []) known.add(String(entry).replace(/\/+$/, ''));
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !known.has(entry.name) && !TOP_LEVEL_PATTERNS.some((pattern) => pattern.test(entry.name)))
    .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

// Prettier only formats files it has a parser for, ESLint only lints JS/TS files, and the root program's
// include ("**/*.ts", "**/*.tsx") reads every .ts and .tsx file that its exclude does not name.
const PRETTIER_FILE = /\.(md|mdx|html?|json5?|jsonc|ya?ml|css|scss|less|[cm]?[jt]sx?|graphql|gql|hbs|vue)$/i;
const ESLINT_FILE = /\.[cm]?[jt]sx?$/i;
const TSC_FILE = /\.tsx?$/i;

/** True when a pre-existing entry is (or holds) a file the root program would type-check. */
function holdsTypeScript(root, entry) {
  if (!entry.isDir) return TSC_FILE.test(entry.name);
  return walk(join(root, entry.name), { include: ['*.ts', '*.tsx'] }).length > 0;
}

/** The root tsconfig.json exclude list, or null when the file is missing or invalid (tsconfig rules report it). */
function rootExclude(root) {
  if (!existsSync(join(root, 'tsconfig.json'))) return null;
  const { data, error } = readJson(root, 'tsconfig.json');
  if (error) return null;
  return Array.isArray(data?.exclude) ? data.exclude.map(String) : [];
}

function checkPreExisting(root, layout, wants, report) {
  const entries = preExistingEntries(root, layout);
  if (entries.length === 0) return;
  const lines = wants('prettier') ? ignoreLines(root) : null;
  const eslintPath = join(root, BASELINE.eslint.file);
  const eslint = !wants('eslint') || !existsSync(eslintPath) ? null : scanSource(readFileSync(eslintPath, 'utf8')).codeKeep;
  const exclude = wants('tsconfig') ? rootExclude(root) : null;
  for (const entry of entries) {
    const shown = entry.isDir ? `${entry.name}/` : entry.name;
    const what = `the pre-existing ${entry.isDir ? 'folder' : 'file'} ${shown}`;
    // A JS/TS file at the root is usually a tool config the app uses, and a folder holding code (an older
    // template's components/ or hooks/) is usually app code: the fix leads with keeping them checked.
    const isCode = !entry.isDir && ESLINT_FILE.test(entry.name);
    const holdsCode = entry.isDir && walk(join(root, entry.name), { include: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs'] }).length > 0;
    const declare = isCode
      ? `When the app uses it (a tool config or code), declare "${entry.name}" in rn-skills.config.json "layoutEntries" so it stays linted and formatted; otherwise `
      : holdsCode
        ? `${shown} holds code. When the app imports it, move it under src/ (or declare "${entry.name}" in rn-skills.config.json "layoutEntries") so it stays linted, formatted and type-checked; only when it is not app code, `
        : '';
    const orDeclare = isCode || holdsCode ? '' : ', or declare it in rn-skills.config.json "layoutEntries" when it is app code';
    const forms = [entry.name, `${entry.name}/`, `/${entry.name}`, `/${entry.name}/`, `${entry.name}/**`, `/${entry.name}/**`];
    if (lines !== null && (entry.isDir || PRETTIER_FILE.test(entry.name)) && !forms.some((form) => lines.includes(form))) {
      report.problem({ file: '.prettierignore', line: 1, rule: 'ignore-pre-existing', message: `${what} is not ignored, so format:check would reformat the developer's files`, fix: `${declare}${declare ? 'add' : 'Add'} the line ${shown} to .prettierignore${orDeclare}.` });
    }
    const glob = entry.isDir ? `${entry.name}/**` : entry.name;
    if (eslint !== null && (entry.isDir || ESLINT_FILE.test(entry.name)) && !eslint.includes(`'${glob}'`) && !eslint.includes(`'${entry.name}'`)) {
      report.problem({ file: BASELINE.eslint.file, line: 1, rule: 'ignore-pre-existing', message: `${what} is not in PRE_EXISTING, so ESLint would lint it`, fix: `${declare}${declare ? 'add' : 'Add'} '${glob}' to the PRE_EXISTING list in eslint.config.mjs (a Gate-Change: trailer)${orDeclare}.` });
    }
    const tsForms = [entry.name, `./${entry.name}`, `${entry.name}/`, `./${entry.name}/`, `${entry.name}/**`, `./${entry.name}/**`, `${entry.name}/**/*`, `./${entry.name}/**/*`];
    if (exclude !== null && !tsForms.some((form) => exclude.includes(form)) && holdsTypeScript(root, entry)) {
      report.problem({ file: 'tsconfig.json', line: 1, rule: 'ignore-pre-existing', message: `${what} ${entry.isDir ? 'holds .ts/.tsx files but is' : 'is'} not in the root tsconfig.json "exclude", so npm run typecheck would type-check it under the strict set`, fix: `${declare}${declare ? 'add' : 'Add'} "${entry.name}" to "exclude" in tsconfig.json (next to "skills")${orDeclare}.` });
    }
  }
}

function checkKnip(root, layout, report) {
  const spec = BASELINE.knip;
  if (!existsSync(join(root, spec.file))) {
    report.problem({ file: spec.file, rule: 'knip-config', message: 'knip.json does not exist', fix: 'Copy templates/knip.json to the repo root (npm run check:unused runs it).' });
    return;
  }
  const { data, error } = readJson(root, spec.file);
  if (error) {
    report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `is not valid JSON (${error})`, fix: 'Restore it from templates/knip.json.' });
    return;
  }
  for (const key of spec.forbiddenKeys.filter((name) => name in data)) {
    report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `"${key}" filters the issue types knip reports (${show(data[key])})`, fix: `Remove "${key}": every issue type is reported and every rule is "${spec.severity}"; delete the unused code instead.` });
  }
  const scope = ignoreScope(root, layout);
  for (const key of spec.ignoreKeys.filter((name) => name in data)) {
    const value = data[key];
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.keys(value) : [];
    for (const entry of entries) {
      const covers = scope.covers(String(entry), 'anchored');
      if (covers) report.problem({ file: spec.file, line: 1, rule: 'ignore-app-code', message: `${key} lists '${entry}', which ${covers.reason}, so npm run check:unused skips app code`, fix: scope.fix });
    }
  }
  if (layout.mode === 'single') {
    for (const key of ['entry', 'project']) {
      const have = Array.isArray(data[key]) ? data[key] : [];
      for (const glob of spec[key].filter((entry) => !have.includes(entry))) {
        report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `${key} lacks "${glob}"`, fix: `Put it back (templates/knip.json): a narrower ${key} hides dead code.` });
      }
    }
    // An entry's exports count as used, so a folder-wide entry hides every unused export under it.
    for (const glob of (Array.isArray(data.entry) ? data.entry : []).filter((entry) => !spec.entry.includes(entry) && !isExactGlob(entry))) {
      report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `entry adds "${glob}"; every export of an entry file counts as used, so knip stops reporting dead exports there`, fix: 'List the exact file a tool loads by path (a config plugin), or tag its export /** @public */.' });
    }
  }
  const rules = data.rules ?? {};
  for (const name of spec.requiredRules) {
    if (!(name in rules)) report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `rules.${name} is missing`, fix: `Add "${name}": "${spec.severity}" (templates/knip.json).` });
  }
  for (const [name, value] of Object.entries(rules)) {
    if (value !== spec.severity) report.problem({ file: spec.file, line: 1, rule: 'knip-config', message: `rules.${name} is ${show(value)}; every knip rule is "${spec.severity}"`, fix: `Set "${name}": "${spec.severity}"; delete the unused code instead of hiding it.` });
  }
}

function checkPackage(root, report) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const [name, allowed] of Object.entries(BASELINE.pins)) {
    const got = deps[name];
    if (got === undefined) {
      report.problem({ file: 'package.json', line: 1, rule: 'package-pin', message: `${name} is not in package.json`, fix: `npm install -D -E ${name}@${allowed[0]} (the verified version).` });
    } else if (!allowed.includes(got)) {
      report.problem({ file: 'package.json', line: 1, rule: 'package-pin', message: `${name} is "${got}", expected ${allowed.map((v) => `"${v}"`).join(' or ')}`, fix: `Pin ${name} to exactly ${allowed[0]} (the verified set). An upgrade is a deliberate change: stop and ask.` });
    }
  }
  const held = BASELINE.packageOverrides;
  const want = BASELINE.pins[held.pin][0];
  const loose = held.packages.filter((name) => pkg.overrides?.[name] !== want);
  if (loose.length > 0) {
    report.problem({ file: 'package.json', line: 1, rule: 'package-overrides', message: `overrides do not hold ${loose.length} of ${held.packages.length} @typescript-eslint/* packages at ${want} (${loose.join(', ')})`, fix: `Add "overrides": { "<package>": "${want}" } for all ten @typescript-eslint/* packages (references/eslint-config-guide.md, "Versions and install"): a second copy fails with Cannot redefine plugin "@typescript-eslint".` });
  }
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    checkExitCode(name, String(command), report);
    for (const segment of String(command).split(/&&|\|\||;|\|/).filter((part) => /(^|\s)(npx\s+)?eslint\s/.test(` ${part} `))) {
      if (/--fix\b/.test(segment)) continue;
      for (const flag of BASELINE.lintScript.requires) {
        if (!segment.includes(flag)) report.problem({ file: 'package.json', line: 1, rule: 'lint-script', message: `script "${name}" runs eslint without ${flag}`, fix: `Add ${flag}: a warning must fail the run.` });
      }
      for (const flag of BASELINE.lintScript.forbids) {
        if (` ${segment} `.includes(flag.startsWith(' ') ? flag : ` ${flag}`)) report.problem({ file: 'package.json', line: 1, rule: 'lint-script', message: `script "${name}" passes ${flag.trim()} to eslint`, fix: 'Remove it; CLI overrides bypass eslint.config.mjs and the guardrail cannot see them.' });
      }
      const targets = lintTargets(segment);
      if (targets.length !== 1 || targets[0].replace(/\/$/, '') !== BASELINE.lintScript.target) {
        report.problem({ file: 'package.json', line: 1, rule: 'lint-script', message: `script "${name}" lints ${targets.length === 0 ? 'no path' : targets.join(' ')} instead of ${BASELINE.lintScript.target}`, fix: `Lint the whole repo (eslint ${BASELINE.lintScript.target} --max-warnings 0): a narrower target skips app.config.ts, plugins/, scripts/ and tests, and eslint.config.mjs already says what is ignored.` });
      }
    }
  }
}

/**
 * An eslint command followed by `||`, `;`, a pipe or `&` loses its exit code: the script's status is the
 * next command's (a pipe without pipefail reports the last command), so the gate is always green.
 */
function checkExitCode(name, command, report) {
  const parts = command.split(/(&&|\|\||;|\||&)/);
  for (let i = 0; i < parts.length; i += 2) {
    if (!/(^|\s)(npx\s+)?eslint\s/.test(` ${parts[i]} `) || /--fix\b/.test(parts[i])) continue;
    const after = parts[i + 1];
    if (after === undefined || after === '&&') continue;
    report.problem({ file: 'package.json', line: 1, rule: 'lint-script', message: `script "${name}" swallows eslint's exit code (eslint ... ${after} ${(parts[i + 2] ?? '').trim()})`, fix: 'Let eslint end the command or chain the next one with &&: after ||, ;, & or a pipe the script reports the other command\'s status, so lint errors no longer fail the gate.' });
  }
}

/** The path arguments of one eslint command (flags and their values left out). */
function lintTargets(segment) {
  const words = segment.trim().split(/\s+/);
  const targets = [];
  for (let i = words.indexOf('eslint') + 1; i > 0 && i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('-')) {
      if (!word.includes('=') && BASELINE.lintScript.valueFlags.includes(word)) i += 1;
      continue;
    }
    targets.push(word.replace(/^['"]|['"]$/g, ''));
  }
  return targets;
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (options.only !== undefined && !AREAS.includes(options.only)) {
    fail(`--only ${options.only} is not an area`, `Use one of: ${AREAS.join(', ')}.`);
  }
  if (!existsSync(join(root, 'package.json')) || !statSync(join(root, 'package.json')).isFile()) {
    fail(`nothing to check: ${root} has no package.json`, 'Run from the app repo root, or pass it as the argument.');
  }
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  const area = options.only;
  const wants = (name) => area === undefined || area === name;
  const report = createReporter({ name: 'check-configs', json: options.json });
  const steps = {
    tsconfig: () => checkTsconfigs(root, layout, report),
    eslint: () => checkEslint(root, layout, report),
    prettier: () => {
      checkPrettier(root, report);
      checkPrettierIgnore(root, layout, report);
    },
    package: () => checkPackage(root, report),
    knip: () => checkKnip(root, layout, report),
  };
  const areas = AREAS.filter(wants);
  for (const name of areas) steps[name]();
  if (wants('eslint') || wants('prettier') || wants('tsconfig')) checkPreExisting(root, layout, wants, report);
  checkIgnoreLists(root, layout, wants, report);
  checkStray(root, layout, wants, report);
  return report.finish({ checked: areas.length, unit: 'config areas' });
});
