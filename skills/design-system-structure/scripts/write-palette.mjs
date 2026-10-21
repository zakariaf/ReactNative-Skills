#!/usr/bin/env node
// write-palette.mjs: writes the app's palette module (src/theme/palette.ts) from the token file's
// semantic colours (tier 2, aliases resolved), after proving every scheme passes the app's contrast
// pairs (contracts/contrast.json when it exists, else the default pairs, and the core pairs always).
// Nothing is written while a pair fails, so no unreadable palette ships.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/write-palette.mjs [repo-root] [--dry-run]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';
import { enclosingWorkspaceRepo, expoAppDirs, importExtensionsMode, prefixedReporter } from './lib/expo-apps.mjs';
import { modulePaths, readContract } from './lib/design-contract.mjs';
import { applyExceptions, readContrastContract, schemeProblems, tableFor } from './lib/palette-rules.mjs';
import { getPath, primitiveName, resolveTokens } from './lib/token-file.mjs';

const STATUS_FIELDS = ['primary', 'danger', 'success', 'warning'];

const SPEC = {
  name: 'write-palette',
  summary: 'Writes the palette module from the token file\'s semantic colours, after every scheme passes the app\'s contrast pairs (contracts/contrast.json, or the default pairs; the core pairs always).',
  usage: '[repo-root] [options]',
  options: {
    tokens: { type: 'string', value: 'file', help: 'Token file (default: the contract "tokens", else design/tokens.json)' },
    token: { type: 'string', value: 'path', help: 'Dot path of { light, dark, colorBlind? } (default: the first contract palette, else color)' },
    out: { type: 'string', value: 'file', help: 'Palette module (default: the first contract palette, else <themeDir>/palette.ts)' },
    export: { type: 'string', value: 'NAME', help: 'Exported const (default: PALETTE)' },
    'dry-run': { type: 'boolean', help: 'Validate and print the module instead of writing it' },
    force: { type: 'boolean', help: 'Overwrite a palette file that holds other colours' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules checked before writing (the same as check-design-system.mjs):',
    '  token-file         the token file is missing or not JSON, an alias points nowhere, or the path holds no { light, dark }',
    '  palette-hex        every colour is an uppercase #RRGGBB (#RRGGBBAA for translucent roles)',
    '  palette-contrast   every text pair passes 4.5:1 and every graphics pair (edges, focus, icons) 3:1',
    '  palette-fill       every filled shape stands 3:1 off its ground or its edge',
    '  palette-colorblind a colour-blind variant changes no primary or status colour',
    '  palette-exists     the module already holds other colours (pass --force)',
    '',
    'The pairs: contracts/contrast.json (rn-skills.config.json "contrastContract" moves it; accessibility-as-code',
    'owns its keys), matched by the palette file and export, plus the core pairs; without it, the default pairs.',
    'Translucent #RRGGBBAA colours are painted over their ground first, as accessibility-as-code does.',
    'In a workspace repo (package.json "workspaces") run from the root, it writes into the one Expo app workspace',
    '(pass the app folder when there are several); line 1 names the repo path (// apps/mobile/src/theme/palette.ts)',
    'and the import keeps its .ts extension (rn-skills.config.json "importExtensions": "node" turns that off).',
    'The options are paths inside the app folder.',
    '',
    'Examples:',
    '  node write-palette.mjs . --dry-run',
    '  node write-palette.mjs . --token flavours.acme --out src/theme/acme-palette.ts --export ACME_PALETTE',
  ].join('\n'),
};

function readTokens(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) fail(`nothing to read: the token file ${rel} does not exist`, 'Copy templates/design/tokens.json, or pass --tokens <file>.');
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (error) {
    fail(`${rel} is not valid JSON: ${error.message}`, 'Fix the token file syntax.');
  }
}

/**
 * The import specifier of theme-types from the palette file: a sibling, else the @/ alias. With
 * `withExtension` (a workspace repo's lint: relative and @/ imports write their extension) it keeps .ts.
 */
function themeTypesImport(layout, out, themeTypes, withExtension) {
  const ext = withExtension ? '.ts' : '';
  const relative = posix.relative(posix.dirname(out), themeTypes).replace(/\.ts$/, ext);
  if (!relative.startsWith('.')) return `./${relative}`;
  if (!relative.startsWith('..')) return relative;
  const alias = layout.aliases.find((entry) => entry.pattern === '@/*');
  return alias && themeTypes.startsWith(`${layout.srcDir}/`) ? `@/${themeTypes.slice(layout.srcDir.length + 1).replace(/\.ts$/, ext)}` : relative;
}

/**
 * Where the palette is written: the app folder, the path of that folder from the repo root ('' for a
 * single app, 'apps/mobile' for an Expo app workspace) and the repo root. Run from the root of a
 * workspace repo it picks the one Expo app workspace; run on an app folder it finds the repo above.
 */
function appOf(root) {
  const dirs = expoAppDirs(root);
  if (dirs.length > 1) fail(`the repo has several Expo apps (${dirs.join(', ')}), so the palette has no single home`, `Pass the app folder: node write-palette.mjs ${dirs[0]} --dry-run`);
  if (dirs[0] !== '.') return { appRoot: join(root, dirs[0]), prefix: dirs[0], repoRoot: root };
  const enclosing = enclosingWorkspaceRepo(root);
  return enclosing ? { appRoot: root, prefix: enclosing.prefix, repoRoot: enclosing.root } : { appRoot: root, prefix: '', repoRoot: root };
}

