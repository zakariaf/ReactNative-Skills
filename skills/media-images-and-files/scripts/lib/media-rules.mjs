// media-rules.mjs: the rules of check-media.mjs, one function per rule family. Each takes a source
// record { rel, raw, code, masked } (raw text; comments blanked; comments and string contents
// blanked) and an `add(problem)` callback. Zero dependencies.
import { findClosing, findJsxTags, jsxAttributes } from './source-scan.mjs';
import { lineOf } from '../check-lib.mjs';

/** Packages whose presence in runtime imports makes the whole check apply. */
export const MEDIA_PACKAGES = Object.freeze([
  'expo-image',
  'expo-image-picker',
  'expo-camera',
  'expo-image-manipulator',
  'expo-media-library',
  'expo-file-system',
]);

/** expo-file-system 57: these main-entry names throw at runtime (or are undefined); `/legacy` is deprecated. */
export const FILE_SYSTEM_LEGACY = Object.freeze([
  'getInfoAsync', 'readAsStringAsync', 'getContentUriAsync', 'writeAsStringAsync', 'deleteAsync',
  'deleteLegacyDocumentDirectoryAndroid', 'moveAsync', 'copyAsync', 'makeDirectoryAsync',
  'readDirectoryAsync', 'getFreeDiskStorageAsync', 'getTotalDiskCapacityAsync', 'downloadAsync',
  'uploadAsync', 'createDownloadResumable', 'createUploadTask', 'documentDirectory', 'cacheDirectory', 'bundleDirectory',
  'StorageAccessFramework',
]);

/** expo-media-library 57: these main-entry names throw at runtime; `/legacy` is deprecated. */
export const MEDIA_LIBRARY_LEGACY = Object.freeze([
  'isAvailableAsync', 'presentPermissionsPickerAsync', 'createAssetAsync', 'saveToLibraryAsync',
  'addAssetsToAlbumAsync', 'removeAssetsFromAlbumAsync', 'deleteAssetsAsync', 'getAssetInfoAsync',
  'getAlbumsAsync', 'getAlbumAsync', 'createAlbumAsync', 'deleteAlbumsAsync', 'getAssetsAsync',
  'removeSubscription', 'getMomentsAsync', 'migrateAlbumIfNeededAsync', 'albumNeedsMigrationAsync',
  'setAssetFavoriteAsync', 'getAssetContentUriAsync',
]);

const LEGACY_BY_PACKAGE = Object.freeze({
  'expo-file-system': { names: FILE_SYSTEM_LEGACY, replacement: 'File, Directory and Paths (new File(Paths.document, name).text(), file.copy(), Paths.availableDiskSpace)' },
  'expo-media-library': { names: MEDIA_LIBRARY_LEGACY, replacement: 'the object API (Asset.create(uri), Album.create(), requestPermissionsAsync(true) for write-only)' },
});

const IMPORT_STATEMENT = /(^|\n)[ \t]*import\s+(type\s+)?([^'";]*?)\s*from\s*(['"])([^'"]+)\4/g;

/** Import statements: [{ spec, clause, typeOnly, index, named: Map<imported, local>, namespace, defaultName }]. */
export function importStatements(code) {
  const out = [];
  for (const match of code.matchAll(IMPORT_STATEMENT)) {
    const clause = match[3];
    const named = new Map();
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const entry = part.trim().replace(/^type\s+/, '');
        if (entry === '') continue;
        const [imported, local] = entry.split(/\s+as\s+/);
        named.set(imported.trim(), (local ?? imported).trim());
      }
    }
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1] ?? null;
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '');
    const defaultName = /^\s*([A-Za-z_$][\w$]*)/.exec(outside)?.[1] ?? null;
    out.push({ spec: match[5], clause, typeOnly: Boolean(match[2]), index: match.index + match[1].length, named, namespace, defaultName });
  }
  return out;
}

export const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** True when the source imports (a value or a type) from one of `packages` or their subpaths. */
export function importsAny(src, packages) {
  return src.imports.some((entry) => packages.includes(packageOf(entry.spec)));
}

