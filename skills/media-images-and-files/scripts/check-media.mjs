#!/usr/bin/env node
// check-media.mjs: checks an Expo app's images and files: expo-image views that are sized, named or
// marked decorative and recycled correctly; picks and captures from a press, images only, without
// base64 or EXIF; camera permission only through the permission gate and only declared when used;
// stored media named by MediaRef (never a file URI), never overwritten, never in the cache, swept for
// orphans; no base64 data URIs; no SDK 57 legacy file-system or media-library API; file transfers
// only in the file-transfer adapter.
// Usage: node check-media.mjs [repo-root] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, fail, lineOf, maskComments, notYetCreated, parseArgs, resolveLayout, run, walkRepo } from './check-lib.mjs';
import {
  MEDIA_PACKAGES,
  captureUse,
  checkDataUri,
  checkImageElements,
  checkLegacyApis,
  checkMediaLibraryReads,
  checkMediaStoreFiles,
  checkPermissionGate,
  checkPickerOnPress,
  checkPickerOptions,
  checkStoredUri,
  checkTransfers,
  checkUnusedPermissions,
  importStatements,
  importsAny,
  packageOf,
} from './lib/media-rules.mjs';
import { isTestFile, maskCode, resolveSpecifier } from './lib/source-scan.mjs';

const SPEC = {
  name: 'check-media',
  summary: 'Checks images and files: expo-image sizing, names and recycling; picking from a press; camera permission through the gate; MediaRefs instead of file URIs; no overwrite, no cache storage, an orphan sweep; current file-system and media-library APIs; transfers behind a port.',
  usage: '[repo-root] [options]',
  options: {
    json: { type: 'boolean', help: 'Also print the problems as JSON' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules:',
    '  image-size              an expo-image <Image>/<ImageBackground> without a style (no size)',
    '  image-legacy-prop       resizeMode, defaultSource, loadingIndicatorSource or fadeDuration on expo-image',
    '  image-a11y              an expo-image <Image> neither named (accessible + accessibilityLabel/alt) nor accessible={false}',
    '  list-recycling-key      an expo-image <Image> without recyclingKey in a FlashList file or a module it imports',
    '  picker-options          MediaTypeOptions (deprecated), base64: true or exif: true beside a launch call',
    '  picker-on-press         a picker, camera or import call inside useEffect/useFocusEffect (not from a press)',
    '  permission-outside-gate a camera, photo-library or microphone permission request outside <servicesDir>/permissions/',
    '  unused-permission       app.config.ts declares a capture permission no code uses: expo-image-picker\'s camera',
    '                          (no launchCameraAsync, picker camera permission call, expo-camera or vision-camera import,',
    '                          camera entry in contracts/permissions.json, other plugin declaring it) or microphone (no',
    '                          video pick, no expo-audio / expo-camera / vision-camera recording, no microphone entry), the picker',
    '                          used but not listed (prebuild applies its defaults), or expo-media-library declaring',
    '                          READ_MEDIA_IMAGES/VIDEO while no code reads the library (Play\'s Photo and Video Permissions)',
    '  stored-uri              a uri / *Uri: string field (or v.string(), v.optional(v.string()), v.nullable(v.string()))',
    '                          in <dataDir>/ or <storesDir>/, or a uri, *_uri or *Uri TEXT column',
    '  overwrite-in-place      overwrite: true in <servicesDir>/media-store/',
    '  media-in-cache          the media store keeps files under Paths.cache',
    '  sweep-wired             runtime code creates a media importer but nothing calls sweepMedia',
    '  data-uri                a data:image/...;base64, URI in runtime code (not under <uiDir>/icons/: icon masks)',
    '  legacy-api              expo-file-system or expo-media-library names that throw in SDK 57, or their /legacy entry',
    '  transfer-outside-port   expo-file-system upload/download calls outside <servicesDir>/file-transfer/*-adapter.ts',
    'Runtime files only (tests are free to simulate). NOT APPLICABLE when no source file imports expo-image,',
    'expo-image-picker, expo-camera, expo-image-manipulator, expo-media-library or expo-file-system and there is',
    'no <servicesDir>/media-store/. Layout keys read: srcDir, uiDir, dataDir, storesDir, servicesDir (rn-skills.config.json).',
    'When multi-package, run it once per app folder. Folders holding a SKILL.md are never scanned.',
  ].join('\n'),
};

function readSource(root, rel) {
  const raw = readFileSync(join(root, rel), 'utf8');
  const code = maskComments(raw);
  return { rel, raw, code, masked: maskCode(raw), imports: importStatements(code) };
}

/** FlashList files and the local modules they import (one level): where a cell is recycled. */
function listFiles(runtime, { root, layout }) {
  const lists = runtime.filter((src) => src.imports.some((entry) => packageOf(entry.spec) === '@shopify/flash-list'));
  const files = new Set(lists.map((src) => src.rel));
  for (const src of lists) {
    for (const entry of src.imports) {
      if (entry.typeOnly) continue;
      const resolved = resolveSpecifier(src.rel, entry.spec, { root, aliases: layout.aliases });
      if (resolved) files.add(resolved);
    }
  }
  return files;
}

/** The permission kinds contracts/permissions.json lists (permissions-and-system-prompts); empty when absent or unreadable. */
function askedPermissionKinds(root) {
  const file = join(root, 'contracts', 'permissions.json');
  if (!existsSync(file)) return new Set();
  try {
    const contract = JSON.parse(readFileSync(file, 'utf8'));
    const entries = Array.isArray(contract?.permissions) ? contract.permissions : [];
    return new Set(entries.map((entry) => entry?.kind).filter((kind) => typeof kind === 'string'));
  } catch {
    return new Set(); // A broken contract is check-permissions' finding, not this checker's.
  }
}

/**
 * unused-permission: the picker's options when the code imports expo-image-picker; expo-media-library's
 * read permissions when the code imports it or app.config.ts lists it (prebuild applies both plugins
 * even when they are not listed).
 */
function checkAppConfig(report, root, runtime) {
  const use = captureUse(runtime, askedPermissionKinds(root));
  const file = 'app.config.ts';
  const reason = notYetCreated(root, { file, owner: 'app-variants-and-environment' });
  if (reason) {
    if (use.importsPicker || use.importsLibrary) report.skip({ file, rule: 'unused-permission', message: reason });
    return;
  }
  const config = readSource(root, file);
  const add = (problem) => report.problem(problem);
  if (use.importsPicker) checkUnusedPermissions(config, add, use);
  checkMediaLibraryReads(config, add, use);
}

function checkSweepWired(report, runtime, { dataDir }) {
  const creators = runtime.filter((src) => !src.rel.startsWith(`${dataDir}/media/`) && /\bcreateMediaImporter\s*\(/.test(src.masked));
  if (creators.length === 0) return;
  if (runtime.some((src) => /(?<!function\s)\bsweepMedia\s*\(/.test(src.masked))) return;
  const src = creators[0];
  report.problem({ file: src.rel, line: lineOf(src.raw, src.masked.search(/\bcreateMediaImporter\s*\(/)), rule: 'sweep-wired', message: 'the app imports media but never sweeps orphans: files left by a crash, an abandoned import or a deleted record stay on disk (and in device backups) for good', fix: 'Call sweepMedia({ store, referenced, sessionRefs: importer.sessionRefs() }) after startup, once the records are readable, and after a restore.' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = positionals[0] ?? '.';
  if (!existsSync(root)) fail(`nothing to check: ${root} does not exist`, 'Pass the app repo root.');
  const layout = resolveLayout(root);
  if (!existsSync(join(root, layout.srcDir))) fail(`nothing to check: no ${layout.srcDir}/`, 'Run it from the app root (the folder that holds src/), or pass that folder.');
  const report = createReporter({ name: 'check-media', json: options.json });

  const files = walkRepo(root, { include: ['*.ts', '*.tsx'] }).filter((rel) => rel.startsWith(`${layout.srcDir}/`) && !rel.endsWith('.d.ts'));
  const runtime = files.filter((rel) => !isTestFile(rel)).map((rel) => readSource(root, rel));
  const mediaStoreDir = `${layout.servicesDir}/media-store`;
  const usesMedia = runtime.some((src) => importsAny(src, MEDIA_PACKAGES)) || existsSync(join(root, mediaStoreDir));
  if (!usesMedia) {
    return report.notApplicable(`no source file under ${layout.srcDir}/ imports ${MEDIA_PACKAGES.join(', ')}, and there is no ${mediaStoreDir}/`);
  }

  const add = (problem) => report.problem(problem);
  const lists = listFiles(runtime, { root, layout });
  const permissionsDir = `${layout.servicesDir}/permissions`;
  const iconsDir = `${layout.uiDir}/icons/`;
  const transferAdapter = new RegExp(`^${layout.servicesDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/file-transfer/[^/]+-adapter(\\.(ios|android|native|web))?\\.tsx?$`);
  for (const src of runtime) {
    checkImageElements(src, add, { isListFile: lists.has(src.rel) });
    checkPickerOptions(src, add);
    checkPickerOnPress(src, add);
    checkPermissionGate(src, add, { permissionsDir });
    if (src.rel.startsWith(`${layout.dataDir}/`) || src.rel.startsWith(`${layout.storesDir}/`)) checkStoredUri(src, add);
    if (src.rel.startsWith(`${mediaStoreDir}/`)) checkMediaStoreFiles(src, add);
    // Icons are small Skia-made PNG masks kept as data URIs on purpose (icons-app-icon-and-splash).
    if (!src.rel.startsWith(iconsDir)) checkDataUri(src, add);
    checkLegacyApis(src, add);
    checkTransfers(src, add, { transferAdapter });
  }
  checkAppConfig(report, root, runtime);
  checkSweepWired(report, runtime, layout);
  return report.finish({ checked: runtime.length, unit: 'runtime files' });
});
