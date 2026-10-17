#!/usr/bin/env node
// scaffold-feature.mjs: stands up one Expo Router screen feature from this skill's templates: the thin
// route, the pure view, the model hook, their tests and the route test (a dynamic route also gets its
// params parser and an invalid-link state), the message keys in every catalog, and the feature's
// entries in contracts/navigation.json and contracts/screens.json. Dry run by default (prints the
// plan); --write writes it. It never overwrites a file that differs. Zero dependencies.
// Run from the app repo root:
//   node ${CLAUDE_SKILL_DIR}/scripts/scaffold-feature.mjs . --feature notes --route "(app)/notes" --title "Notes" [--write]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, maskComments, parseArgs, parseJsonc, resolveLayout, run, UsageError, walk } from './check-lib.mjs';
import { findStarter, isLanguageTag, sourceLanguageOf } from './lib/feature-app.mjs';
import { formatJson } from './lib/json-format.mjs';

const SPEC = {
  name: 'scaffold-feature',
  summary:
    'Plans (default) or writes (--write) one screen feature from the skill templates: route file, pure view, model hook, their tests, the route test, a params parser for a dynamic route, message keys in every catalog, and the entries in contracts/navigation.json and contracts/screens.json. Never overwrites a file that differs.',
  usage: '[repo-root] --feature <name> --route "<route id>" --title "<Title>" [options]',
  options: {
    feature: { type: 'string', value: 'name', help: 'The feature folder, kebab-case (notes, note-detail); also the testID scope and the message-key prefix' },
    route: { type: 'string', value: 'id', help: 'The route id: the route file path under the routes folder without the extension, e.g. "(app)/notes" or "(app)/notes/[noteId]" (a dynamic route ends in one [camelCaseParam])' },
    title: { type: 'string', value: 'text', help: 'The navigation title in the source language (the source catalog value of <feature>.title)' },
    body: { type: 'string', value: 'text', help: 'The body text the skeleton shows, in the source language (default "Nothing here yet.")' },
    'source-language': { type: 'string', value: 'tag', help: 'The language --title and --body are written in (default: SOURCE_LANGUAGE in <i18nDir>/languages.ts, else en)' },
    'drop-contract-comments': { type: 'boolean', help: 'Edit a contract that holds // comments anyway (the edit prints plain JSON, so the comments are lost)' },
    write: { type: 'boolean', help: 'Write the plan (refuses when any planned file exists with other content)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Plan lines: "new <file>", "same <file>" (already identical), "edit <file> (<what>)" (a catalog or contract',
    'gains entries). Rules: conflict (a file or key exists with other content, or another route file already serves',
    'the URL; --write writes nothing), format (the',
    'app\'s Prettier, run on the written files when node_modules/prettier exists, failed).',
    'Catalogs: every <i18nDir>/catalogs/<tag>.json gains the keys. --title and --body are source-language text: every',
    'other catalog gets them as drafts to translate. The fixed texts (a dynamic route\'s invalid-link state) come from',
    'this skill\'s en and ar templates; any other language gets the English text as a draft. The plan lists the drafts',
    'per language and names a drafted language missing from contracts/i18n.json reviewLanguages (the review queue).',
    'Contracts: when contracts/navigation.json exists the route is added to routes (and a dynamic route to',
    'paramParsers); when contracts/screens.json exists the screen entry is appended. Absent contracts are noted.',
    'A contract holding // comments is a conflict (the edit would drop them) unless --drop-contract-comments.',
    'Starter: the starter route and screen of a freshly bootstrapped app (expo-project-bootstrap) are named, never',
    'overwritten: delete them, then generate the first feature at their route (--route index).',
    'Frame: when <uiDir>/screen-frame.tsx exists, the view\'s root is <ScreenFrame edges={BELOW_HEADER_EDGES}>.',
    'Home: a dynamic route\'s invalid-link way out goes to contracts/navigation.json "home" (default \'/\').',
    'Tabs: a route under a Tabs layout gets a note to change <Stack.Screen> to <Tabs.Screen>.',
    '',
    'Examples:',
    '  node scaffold-feature.mjs . --feature notes --route "(app)/notes" --title "Notes"',
    '  node scaffold-feature.mjs . --feature note-detail --route "(app)/notes/[noteId]" --title "Note" --write',
    'Then: node check-feature.mjs . --feature <name>',
  ].join('\n'),
};

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(here, '..', 'templates');
const FEATURE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATIC_SEGMENT = /^([a-z0-9]+(-[a-z0-9]+)*|\([a-z0-9]+(-[a-z0-9]+)*\))$/;
const PARAM_SEGMENT = /^\[([a-z][A-Za-z0-9]*)\]$/;
const TEXT_PLACEHOLDERS = ['__TITLE__', '__BODY__', '__DETAIL_TITLE__', '__DETAIL_BODY__'];
const DEFAULT_BODY = 'Nothing here yet.';

const pascal = (kebab) => kebab.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** { kind: 'static' | 'dynamic', id, href, hrefBase?, param? } or a UsageError. */
function parseRoute(given) {
  const id = given.replace(/\.(tsx|ts|jsx|js)$/, '').replace(/^\/+/, '');
  const segments = id.split('/');
  const bad = () => new UsageError(`--route "${given}" is not a route id this scaffold writes`, 'Pass the route file path under the routes folder without the extension: kebab URL segments, (group) folders, and at most one [camelCaseParam] as the last segment, e.g. "(app)/notes" or "(app)/notes/[noteId]". Layouts, +not-found and catch-all routes are written by hand (navigation-and-routing).');
  if (id === '' || segments.some((segment) => segment === '')) throw bad();
  const last = segments.at(-1);
  const param = PARAM_SEGMENT.exec(last)?.[1] ?? null;
  const fixed = param === null ? segments : segments.slice(0, -1);
  if (!fixed.every((segment) => STATIC_SEGMENT.test(segment)) || fixed.includes('index') && fixed.at(-1) !== 'index') throw bad();
  if (param !== null && fixed.at(-1) === 'index') throw bad();
  const url = fixed.filter((segment) => !segment.startsWith('(') && segment !== 'index');
  const base = `/${url.join('/')}`;
  if (param === null) return { kind: 'static', id, href: base };
  if (url.length === 0) throw bad();
  return { kind: 'dynamic', id, hrefBase: base, param };
}

function checkText(name, value) {
  if (value === undefined) return;
  if (value.trim() === '' || value.length > 80 || /[\n{}<>]/.test(value) || /__[A-Z]/.test(value)) {
    throw new UsageError(`--${name} "${value}" is not a plain one-line text`, `Pass up to 80 characters without line breaks, braces or angle brackets (ICU syntax belongs in the catalog, written by hand).`);
  }
}

/** The placeholder values for one feature, both groups (a template uses only its own). */
function placeholdersFor({ feature, route, title, body }) {
  const P = pascal(feature);
  return {
    __FEATURE__: feature,
    __FEATURE_PASCAL__: P,
    __ROUTE_ID__: route.id,
    __ROUTE_HREF__: route.href ?? '',
    __TITLE__: title,
    __BODY__: body,
    __DETAIL__: feature,
    __DETAIL_PASCAL__: P,
    __DETAIL_ROUTE_ID__: route.id,
    __DETAIL_HREF_BASE__: route.hrefBase ?? '',
    __PARAM__: route.param ?? '',
    __DETAIL_TITLE__: title,
    __DETAIL_BODY__: body,
  };
}

/** A string literal the way Prettier writes it (single quotes unless the text holds one). */
function jsString(value) {
  if (value.includes("'") && !value.includes('"')) return `"${value.replace(/\\/g, '\\\\')}"`;
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function fill(text, values, { isCode }) {
  let out = text;
  if (isCode) {
    for (const name of TEXT_PLACEHOLDERS) out = out.replaceAll(`'${name}'`, jsString(values[name]));
  }
  return out.replace(/__[A-Z][A-Z0-9_]*__/g, (token) => (Object.hasOwn(values, token) ? values[token] : token));
}

/** Map a canonical template path (src/app/..., src/features/..., src/i18n/...) onto the app's layout. */
function placePath(path, layout) {
  const map = [['src/app/', `${layout.routesDir}/`], ['src/features/', `${layout.featuresDir}/`], ['src/i18n/', `${layout.i18nDir}/`]];
  for (const [from, to] of map) if (path.startsWith(from)) return `${to}${path.slice(from.length)}`;
  return path;
}

/** The code templates of one group: [{ target, content }]. */
function codePlan(group, values, layout, { isFramed, screenRel, feature }) {
  const marker = group === 'static' ? /__FEATURE__|__ROUTE_ID__/ : /__DETAIL__|__DETAIL_ROUTE_ID__/;
  const plan = [];
  for (const rel of walk(TEMPLATES).filter((path) => /\.(tsx?|jsx?)$/.test(path) && marker.test(path))) {
    const text = readFileSync(join(TEMPLATES, rel), 'utf8');
    const firstLine = /^\/\/ (\S+)/.exec(text)?.[1] ?? rel;
    const canonical = fill(firstLine, values, { isCode: false });
    const target = placePath(canonical, layout);
    let content = fill(text, values, { isCode: true });
    if (target !== canonical) content = content.replace(`// ${canonical}`, `// ${target}`);
    if (isFramed && target === screenRel) content = frameScreen(content, feature);
    plan.push({ target, content });
  }
  return plan.sort((a, b) => a.target.localeCompare(b.target));
}

/**
 * The template messages of one group for one language: { messages: { key: text }, drafts: [key] }.
 * The --title/--body values are source-language text, so they are drafts in every other language.
 * The fixed texts come from this skill's template for the language, else English as a draft.
 */
function templateMessages(group, language, values, sourceLanguage) {
  const prefix = group === 'static' ? '__FEATURE__.' : '__DETAIL__.';
  const catalogs = join(TEMPLATES, 'src', 'i18n', 'catalogs');
  const english = JSON.parse(readFileSync(join(catalogs, 'en.json'), 'utf8'));
  const ownPath = join(catalogs, `${language}.json`);
  const own = existsSync(ownPath) ? JSON.parse(readFileSync(ownPath, 'utf8')) : {};
  const messages = {};
  const drafts = [];
  for (const [key, text] of Object.entries(english)) {
    if (!key.startsWith(prefix)) continue;
    const filled = fill(key, values, { isCode: false });
    const isGiven = TEXT_PLACEHOLDERS.includes(text);
    const hasOwn = !isGiven && Object.hasOwn(own, key);
    messages[filled] = fill(hasOwn ? own[key] : text, values, { isCode: false });
    if (isGiven ? language !== sourceLanguage : !hasOwn) drafts.push(filled);
  }
  return { messages, drafts };
}

function readReviewLanguages(root, layout) {
  const rel = `${layout.contractsDir}/i18n.json`;
  if (!existsSync(join(root, rel))) return { rel, languages: null };
  try {
    const data = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    return { rel, languages: Array.isArray(data?.reviewLanguages) ? data.reviewLanguages : [] };
  } catch {
    return { rel, languages: [] };
  }
}

/** Lists the drafts per language and names the drafted languages no review queue receives. */
function noteDrafts(root, layout, draftsByLanguage, report) {
  const drafted = Object.keys(draftsByLanguage).filter((language) => draftsByLanguage[language].length > 0);
  for (const language of drafted) report.note(`drafts ${language}: ${draftsByLanguage[language].join(', ')}`);
  if (drafted.length === 0) return;
  const review = readReviewLanguages(root, layout);
  if (review.languages === null) {
    report.note(`note ${review.rel} does not exist: the drafts in ${drafted.join(', ')} reach no review queue (i18n-strings-and-catalogs creates it; until then list them in the report)`);
    return;
  }
  const missing = drafted.filter((language) => !review.languages.includes(language));
  if (missing.length > 0) {
    report.note(`note ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in ${review.rel} reviewLanguages: add ${missing.length === 1 ? 'it' : 'them'} so the drafts reach the review queue (i18n-strings-and-catalogs)`);
  }
}

function catalogEdits(root, layout, group, values, source, report) {
  const dir = `${layout.i18nDir}/catalogs`;
  if (!isDir(join(root, dir))) {
    report.note(`note ${dir}/ does not exist: no catalog gains the keys (i18n-strings-and-catalogs creates the catalogs; then rerun)`);
    return [];
  }
  const names = readdirSync(join(root, dir)).filter((file) => file.endsWith('.json')).sort();
  if (names.length > 0 && !names.includes(`${source.language}.json`)) {
    report.note(`note ${dir}/${source.language}.json does not exist: the source language (${source.language}, ${source.from}) has no catalog, so no key is checked for a conflict (pass --source-language <tag>)`);
  }
  const edits = [];
  const draftsByLanguage = {};
  for (const name of names) {
    const rel = `${dir}/${name}`;
    const language = name.replace(/\.json$/, '');
    const text = readFileSync(join(root, rel), 'utf8');
    let catalog;
    try {
      catalog = JSON.parse(text);
    } catch (error) {
      report.problem({ file: rel, line: 1, rule: 'conflict', message: `not valid JSON (${error.message})`, fix: 'Fix the catalog first, then rerun.' });
      continue;
    }
    const { messages, drafts } = templateMessages(group, language, values, source.language);
    const added = [];
    for (const [key, message] of Object.entries(messages)) {
      if (!Object.hasOwn(catalog, key)) added.push(key);
      else if (catalog[key] !== message && language === source.language) report.problem({ file: rel, line: 1, rule: 'conflict', message: `"${key}" exists with other text`, fix: 'The feature name is taken by keys of another screen: pick another --feature, or delete the old keys first.' });
    }
    if (added.length === 0) {
      report.note(`same ${rel}`);
      continue;
    }
    const merged = { ...catalog };
    for (const key of added) merged[key] = messages[key];
    const sorted = Object.fromEntries(Object.keys(merged).sort().map((key) => [key, merged[key]]));
    edits.push({ target: rel, content: formatJson(sorted) });
    const newDrafts = drafts.filter((key) => added.includes(key));
    draftsByLanguage[language] = newDrafts;
    report.note(`edit ${rel} (+${added.length} keys${newDrafts.length > 0 ? `, ${newDrafts.length} drafts to translate` : ''})`);
  }
  noteDrafts(root, layout, draftsByLanguage, report);
  return edits;
}

/** A contract's data and whether its text holds comments (which an edit printed as JSON drops). */
function readContract(root, rel, report) {
  if (!existsSync(join(root, rel))) return null;
  const text = readFileSync(join(root, rel), 'utf8');
  try {
    const data = parseJsonc(text);
    const masked = maskComments(text);
    const commentLines = text.split('\n').filter((line, index) => line !== masked.split('\n')[index]).length;
    return { data, commentLines };
  } catch (error) {
    report.problem({ file: rel, line: 1, rule: 'conflict', message: `not valid JSON (${error.message})`, fix: 'Fix the contract first, then rerun.' });
    return null;
  }
}

const lines = (count) => `${count} ${count === 1 ? 'line' : 'lines'}`;

/** True when the contract may be rewritten: no comments, or the developer accepted losing them. */
function mayRewrite(rel, contract, options, report) {
  if (contract.commentLines === 0) return true;
  if (options['drop-contract-comments']) {
    report.note(`note ${rel}: --drop-contract-comments: ${lines(contract.commentLines)} of comments dropped by the edit`);
    return true;
  }
  report.problem({ file: rel, line: 1, rule: 'conflict', message: `holds // comments on ${lines(contract.commentLines)}, which the edit (printed as plain JSON) would drop`, fix: 'Move the comments into a "$comment" key and rerun, add the entries the plan names by hand, or rerun with --drop-contract-comments to accept losing them.' });
  return false;
}

function navigationEdit(root, layout, route, paramsRel, options, report) {
  const rel = layout.config?.navigationContract ?? `${layout.contractsDir}/navigation.json`;
  const read = readContract(root, rel, report);
  if (read === null) {
    if (!existsSync(join(root, rel))) report.note(`note ${rel} does not exist: the route is not registered (navigation-and-routing creates the contract)`);
    return [];
  }
  const contract = read.data;
  const changes = [];
  const routes = Array.isArray(contract.routes) ? contract.routes : [];
  if (!routes.includes(route.id)) {
    contract.routes = [...routes, route.id];
    changes.push(`routes += "${route.id}"`);
  }
  if (paramsRel !== null) {
    const parsers = contract.paramParsers ?? {};
    if (parsers[route.id] !== undefined && parsers[route.id] !== paramsRel) {
      report.problem({ file: rel, line: 1, rule: 'conflict', message: `paramParsers["${route.id}"] already names ${parsers[route.id]}`, fix: 'The route belongs to another feature: pick another --route, or update the contract by hand.' });
    } else if (parsers[route.id] === undefined) {
      contract.paramParsers = { ...parsers, [route.id]: paramsRel };
      changes.push(`paramParsers += "${route.id}"`);
    }
  }
  if (changes.length === 0) {
    report.note(`same ${rel}`);
    return [];
  }
  report.note(`edit ${rel} (${changes.join(', ')})`);
  if (!mayRewrite(rel, read, options, report)) return [];
  return [{ target: rel, content: formatJson(contract) }];
}

function screenEntry(feature, title, group, paths, rootComponent) {
  const shared = { id: feature, name: title, presentation: 'route', route: paths.routeRel, model: paths.modelRel, view: paths.screenRel };
  if (group === 'static') {
    return {
      ...shared,
      states: [{ id: 'default' }],
      elements: [
        { testID: `${feature}.screen`, role: 'none', component: rootComponent },
        { testID: `${feature}.body`, role: 'text', component: 'AppText', text: `${feature}.body` },
      ],
    };
  }
  return {
    ...shared,
    states: [{ id: 'ready' }, { id: 'invalid-link', drawn: false, why: 'Any link can open this route with an id that names nothing; the screen says so and offers the one way out.' }],
    elements: [
      { testID: `${feature}.screen`, role: 'none', component: rootComponent },
      { testID: `${feature}.body`, role: 'text', component: 'AppText', text: `${feature}.body`, states: ['ready'] },
      { testID: `${feature}.invalid-link-text`, role: 'text', component: 'AppText', text: `${feature}.invalid-link.body`, states: ['invalid-link'] },
      { testID: `${feature}.go-home-button`, role: 'button', component: 'PressableSurface', text: `${feature}.invalid-link.go-home`, states: ['invalid-link'] },
    ],
  };
}

function screensEdit(root, layout, feature, title, group, paths, rootComponent, options, report) {
  const rel = layout.config?.screensContract ?? `${layout.contractsDir}/screens.json`;
  const read = readContract(root, rel, report);
  if (read === null) {
    if (!existsSync(join(root, rel))) report.note(`note ${rel} does not exist: no screen entry written (screen-contracts creates the contract)`);
    return [];
  }
  const contract = read.data;
  const screens = Array.isArray(contract.screens) ? contract.screens : [];
  if (screens.some((screen) => screen?.view === paths.screenRel)) {
    report.note(`same ${rel} (a screen entry already names ${paths.screenRel})`);
    return [];
  }
  if (screens.some((screen) => screen?.id === feature)) {
    report.problem({ file: rel, line: 1, rule: 'conflict', message: `a screen "${feature}" exists with another view`, fix: 'Pick another --feature, or fix the existing entry by hand.' });
    return [];
  }
  contract.screens = [...screens, screenEntry(feature, title, group, paths, rootComponent)];
  report.note(`edit ${rel} (screens += "${feature}")`);
  if (!mayRewrite(rel, read, options, report)) return [];
  return [{ target: rel, content: formatJson(contract) }];
}

/**
 * The view's root in an app that has react-components-and-hooks' ScreenFrame: the template's plain
 * View root (kept so the templates compile in an app without it) becomes
 * <ScreenFrame testID edges={BELOW_HEADER_EDGES}>, which brings the ground colour and the centred
 * column, so the view drops its own. Every edit must apply exactly once; a template that no longer
 * matches is a bug in this skill and stops the run.
 */
function frameScreen(content, feature) {
  const edits = [
    [/^\/\/ Frame: a plain View root[\s\S]*?\n(?=import )/m, "// Frame: react-components-and-hooks' ScreenFrame under the Stack header (BELOW_HEADER_EDGES: the\n// header pads the top inset, the frame the sides and the bottom) with its centred column.\n"],
    ["import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';", "import { SPACING } from '@/theme/tokens';"],
    ["import { AppText } from '@/ui/app-text';", "import { AppText } from '@/ui/app-text';\nimport { BELOW_HEADER_EDGES, ScreenFrame } from '@/ui/screen-frame';"],
    ['makeStyles((theme) => {', 'makeStyles(() => {'],
    ['    screen: { flex: 1, backgroundColor: theme.colors.background },\n', ''],
    ["    // A wide window (a tablet, a foldable) centres the column instead of stretching it.\n    content: {\n      width: '100%',\n      maxWidth: CONTENT_MAX_WIDTH,\n      alignSelf: 'center',\n", '    content: {\n'],
    [`<View testID="${feature}.screen" style={styles.screen}>`, `<ScreenFrame testID="${feature}.screen" edges={BELOW_HEADER_EDGES}>`],
    ['    </View>\n  );\n}', '    </ScreenFrame>\n  );\n}'],
  ];
  let out = content;
  for (const [find, replacement] of edits) {
    const pattern = typeof find === 'string' ? find : null;
    const count = pattern === null ? (out.match(new RegExp(find.source, 'gm')) ?? []).length : out.split(pattern).length - 1;
    if (count !== 1) throw new Error(`frameScreen: the view template no longer matches ${String(find).slice(0, 60)} (${count} matches); update frameScreen with the template`);
    out = out.replace(find, replacement);
  }
  return out;
}

/**
 * Line lengths change once placeholders are filled (a long feature name wraps a line the template kept
 * on one), so the written files go through the app's own Prettier when it is installed: the result is
 * exactly what the app's format check expects. Without it the plan says to format them.
 */
function formatWritten(root, targets, report) {
  const bin = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (!existsSync(bin)) {
    report.note(`note the app has no node_modules/prettier: format the ${targets.length} written files with the app's formatter`);
    return;
  }
  const result = spawnSync(process.execPath, [bin, '--write', '--log-level', 'warn', ...targets], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) {
    report.note(`formatted ${targets.length} files with the app's Prettier`);
    return;
  }
  const output = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(0, 2).join(' | ');
  report.problem({ file: targets[0], line: 1, rule: 'format', message: `the app's Prettier failed on the written files: ${output}`, fix: 'Run npx prettier --check on the files it names and fix the syntax error it reports.' });
}

/** True when a planned file is, or lies in, the bootstrap starter. */
function isStarterPath(target, starter) {
  return starter.routes.includes(target) || starter.features.some((dir) => target.startsWith(`${dir}/`));
}

function classify(root, plan, starter, report, urlStarters = []) {
  const fresh = [];
  const starterHits = [...urlStarters];
  for (const file of plan) {
    const path = join(root, file.target);
    if (!existsSync(path)) {
      fresh.push(file);
      report.note(`new  ${file.target}`);
    } else if (readFileSync(path, 'utf8') === file.content) {
      report.note(`same ${file.target}`);
    } else if (isStarterPath(file.target, starter)) {
      starterHits.push(file.target);
    } else {
      report.problem({ file: file.target, line: 1, rule: 'conflict', message: 'exists with different content; the scaffold never overwrites', fix: 'Pick another --feature or --route, or compare the file with the template and finish it by hand.' });
    }
  }
  if (starterHits.length > 0) {
    report.problem({ file: starterHits[0], line: 1, rule: 'starter', message: `${starterHits.join(', ')} ${starterHits.length === 1 ? 'is' : 'are'} the starter screen of a new app (expo-project-bootstrap), which this feature replaces; the scaffold never overwrites`, fix: `Delete the starter, which holds no work: ${starter.all.join(' and ')}; then rerun the same command.` });
  } else if (starter.all.length > 0) {
    report.note(`note the starter screen of a new app is still here (${starter.all.join(', ')}): delete it when the first feature takes its route (--route index or "(app)/index")`);
  }
  return fresh;
}

const ROUTE_FILE = /\.(tsx|ts|jsx|js)$/;
const PLATFORM_SUFFIX = /\.(ios|android|native|web)$/;

/**
 * The URL a route file serves, with every dynamic segment written "[]" so two parameter names compare
 * equal: groups and a final index drop out, the extension and a platform suffix are stripped. Null for
 * files that serve no URL of their own (layouts, +not-found, +html, +native-intent, API routes) and
 * catch-alls.
 */
function routeUrlOf(rel) {
  const segments = rel.replace(ROUTE_FILE, '').replace(PLATFORM_SUFFIX, '').split('/');
  const last = segments.at(-1);
  if (last === '_layout' || last.startsWith('+') || last.endsWith('+api') || segments.some((segment) => segment.startsWith('[...') || segment.startsWith('[[...'))) return null;
  const url = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')'))).map((segment) => (/^\[[^\]]+\]$/.test(segment) ? '[]' : segment));
  if (url.at(-1) === 'index') url.pop();
  return `/${url.join('/')}`;
}