function objectLines(name, colors, raw, path) {
  const lines = [`const ${name}: ColorTokens = {`];
  for (const [field, value] of Object.entries(colors)) {
    const primitive = primitiveName(raw, `${path}.${field}`);
    lines.push(`  ${field}: '${value}',${primitive ? ` // ${primitive}` : ''}`);
  }
  lines.push('};');
  return lines;
}

export function paletteModule({ out, header = out, importPath, tokensRel, tokenPath, exportName, sets, raw }) {
  const blocks = [
    `// ${header}`,
    `// Written by write-palette.mjs from ${tokensRel} ("${tokenPath}"). Change the token file, then rerun.`,
    `import type { ColorTokens, Palette } from '${importPath}';`,
    '',
    ...objectLines('LIGHT', sets.light, raw, `${tokenPath}.light`),
    '',
    ...objectLines('DARK', sets.dark, raw, `${tokenPath}.dark`),
  ];
  if (!sets.colorBlind) return [...blocks, '', `export const ${exportName}: Palette = { light: LIGHT, dark: DARK };`, ''].join('\n');
  return [
    ...blocks,
    '',
    ...objectLines('COLOR_BLIND_LIGHT', sets.colorBlind.light, raw, `${tokenPath}.colorBlind.light`),
    '',
    ...objectLines('COLOR_BLIND_DARK', sets.colorBlind.dark, raw, `${tokenPath}.colorBlind.dark`),
    '',
    `export const ${exportName}: Palette = {`,
    '  light: LIGHT,',
    '  dark: DARK,',
    '  colorBlind: { light: COLOR_BLIND_LIGHT, dark: COLOR_BLIND_DARK },',
    '};',
    '',
  ].join('\n');
}

function schemesOf(sets) {
  const schemes = [['light', sets.light], ['dark', sets.dark]];
  if (sets.colorBlind) schemes.push(['colorBlind.light', sets.colorBlind.light], ['colorBlind.dark', sets.colorBlind.dark]);
  return schemes;
}

function writeModule(report, root, { out, shown = out, text, isForced }) {
  const abs = join(root, out);
  if (existsSync(abs) && readFileSync(abs, 'utf8') === text) {
    report.note(`unchanged ${shown}`);
  } else if (existsSync(abs) && !isForced) {
    report.problem({ file: out, rule: 'palette-exists', message: 'the palette module already holds other colours', fix: 'Pass --dry-run to compare first, then --force to overwrite it.' });
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    report.note(`wrote ${shown}`);
  }
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const { appRoot: root, prefix, repoRoot } = appOf(requireDir(positionals[0] ?? '.', 'app repo root'));
  const layout = resolveLayout(root);
  const { contract } = readContract(root, layout);
  const paths = modulePaths(layout, contract);
  const first = contract?.palettes?.[0];
  const tokensRel = options.tokens ?? contract?.tokens ?? 'design/tokens.json';
  const tokenPath = options.token ?? first?.token ?? 'color';
  const out = options.out ?? first?.file ?? paths.palette;
  const exportName = options.export ?? first?.export ?? 'PALETTE';
  const raw = readTokens(root, tokensRel);
  const results = createReporter({ name: 'write-palette' });
  const report = prefixedReporter(results, prefix || '.');
  const { tree, problems } = resolveTokens(raw);
  for (const entry of problems) report.problem({ file: tokensRel, rule: 'token-file', message: entry.message, fix: 'Point the alias at an existing token ({group.name}).' });
  const sets = getPath(tree, tokenPath);
  if (!sets || typeof sets.light !== 'object' || typeof sets.dark !== 'object') {
    report.problem({ file: tokensRel, rule: 'token-file', message: `"${tokenPath}" holds no { light, dark } colours`, fix: 'Pass --token with the path of the semantic colours.' });
    return results.finish({ checked: 1, unit: 'token files' });
  }
  const table = tableFor(readContrastContract(root, layout), { file: out, exportName });
  report.note(`pairs: ${table.source ?? 'the default pairs'} plus the core pairs (${table.text.length} text, ${table.graphics.length} graphics, ${table.shapes.length} shapes)`);
  for (const [label, colors] of schemesOf(sets)) {
    const { accepted, left } = applyExceptions(label, schemeProblems(label, colors, table), table);
    for (const text of accepted) report.note(`note: ${text}`);
    for (const problem of left) report.problem({ file: tokensRel, rule: problem.rule, message: problem.message, fix: 'Change that colour in the token file (keep the hue, move the lightness) and rerun; never drop the pair.' });
  }
  if (sets.colorBlind && !STATUS_FIELDS.some((field) => ['light', 'dark'].some((scheme) => sets.colorBlind[scheme]?.[field] !== sets[scheme][field]))) {
    report.problem({ file: tokensRel, rule: 'palette-colorblind', message: `${tokenPath}.colorBlind changes no primary or status colour, so the colour-blind setting would change nothing`, fix: 'Give the variant distinguishable status colours, or drop it and carry meaning by shape and text.' });
  }
  if (results.count === 0) {
    const importPath = themeTypesImport(layout, out, paths.themeTypes, importExtensionsMode(repoRoot) === 'all');
    const header = prefix === '' ? out : `${prefix}/${out}`;
    const text = paletteModule({ out, header, importPath, tokensRel, tokenPath, exportName, sets, raw });
    if (options['dry-run']) console.log(text);
    else writeModule(report, root, { out, shown: header, text, isForced: options.force });
  }
  return results.finish({ checked: schemesOf(sets).length, unit: 'schemes' });
});