// ------------------------------------------------------------------------------------------------
// expo-image elements: image-size, image-legacy-prop, image-a11y, list-recycling-key
// ------------------------------------------------------------------------------------------------

const LEGACY_IMAGE_PROPS = Object.freeze({
  resizeMode: 'contentFit',
  defaultSource: 'placeholder',
  loadingIndicatorSource: 'placeholder',
  fadeDuration: 'transition',
});

/** The local names of expo-image's Image and ImageBackground in a file. */
export function expoImageNames(src) {
  const names = { image: new Set(), background: new Set() };
  for (const entry of src.imports) {
    if (entry.spec !== 'expo-image' || entry.typeOnly) continue;
    if (entry.named.has('Image')) names.image.add(entry.named.get('Image'));
    if (entry.named.has('ImageBackground')) names.background.add(entry.named.get('ImageBackground'));
    if (entry.namespace) {
      names.image.add(`${entry.namespace}.Image`);
      names.background.add(`${entry.namespace}.ImageBackground`);
    }
  }
  return names;
}

/** Every expo-image element of a .tsx file: [{ tag, attrs, line, kind: 'image' | 'background' }]. */
export function expoImageElements(src) {
  if (!src.rel.endsWith('.tsx')) return [];
  const names = expoImageNames(src);
  if (names.image.size === 0 && names.background.size === 0) return [];
  const elements = [];
  for (const tag of findJsxTags(src.raw, src.masked)) {
    const kind = names.image.has(tag.name) ? 'image' : names.background.has(tag.name) ? 'background' : null;
    if (kind === null) continue;
    const attrs = jsxAttributes(src.raw, tag, src.masked);
    elements.push({ tag, attrs, kind, line: lineOf(src.raw, tag.start) });
  }
  return elements;
}

const hasSpread = (attrs) => [...attrs.keys()].some((key) => key.startsWith('...'));

export function checkImageElements(src, add, { isListFile }) {
  for (const { tag, attrs, kind, line } of expoImageElements(src)) {
    const spread = hasSpread(attrs);
    if (!attrs.has('style') && !spread) {
      add({ file: src.rel, line, rule: 'image-size', message: `<${tag.name}> has no style: an expo-image view without a size renders 0 x 0 or jumps when the image loads`, fix: 'Give it a box: style={styles.photo} with width and height, or one of them with aspectRatio (or flex inside a sized parent).' });
    }
    for (const [prop, replacement] of Object.entries(LEGACY_IMAGE_PROPS)) {
      if (attrs.has(prop)) add({ file: src.rel, line: lineOf(src.raw, attrs.get(prop).index), rule: 'image-legacy-prop', message: `<${tag.name} ${prop}> is React Native Image's prop, kept by expo-image only for compatibility (deprecated)`, fix: `Use ${replacement} instead.` });
    }
    if (kind === 'image' && !spread) checkImageName(src, add, { tag, attrs, line });
    if (kind === 'image' && !spread && isListFile && !attrs.has('recyclingKey')) {
      add({ file: src.rel, line, rule: 'list-recycling-key', message: `<${tag.name}> in a recycled list cell has no recyclingKey: a reused cell shows the previous row's image until the new one loads`, fix: 'Pass recyclingKey={item.id} (the row record id), or render StoredImage, which sets one.' });
    }
  }
}

function checkImageName(src, add, { tag, attrs, line }) {
  const accessible = attrs.get('accessible');
  const named = attrs.has('accessibilityLabel') || attrs.has('alt');
  if (accessible === undefined && named) {
    add({ file: src.rel, line, rule: 'image-a11y', message: `<${tag.name}> has a label but no accessible, so VoiceOver and TalkBack skip it: expo-image is not an accessibility element by default and ignores the label on its own`, fix: 'Add accessible beside the label (accessible accessibilityLabel={t(...)}), or replace the label with accessible={false} when the image is decorative.' });
    return;
  }
  if (accessible === undefined) {
    add({ file: src.rel, line, rule: 'image-a11y', message: `<${tag.name}> is neither named nor marked decorative: expo-image is not an accessibility element by default, so VoiceOver and TalkBack skip a content photo silently`, fix: 'A content image: accessible plus accessibilityLabel={t(...)} (or alt). A decorative one: accessible={false}, which records the decision.' });
    return;
  }
  const isFalse = accessible.kind === 'expr' && accessible.value === 'false';
  if (!isFalse && !named) {
    add({ file: src.rel, line, rule: 'image-a11y', message: `<${tag.name} accessible> has no accessibilityLabel or alt: the screen reader announces only "image"`, fix: 'Add accessibilityLabel={t(...)} describing what the image shows, or mark it decorative with accessible={false}.' });
  }
}