/**
 * Other route files that already serve the new route's URL ("--route notes" beside "(app)/notes.tsx"):
 * Expo Router would hold two files for one URL. The bootstrap starter is reported as the starter.
 */
function urlTakenBy(root, layout, routeRel, url, starter) {
  const dir = join(root, layout.routesDir);
  if (!isDir(dir)) return { others: [], starters: [] };
  const others = [];
  const starters = [];
  for (const rel of walk(dir, { pruneDirsContaining: ['SKILL.md'] })) {
    if (!ROUTE_FILE.test(rel) || /\.test\.[jt]sx?$/.test(rel)) continue;
    const file = `${layout.routesDir}/${rel}`;
    if (file === routeRel || routeUrlOf(rel) !== url) continue;
    (starter.routes.includes(file) ? starters : others).push(file);
  }
  return { others, starters };
}

/**
 * The navigator a route renders in: the nearest _layout above it. A Tabs (or NativeTabs) layout, or a
 * "(tabs)" group without a layout, means the generated <Stack.Screen> must become <Tabs.Screen>.
 */
function tabsLayoutOf(root, layout, routeId) {
  const parts = routeId.split('/').slice(0, -1);
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    const base = [layout.routesDir, ...parts.slice(0, depth)].join('/');
    for (const name of ['_layout.tsx', '_layout.ts', '_layout.jsx', '_layout.js']) {
      const rel = `${base}/${name}`;
      if (!existsSync(join(root, rel))) continue;
      const text = maskComments(readFileSync(join(root, rel), 'utf8'));
      return /<(?:Native)?Tabs[\s.>/]|unstable-native-tabs/.test(text) ? rel : null;
    }
  }
  return parts.includes('(tabs)') ? `${layout.routesDir}/${parts.join('/')}/` : null;
}