// ------------------------------------------------------------------------------------------------
// Picking: picker-options, picker-on-press, permission-outside-gate
// ------------------------------------------------------------------------------------------------

const LAUNCH_CALL = /\b(launchImageLibraryAsync|launchCameraAsync)\s*\(/g;
const PRESS_ONLY_CALL = /\b(launchImageLibraryAsync|launchCameraAsync|pickImages|capturePhoto|importFromLibrary|importFromCamera)\s*\(/;
const EFFECT_CALL = /\b(useEffect|useLayoutEffect|useFocusEffect|useInsertionEffect)\s*\(/g;

export function checkPickerOptions(src, add) {
  if (/\bMediaTypeOptions\b/.test(src.masked)) {
    const index = src.masked.search(/\bMediaTypeOptions\b/);
    add({ file: src.rel, line: lineOf(src.raw, index), rule: 'picker-options', message: 'MediaTypeOptions is deprecated in expo-image-picker 57', fix: "Pass mediaTypes: ['images'] (an array of 'images' | 'videos' | 'livePhotos')." });
  }
  if (![...src.masked.matchAll(LAUNCH_CALL)].length) return;
  for (const [pattern, why, fix] of [
    [/\bbase64\s*:\s*true\b/, 'base64: true puts the whole photo into JS as a string (4 to 8 MB for a 12 MP photo, several copies while it is passed around)', 'Drop base64; pass the file URI to the resizer, the media store or the upload adapter.'],
    [/\bexif\s*:\s*true\b/, 'exif: true hands the EXIF block to JS, including the GPS position of a library photo', 'Drop exif; the resizer re-encodes without metadata. A feature that truly needs one field reads it in the adapter and keeps only that field.'],
  ]) {
    const index = src.masked.search(pattern);
    if (index !== -1) add({ file: src.rel, line: lineOf(src.raw, index), rule: 'picker-options', message: why, fix });
  }
}

export function checkPickerOnPress(src, add) {
  for (const match of src.masked.matchAll(EFFECT_CALL)) {
    const open = match.index + match[0].length - 1;
    const close = findClosing(src.masked, open);
    if (close === -1) continue;
    const body = src.masked.slice(open, close);
    const inner = PRESS_ONLY_CALL.exec(body);
    if (inner) {
      add({ file: src.rel, line: lineOf(src.raw, open + inner.index), rule: 'picker-on-press', message: `${inner[1]}() runs inside ${match[1]}: a picker or the camera opens without the person asking (on mount, on focus, after a re-render)`, fix: 'Call it from the press handler the model hook exposes (onAddPhoto). Only importPendingPick runs at startup.' });
    }
  }
}

const PERMISSION_ASK = /\b(requestCameraPermissionsAsync|requestMediaLibraryPermissionsAsync|requestMicrophonePermissionsAsync|useCameraPermissions|useMediaLibraryPermissions|useMicrophonePermissions)\s*\(/g;
const LIBRARY_ASK = /\b(requestPermissionsAsync|usePermissions)\s*\(/g;

export function checkPermissionGate(src, add, { permissionsDir }) {
  if (src.rel.startsWith(`${permissionsDir}/`)) return;
  const asks = [...src.masked.matchAll(PERMISSION_ASK)];
  if (src.imports.some((entry) => packageOf(entry.spec) === 'expo-media-library')) asks.push(...src.masked.matchAll(LIBRARY_ASK));
  for (const ask of asks) {
    add({ file: src.rel, line: lineOf(src.raw, ask.index), rule: 'permission-outside-gate', message: `${ask[1]}() asks the OS outside ${permissionsDir}/: the system dialog appears with no explanation, and denied vs blocked is handled nowhere`, fix: `Ask through the PermissionsPort and its gate (permissions-and-system-prompts); its adapter in ${permissionsDir}/ is the only caller. The media picker reads the state only through the injected isCameraAllowed (the gate's access).` });
  }
}

// ------------------------------------------------------------------------------------------------
// App config: unused-permission
// ------------------------------------------------------------------------------------------------

/**
 * A config plugin entry of app.config.ts: null (not listed), or { index, options, start, end } where
 * `options` is the options object's text (null for a bare string entry) and start/end bound it.
 */
export function pluginEntry(raw, masked, name) {
  const pattern = new RegExp(`(['"])${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\1`, 'g');
  for (const match of raw.matchAll(pattern)) {
    // The quote must be real code (not inside a comment or another string).
    if (masked.slice(match.index, match.index + 1) !== match[1]) continue;
    let i = match.index + match[0].length;
    while (/\s/.test(masked[i] ?? '')) i += 1;
    if (masked[i] !== ',') return { index: match.index, options: null, start: i, end: i };
    i += 1;
    while (/\s/.test(masked[i] ?? '')) i += 1;
    if (masked[i] !== '{') return { index: match.index, options: null, start: i, end: i };
    const close = findClosing(masked, i);
    const end = close === -1 ? raw.length : close + 1;
    return { index: match.index, options: raw.slice(i, end), start: i, end };
  }
  return null;
}

/** The expo-image-picker plugin entry of app.config.ts (see pluginEntry). */
export const pickerPluginEntry = (raw, masked) => pluginEntry(raw, masked, 'expo-image-picker');

const CAMERA_PACKAGES = Object.freeze(['expo-camera', 'react-native-vision-camera']);
const PICKS_VIDEO = /mediaTypes\s*:\s*(?:\[[^\]]*|[^,}\n]*)['"](videos|livePhotos)['"]|MediaTypeOptions\.(All|Videos)/;
const AUDIO_RECORDING = /\b(useAudioRecorder|useAudioRecorderState|AudioRecorder|RecordingPresets|requestRecordingPermissionsAsync|getRecordingPermissionsAsync|prepareToRecordAsync)\b/;
const CAMERA_RECORDING = /\brecordAsync\s*\(|\bmode\s*=\s*(?:\{\s*)?['"]video['"]|\bmode\s*:\s*['"]video['"]/;
const VISION_RECORDING = /\bstartRecording\s*\(/;
const PICKER_CAMERA_PERMISSION = /\b(requestCameraPermissionsAsync|getCameraPermissionsAsync|useCameraPermissions)\b/;
const LIBRARY_READ = /\bnew\s+Query\s*\(|\b(getAssetsAsync|getAlbumsAsync|getAlbumAsync)\s*\(|\bAlbum\s*\.\s*(getAll|get)\s*\(/;

const importsValueFrom = (src, packages) =>
  src.imports.some((entry) => !entry.typeOnly && packages.includes(packageOf(entry.spec)));

/**
 * What the runtime code captures: the camera (launchCameraAsync, expo-image-picker's camera permission
 * functions, any expo-camera or react-native-vision-camera import, a `camera` entry of
 * contracts/permissions.json), the microphone (a picker that takes videos, expo-audio's recorder,
 * expo-camera's video recording, vision-camera's startRecording, a `microphone` entry) and library
 * reads (expo-media-library's Query, getAssetsAsync, Album.getAll ...). `askedKinds` holds the
 * permission kinds the app's contracts/permissions.json lists (permissions-and-system-prompts).
 */
export function captureUse(runtime, askedKinds = new Set()) {
  const camera =
    askedKinds.has('camera') ||
    runtime.some(
      (src) =>
        /\blaunchCameraAsync\s*\(/.test(src.masked) ||
        importsValueFrom(src, CAMERA_PACKAGES) ||
        (importsValueFrom(src, ['expo-image-picker']) && PICKER_CAMERA_PERMISSION.test(src.masked)),
    );
  const microphone = askedKinds.has('microphone') || runtime.some(
    (src) =>
      PICKS_VIDEO.test(src.code) ||
      (importsValueFrom(src, ['expo-audio']) && AUDIO_RECORDING.test(src.masked)) ||
      (importsValueFrom(src, ['expo-camera']) && CAMERA_RECORDING.test(src.masked)) ||
      (importsValueFrom(src, ['react-native-vision-camera']) && VISION_RECORDING.test(src.masked)),
  );
  const readsLibrary = runtime.some((src) => importsValueFrom(src, ['expo-media-library']) && LIBRARY_READ.test(src.masked));
  const importsPicker = runtime.some((src) => importsValueFrom(src, ['expo-image-picker']));
  const importsLibrary = runtime.some((src) => importsValueFrom(src, ['expo-media-library']));
  return { camera, microphone, readsLibrary, importsPicker, importsLibrary };
}

/**
 * Another plugin of app.config.ts declares the camera or the microphone (expo-camera listed, a
 * cameraPermission / microphonePermission string outside the picker's entry, recordAudioAndroid,
 * vision-camera's enableMicrophonePermission): blocking it through the picker would break that one.
 */
function otherCaptureDeclarations(config, picker) {
  const blank = (text) => (picker === null ? text : text.slice(0, picker.start) + ' '.repeat(picker.end - picker.start) + text.slice(picker.end));
  const code = blank(config.code);
  const declared = (pattern) => pattern.test(code);
  const camera =
    declared(/\b(cameraPermission|cameraPermissionText)\s*:\s*(?!false\b)\S/) ||
    (pluginEntry(config.code, config.masked, 'expo-camera') !== null && !declared(/\bcameraPermission\s*:\s*false\b/)) ||
    pluginEntry(config.code, config.masked, 'react-native-vision-camera') !== null;
  const microphone =
    declared(/\b(microphonePermission|microphonePermissionText)\s*:\s*(?!false\b)\S/) ||
    declared(/\b(recordAudioAndroid|enableMicrophonePermission)\s*:\s*true\b/);
  return { camera, microphone };
}

const BLOCKS_WHOLE_APP = 'The option blocks the permission for the whole app, not just for the picker (iOS loses the purpose string; Android gets tools:node="remove" for every package), so never set it while expo-camera, expo-audio or another recorder needs it.';

export function checkUnusedPermissions(config, add, use) {
  const picker = pickerPluginEntry(config.code, config.masked);
  const others = otherCaptureDeclarations(config, picker);
  const usesCamera = use.camera || others.camera;
  const usesMicrophone = use.microphone || others.microphone;
  if (picker === null) {
    if (!use.importsPicker || (usesCamera && usesMicrophone)) return;
    const unused = [!usesCamera && 'the camera', !usesMicrophone && 'the microphone (android.permission.RECORD_AUDIO)'].filter(Boolean).join(' and ');
    const plugins = config.masked.search(/\bplugins\s*:/);
    add({ file: config.rel, line: plugins === -1 ? 1 : lineOf(config.raw, plugins), rule: 'unused-permission', message: `the code imports expo-image-picker but app.config.ts does not list it: prebuild applies it anyway with its defaults, which declare ${unused} that no code uses`, fix: "List ['expo-image-picker', { photosPermission, cameraPermission, microphonePermission }] with the catalog texts and false for what no code uses (picking-and-capturing.md, section 8)." });
    return;
  }
  const line = lineOf(config.raw, picker.index);
  const options = picker.options ?? '';
  if (!usesCamera && !/\bcameraPermission\s*:\s*false\b/.test(options)) {
    add({ file: config.rel, line, rule: 'unused-permission', message: 'no source opens a camera or asks its permission (launchCameraAsync, expo-image-picker\'s camera permission functions, expo-camera, react-native-vision-camera, a camera entry in contracts/permissions.json) and no other plugin declares one, yet expo-image-picker keeps the camera permission (NSCameraUsageDescription on iOS, CAMERA from its Android manifest)', fix: `Pass cameraPermission: false to ['expo-image-picker', { ... }]; give it a catalog text when the app starts taking photos. ${BLOCKS_WHOLE_APP}` });
  }
  if (!usesMicrophone && !/\bmicrophonePermission\s*:\s*false\b/.test(options)) {
    add({ file: config.rel, line, rule: 'unused-permission', message: 'no source picks or records video or records sound (expo-audio, expo-camera, vision-camera), contracts/permissions.json has no microphone entry and no other plugin declares the microphone, yet expo-image-picker keeps it (NSMicrophoneUsageDescription, android.permission.RECORD_AUDIO by default)', fix: `Pass microphonePermission: false to ['expo-image-picker', { ... }]. ${BLOCKS_WHOLE_APP}` });
  }
}

/** True when the config keeps READ_MEDIA_IMAGES and READ_MEDIA_VIDEO out (granular list or blocked). */
function keepsLibraryReadsOut(config, entry) {
  const granular = /\bgranularPermissions\s*:\s*\[([^\]]*)\]/.exec(entry?.options ?? '');
  if (granular && !/['"](photo|video)['"]/.test(granular[1])) return true;
  const blocked = /\bblockedPermissions\s*:\s*\[([^\]]*)\]/.exec(config.code);
  return Boolean(blocked && /READ_MEDIA_IMAGES/.test(blocked[1]) && /READ_MEDIA_VIDEO/.test(blocked[1]));
}

export function checkMediaLibraryReads(config, add, use) {
  const entry = pluginEntry(config.code, config.masked, 'expo-media-library');
  if ((entry === null && !use.importsLibrary) || use.readsLibrary) return;
  if (keepsLibraryReadsOut(config, entry)) return;
  const plugins = config.masked.search(/\bplugins\s*:/);
  const line = entry !== null ? lineOf(config.raw, entry.index) : plugins === -1 ? 1 : lineOf(config.raw, plugins);
  const where = entry === null ? 'expo-media-library is not listed, so prebuild applies its defaults, which declare' : "expo-media-library's granularPermissions declare";
  add({ file: config.rel, line, rule: 'unused-permission', message: `${where} READ_MEDIA_IMAGES and READ_MEDIA_VIDEO, yet no source reads the library (Query, getAssetsAsync, Album.getAll): Google Play allows those only for apps whose core feature needs broad library access, and asks every other app for its Photo and Video Permissions declaration`, fix: "Save-only: ['expo-media-library', { savePhotosPermission, photosPermission: false, granularPermissions: [] }] plus android.blockedPermissions for READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_AUDIO and READ_MEDIA_VISUAL_USER_SELECTED (sharing-and-transfer.md, section 3); pick photos with the system picker instead of reading the library." });
}

// ------------------------------------------------------------------------------------------------
// Storage: stored-uri, overwrite-in-place, media-in-cache, sweep-wired, data-uri
// ------------------------------------------------------------------------------------------------

// A bare `uri` or any *uri / *Uri / *URI name (never *url), typed string or validated as a string.
const URI_FIELD = /(?<![\w$])((?:[A-Za-z_$][\w$]*?)?(?:uri|Uri|URI))\s*\??\s*:\s*(?:string\b|v\.string\s*\(|v\.(?:optional|nullable|nullish)\s*\(\s*v\.string\s*\()/g;
// A column named uri, *_uri or *Uri (SQL identifiers are case-insensitive) declared TEXT.
const URI_COLUMN = /(?<![\w$])((?:[a-z][a-z0-9_]*?)?uri)\s+TEXT\b/gi;

export function checkStoredUri(src, add) {
  for (const match of src.masked.matchAll(URI_FIELD)) {
    add({ file: src.rel, line: lineOf(src.raw, match.index), rule: 'stored-uri', message: `${match[1]} stores a file URI: the absolute path of the app's folders changes (a new iOS container after an update or restore, a new device on Android), so a stored URI breaks`, fix: 'Store the MediaRef (a plain file name, mediaRef: MediaRef) and resolve it with MediaStorePort.uriOf when it is shown. A server image is a URL: name it *Url.' });
  }
  for (const match of src.code.matchAll(URI_COLUMN)) {
    add({ file: src.rel, line: lineOf(src.raw, match.index), rule: 'stored-uri', message: `column ${match[1]} stores a file URI, which breaks when the app's folder path changes`, fix: 'Store the MediaRef in a *_ref (or *_media) TEXT column and resolve it at render time.' });
  }
}

export function checkMediaStoreFiles(src, add) {
  const overwrite = src.masked.search(/\boverwrite\s*:\s*true\b/);
  if (overwrite !== -1) {
    add({ file: src.rel, line: lineOf(src.raw, overwrite), rule: 'overwrite-in-place', message: 'the media store overwrites a file in place: image caches are keyed by URI, so every view keeps showing the old pixels, and a crash mid-write corrupts the only copy', fix: 'Write the changed image under a new MediaRef (a new id), save the record, then remove the old file.' });
  }
  const cache = src.masked.search(/new\s+(?:Directory|File)\s*\(\s*Paths\.cache\b/);
  if (cache !== -1) {
    add({ file: src.rel, line: lineOf(src.raw, cache), rule: 'media-in-cache', message: 'the media store keeps files under Paths.cache, which iOS and Android purge when storage runs low', fix: 'Keep stored media under Paths.document (kept, in device backups); the cache is only for temporaries.' });
  }
}

export function checkDataUri(src, add) {
  const index = src.code.search(/data:image\/[a-z0-9+.-]+;base64,/i);
  if (index !== -1) {
    add({ file: src.rel, line: lineOf(src.raw, index), rule: 'data-uri', message: 'a base64 data: URI image: the whole file lives in JS memory as a string, again in the native decoder, and no cache can reuse it', fix: 'Write the bytes to a file (or keep the file the picker made) and pass its file:// URI; for a placeholder use a blurhash or thumbhash.' });
  }
}

// ------------------------------------------------------------------------------------------------
// APIs: legacy-api, transfer-outside-port
// ------------------------------------------------------------------------------------------------

export function checkLegacyApis(src, add) {
  for (const entry of src.imports) {
    const pkg = packageOf(entry.spec);
    const legacy = LEGACY_BY_PACKAGE[pkg];
    if (!legacy) continue;
    const line = lineOf(src.raw, entry.index);
    if (entry.spec === `${pkg}/legacy`) {
      add({ file: src.rel, line, rule: 'legacy-api', message: `${entry.spec} is the deprecated API, kept for migration; the object API is the supported one`, fix: `Use ${legacy.replacement}.` });
      continue;
    }
    if (entry.spec !== pkg) continue;
    for (const name of entry.named.keys()) {
      if (legacy.names.includes(name)) add({ file: src.rel, line, rule: 'legacy-api', message: `${name} from '${pkg}' throws at runtime in SDK 57 (or is undefined)`, fix: `Use ${legacy.replacement}.` });
    }
    for (const local of [entry.namespace, entry.defaultName].filter(Boolean)) {
      for (const access of src.masked.matchAll(new RegExp(`\\b${local.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
        if (legacy.names.includes(access[1])) add({ file: src.rel, line: lineOf(src.raw, access.index), rule: 'legacy-api', message: `${local}.${access[1]} from '${pkg}' throws at runtime in SDK 57 (or is undefined)`, fix: `Use ${legacy.replacement}.` });
      }
    }
  }
}

const TRANSFER_CALL = /\b(downloadFileAsync|createDownloadTask|createUploadTask)\s*\(|\.(upload)\s*\(/g;

export function checkTransfers(src, add, { transferAdapter }) {
  if (transferAdapter.test(src.rel)) return;
  if (!src.imports.some((entry) => packageOf(entry.spec) === 'expo-file-system')) return;
  for (const match of src.masked.matchAll(TRANSFER_CALL)) {
    const name = match[1] ?? match[2];
    add({ file: src.rel, line: lineOf(src.raw, match.index), rule: 'transfer-outside-port', message: `${name}() moves a file over the network outside the file-transfer adapter: the app's network policy (one transport per kind, base URL and auth from src/api and the session) is bypassed`, fix: 'Upload and download through FileTransferPort (src/services/file-transfer/, the skill\'s examples): its adapter is the one file that calls expo-file-system\'s network API, with the URL built by src/api.' });
  }
}