/**
 * The invalid-link way out goes to the first screen, contracts/navigation.json "home". The templates say
 * '/'; another home href is written into the model and the two tests (and the tests' stand-in route key).
 * Returns the edited plan, or the plan unchanged with a note when home is '/', absent or not a plain href.
 */
function applyHome(plan, root, layout, feature, report) {
  const rel = layout.config?.navigationContract ?? `${layout.contractsDir}/navigation.json`;
  let home = '/';
  try {
    if (existsSync(join(root, rel))) home = parseJsonc(readFileSync(join(root, rel), 'utf8'))?.home ?? '/';
  } catch {
    return plan;
  }
  if (home === '/') return plan;
  if (typeof home !== 'string' || !/^\/[a-z0-9][a-z0-9/-]*$/.test(home) || home.endsWith('/')) {
    report.note(`note ${rel} home ${JSON.stringify(home)} is not a plain href: the invalid-link way out says router.dismissTo('/'); change it (and the tests' '/') to the first screen by hand`);
    return plan;
  }
  const key = home.slice(1);
  const routeKey = /^[a-z][a-z0-9]*$/.test(key) ? key : `'${key}'`;
  const edits = {
    [`use-${feature}-model.ts`]: [["router.dismissTo('/');", `router.dismissTo('${home}');`, 1]],
    [`use-${feature}-model.test.tsx`]: [["toBe('/');", `toBe('${home}');`, 1], ['  index: HomeStandIn,', `  ${routeKey}: HomeStandIn,`, 1]],
    [`${feature}-navigation.test.tsx`]: [["toBe('/');", `toBe('${home}');`, 1], ['  index: HomeStandIn,', `  ${routeKey}: HomeStandIn,`, 1]],
  };
  report.note(`note the invalid-link way out goes to ${home} (${rel} home)`);
  return plan.map((file) => {
    const list = edits[file.target.split('/').at(-1)];
    if (list === undefined) return file;
    let content = file.content;
    for (const [find, replacement, want] of list) {
      const count = content.split(find).length - 1;
      if (count !== want) throw new Error(`applyHome: ${file.target} no longer holds ${find} ${want} time(s) (${count}); update applyHome with the template`);
      content = content.replace(find, replacement);
    }
    return { ...file, content };
  });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = resolve(positionals[0] ?? '.');
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) throw new UsageError(`no package.json in ${root}`, 'Run from the app repo root, or pass it as the first argument.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if ({ ...manifest.dependencies, ...manifest.devDependencies }['expo-router'] === undefined) {
    throw new UsageError('expo-router is not in package.json', 'This scaffold writes Expo Router routes; install the router first (npx expo install expo-router), or follow navigation-and-routing for React Navigation.');
  }
  const feature = options.feature ?? '';
  if (!FEATURE_NAME.test(feature)) throw new UsageError(`--feature "${feature}" is not a kebab-case feature name`, 'Pass the folder name, e.g. --feature notes or --feature note-detail.');
  if (options.route === undefined) throw new UsageError('--route is required', 'Pass the route id, e.g. --route "(app)/notes".');
  if (options.title === undefined) throw new UsageError('--title is required', 'Pass the navigation title in the source language, e.g. --title "Notes".');
  if (options['source-language'] !== undefined && !isLanguageTag(options['source-language'])) {
    throw new UsageError(`--source-language "${options['source-language']}" is not a language tag`, 'Pass the tag of the source catalog file, e.g. --source-language en or --source-language de.');
  }
  checkText('title', options.title);
  checkText('body', options.body);
  const route = parseRoute(options.route);
  const group = route.kind === 'static' ? 'static' : 'detail';
  const layout = resolveLayout(root);
  const values = placeholdersFor({ feature, route, title: options.title, body: options.body ?? DEFAULT_BODY });
  const report = createReporter({ name: 'scaffold-feature' });
  const featureDir = `${layout.featuresDir}/${feature}`;
  const paths = { routeRel: `${layout.routesDir}/${route.id}.tsx`, modelRel: `${featureDir}/use-${feature}-model.ts`, screenRel: `${featureDir}/${feature}-screen.tsx` };
  const paramsRel = group === 'detail' ? `${featureDir}/${feature}-params.ts` : null;
  const starter = findStarter(root, layout);
  const url = route.kind === 'static' ? route.href : `${route.hrefBase}/[]`;
  const taken = urlTakenBy(root, layout, paths.routeRel, url, starter);
  for (const other of taken.others) {
    report.problem({ file: paths.routeRel, line: 1, rule: 'conflict', message: `${other} already serves ${url === '/' ? '/' : url.replace('/[]', '/<param>')}; two route files for one URL leave one of them unreachable`, fix: 'Pick another --route (another URL), or finish the existing route by hand.' });
  }
  const tabs = tabsLayoutOf(root, layout, route.id);
  if (tabs !== null) report.note(`note ${paths.routeRel} renders inside a Tabs layout (${tabs}): change <Stack.Screen> to <Tabs.Screen> in the route file after generating`);
  const source = sourceLanguageOf(root, layout, options['source-language']);
  const frameRel = `${layout.uiDir}/screen-frame.tsx`;
  const isFramed = existsSync(join(root, frameRel));
  report.note(isFramed
    ? `note ${frameRel} exists: the view's root is <ScreenFrame edges={BELOW_HEADER_EDGES}>`
    : `note ${frameRel} does not exist: the view's root is a plain View (react-components-and-hooks' ScreenFrame replaces it once the app has it)`);
  const code = codePlan(group, values, layout, { isFramed, screenRel: paths.screenRel, feature });
  const plan = [
    ...(group === 'detail' ? applyHome(code, root, layout, feature, report) : code),
    ...catalogEdits(root, layout, group, values, source, report),
    ...navigationEdit(root, layout, route, paramsRel, options, report),
    ...screensEdit(root, layout, feature, options.title, group, paths, isFramed ? 'ScreenFrame' : 'View', options, report),
  ];
  const fresh = classify(root, plan.filter((file) => !/\.json$/.test(file.target)), starter, report, taken.starters);
  const edits = plan.filter((file) => /\.json$/.test(file.target));
  const isWriting = Boolean(options.write) && report.count === 0;
  if (isWriting) {
    for (const file of [...fresh, ...edits]) {
      mkdirSync(dirname(join(root, file.target)), { recursive: true });
      writeFileSync(join(root, file.target), file.content);
    }
    formatWritten(root, [...fresh, ...edits].map((file) => file.target), report);
  }
  report.note(`${isWriting ? 'wrote' : 'would write'} ${fresh.length} new files and ${edits.length} edits for ${feature} (${route.kind} route ${route.id}${route.param ? `, param ${route.param}` : ''})`);
  if (isWriting) {
    report.note(`next: npx jest ${featureDir} --ci --maxWorkers=2, then node <this skill>/scripts/check-feature.mjs . --feature ${feature}`);
  } else if (report.count === 0) {
    report.note('dry run: nothing written; rerun with --write');
  }
  return report.finish({ checked: plan.length, unit: 'planned files' });
});
