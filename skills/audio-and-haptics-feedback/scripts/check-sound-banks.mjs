#!/usr/bin/env node
// check-sound-banks.mjs: renders every synthesized sound of an Expo app (the UI sounds and each
// feature's or game's bank) with a byte-exact port of the app's synth, checks each recipe against the
// quality gate, cross-checks every cue against its bank, proves the app's synth still matches the
// port, and optionally writes the WAV previews a human listens to.
// Run from the app repo root: node ${CLAUDE_SKILL_DIR}/scripts/check-sound-banks.mjs [repo-root] [--wav-dir dir]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { createReporter, fail, lineOf, maskComments, parseArgs, requireDir, resolveLayout, run, sha256, toPosix, walkRepo } from './check-lib.mjs';
import { enableAppImports, reasonOf } from './lib/app-modules.mjs';
import { GOLDEN_RECIPE, GOLDEN_WAV_SHA256, LIMITS, RATE, encodeWav, recipeProblems, selfCheck, synthesizeRecipe } from './lib/synth.mjs';
import { LiteralError, findConstInitializer, parseObjectEntries } from './lib/ts-literal.mjs';

const SPEC = {
  name: 'check-sound-banks',
  summary: 'Checks every synthesized sound (UI_SOUNDS and each src/**/sounds/<name>-sounds.ts bank) and every cue that names a sound.',
  usage: '[repo-root] [options]',
  options: {
    owner: { type: 'string', multiple: true, value: 'name', help: 'Check only this feature or game folder (src/features/<name>, src/games/<name>); the UI sounds are always checked' },
    'wav-dir': { type: 'string', value: 'dir', help: 'Also write every clean sound as a 48 kHz WAV to <dir>/<ui|owner>/<id>.wav (reports/sfx is git-ignored)' },
    'src-dir': { type: 'string', value: 'dir', help: 'The source folder (default: from resolveLayout, src)' },
    json: { type: 'boolean', help: 'Also print the problems as one JSON line' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Banks: the UI sounds (src/services/audio/synth/ui-sounds.ts, const UI_SOUNDS, ids ui.<kebab>) and every',
    'src/**/sounds/<name>-sounds.ts exporting const <NAME>_SOUNDS (a feature\'s or game\'s bank). The folder that holds',
    'sounds/ owns the bank: its cues name its ids.',
    'Rules:',
    '  recipe-literal  a recipe is literal data (numbers and strings inline, no constants, spreads or calls)',
    `  recipe-quality  renders finite samples, peak ${LIMITS.minPeak}-${LIMITS.maxPeak}, first sample < ${LIMITS.maxFirstSample}, last < ${LIMITS.maxLastSample},`,
    `                  ${LIMITS.minDurationMs} ms to ${LIMITS.maxEffectMs} ms (music up to ${LIMITS.maxMusicMs} ms), sane voice fields`,
    '  sound-id        UI ids are ui.<kebab>; bank ids are kebab-case, never ui., and unique across banks',
    '  bank-category   bank sounds are sfx (no isLoop) or the one music entry of the app with isLoop: true',
    '  bank-missing    a feature or game that cues a sound has its bank; an app with an audio layer has UI_SOUNDS',
    "  cue-unknown     every cued id is in its owner's bank (or, outside a feature or game, in some bank). A cue is",
    "                  sound: 'id' inside a cue object (a *-feedback.ts table, a literal typed or satisfying",
    "                  FeedbackCue/TrackCue, a track's cue: { ... }, a playCue(...) argument), audio.play('id') on the",
    "                  audio port, or startMusic('id'); other sound: keys (notification content) and other .play()",
    '                  receivers (Lottie, a celebration hook) are not cues',
    '  sound-unused    every sfx id of a bank is cued inside its owner (UI sounds: anywhere in src)',
    '  bank-test       <name>-sounds.test.ts runs recipeProblems over the bank',
    '  bank-unwired    the bank is passed to composeSoundBank (the root layout loads the one composed bank)',
    "  synth-drift     the app's synthesizeRecipe renders the golden recipe byte-identically to this checker's port",
    '',
    'NOT APPLICABLE when there is no bank, no src/services/audio and no source file imports react-native-audio-api;',
    'exit 2 without a package.json.',
    'Example: node check-sound-banks.mjs . --wav-dir reports/sfx   (then listen to the WAVs)',
  ].join('\n'),
};

const UI_ID = /^ui\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const BANK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Sound cues. Calls on the audio port always count (audio.play, services.audio.play, audio?.play) and
// startMusic; a sound: key counts only inside a cue object (isCueObject), so notification content
// ({ title, sound: 'default' }) and other players (lottie.play('intro')) are not mistaken for cues.
const PORT_CUES = [/\baudio\s*\??\.\s*play\(\s*['"]([^'"]+)['"]/g, /\bstartMusic\(\s*['"]([^'"]+)['"]/g];
const SOUND_KEY = /\bsound\s*:\s*['"]([^'"]+)['"]/g;
const CUE_TABLE_FILE = /-feedback\.tsx?$/;
const TYPE_TEXT = String.raw`[\w<>\[\],.|&\s]*`;
const CUE_TYPE = String.raw`\b\w*(?:FeedbackCue|TrackCue)\b`;
const CUE_ANNOTATION = new RegExp(String.raw`:\s*${TYPE_TEXT}${CUE_TYPE}${TYPE_TEXT}=\s*$`);
const CUE_SATISFIES = new RegExp(String.raw`^\s*(?:as\s+const\s*)?(?:satisfies|as)\s+${TYPE_TEXT}?${CUE_TYPE}`);
const SPEC_FIELDS = new Set(['category', 'recipe', 'minIntervalMs', 'isLoop']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;
const BANK_FILE = /(^|\/)sounds\/([a-z0-9]+(?:-[a-z0-9]+)*)-sounds\.ts$/;

function readRel(root, rel) {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** Parses `const <name> = { ... }` into entries; reports a file-level problem when it cannot. */
function readEntries(root, rel, name, report) {
  const source = readRel(root, rel);
  if (source === null) return null;
  const start = findConstInitializer(source, name);
  if (start === -1) {
    report.problem({ file: rel, line: 1, rule: 'recipe-literal', message: `no \`const ${name} = { ... }\` found`, fix: `Export the bank as \`export const ${name}: SoundBank = { ... }\` with literal recipes.` });
    return { source, entries: [] };
  }
  try {
    return { source, entries: parseObjectEntries(source, start) };
  } catch (error) {
    if (!(error instanceof LiteralError)) throw error;
    report.problem({ file: rel, line: lineOf(source, error.index), rule: 'recipe-literal', message: `${name} is not a plain object literal: ${error.message}`, fix: 'Write the bank as one object literal of literal recipes.' });
    return { source, entries: [] };
  }
}

/** The text between a call's opening parenthesis (at `from`) and its matching closing one. */
function callArguments(source, from) {
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')' && (depth -= 1) === 0) return source.slice(from, i);
  }
  return '';
}

function literalProblem(report, rel, source, entry) {
  report.problem({ file: rel, line: lineOf(source, entry.errorIndex), rule: 'recipe-literal', message: `sound "${entry.key}": ${entry.error}`, fix: 'Write recipes as literal data (numbers and strings inline) so the quality gate and the WAV preview can read them.' });
}

function checkRecipe(report, where, id, recipe, maxMs) {
  const problems = recipeProblems(recipe, maxMs);
  for (const problem of problems) {
    report.problem({ ...where, rule: 'recipe-quality', message: `sound "${id}" ${problem}`, fix: 'Tune the recipe (attackMs 1-8 ms, gain 0.15-0.5, the lengths in the sound design guide), then listen to the WAV preview.' });
  }
  return problems.length === 0;
}

function writeWav(wavDir, group, id, recipe) {
  const dir = join(wavDir, group);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.wav`), encodeWav(synthesizeRecipe(recipe, RATE), RATE));
}

/** Every bank file: { rel, owner (the folder holding sounds/), name (folder name), constant }. */
function findBanks(root, layout) {
  if (!existsSync(join(root, layout.srcDir))) return [];
  return walkRepo(root, { include: ['*-sounds.ts'] })
    .filter((rel) => rel.startsWith(`${layout.srcDir}/`) && BANK_FILE.test(rel) && !TEST_FILE.test(rel))
    .map((rel) => {
      const stem = BANK_FILE.exec(rel)[2];
      const owner = dirname(dirname(rel));
      return { rel, owner, name: basename(owner), constant: `${stem.replaceAll('-', '_').toUpperCase()}_SOUNDS` };
    });
}

/** Folders that own sounds: src/features/<name> and src/games/<name>. */
function ownerFolderOf(layout, rel) {
  for (const base of [layout.featuresDir, `${layout.srcDir}/games`]) {
    const match = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/`).exec(rel);
    if (match) return `${base}/${match[1]}`;
  }
  return null;
}

/** Every bracket pair of a comment-masked source ({ open, close, ch }), skipping strings and templates. */
function bracketPairs(source) {
  const pairs = [];
  const stack = [];
  const closers = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      i = j;
    } else if (ch === '(' || ch === '[' || ch === '{') stack.push({ open: i, ch });
    else if (closers[ch] !== undefined) {
      while (stack.length > 0 && stack.at(-1).ch !== closers[ch]) stack.pop();
      const top = stack.pop();
      if (top !== undefined) pairs.push({ ...top, close: i });
    }
  }
  return pairs;
}

/**
 * Whether a sound: key at `index` sits in a cue object: an object after `cue:`, a playCue(...) argument,
 * or an object literal annotated with, or satisfying, a FeedbackCue/TrackCue type (any level up).
 */
function isCueObject(source, pairs, index) {
  const enclosing = pairs.filter((pair) => pair.open < index && index < pair.close).sort((a, b) => b.open - a.open);
  return enclosing.some(({ open, close, ch }) => {
    const before = source.slice(Math.max(0, open - 200), open);
    if (ch === '(') return /\bplayCue\s*$/.test(before);
    if (ch !== '{') return false;
    return /\bcue\s*:\s*$/.test(before) || CUE_ANNOTATION.test(before) || CUE_SATISFIES.test(source.slice(close + 1, close + 200));
  });
}

function findCues(files) {
  const cues = [];
  for (const { rel, source } of files) {
    for (const pattern of PORT_CUES) {
      for (const match of source.matchAll(pattern)) cues.push({ id: match[1], file: rel, line: lineOf(source, match.index) });
    }
    const isTable = CUE_TABLE_FILE.test(rel);
    const pairs = isTable ? [] : bracketPairs(source);
    for (const match of source.matchAll(SOUND_KEY)) {
      if (isTable || isCueObject(source, pairs, match.index)) cues.push({ id: match[1], file: rel, line: lineOf(source, match.index) });
    }
  }
  return cues;
}

function checkSpec(report, where, entry) {
  const spec = entry.value;
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    report.problem({ ...where, rule: 'bank-category', message: `sound "${entry.key}" is not a { category, recipe } object`, fix: "Write { category: 'sfx', recipe: [ ... ] }." });
    return null;
  }
  const unknown = Object.keys(spec).filter((key) => !SPEC_FIELDS.has(key));
  if (unknown.length > 0) report.problem({ ...where, rule: 'bank-category', message: `sound "${entry.key}" has unknown field(s) ${unknown.join(', ')}`, fix: 'A SoundSpec has only category, recipe, minIntervalMs and isLoop.' });
  if (spec.category !== 'sfx' && spec.category !== 'music') {
    report.problem({ ...where, rule: 'bank-category', message: `sound "${entry.key}" has category ${JSON.stringify(spec.category)}`, fix: "Bank sounds are 'sfx' (or the one looped 'music'); 'ui' belongs to UI_SOUNDS." });
  } else if (spec.category === 'music' && spec.isLoop !== true) {
    report.problem({ ...where, rule: 'bank-category', message: `music "${entry.key}" is not looped`, fix: 'Set isLoop: true on the music entry.' });
  } else if (spec.category === 'sfx' && spec.isLoop === true) {
    report.problem({ ...where, rule: 'bank-category', message: `effect "${entry.key}" sets isLoop`, fix: 'Only music loops; an effect plays once.' });
  }
  if (spec.minIntervalMs !== undefined && !(typeof spec.minIntervalMs === 'number' && spec.minIntervalMs >= 0 && spec.minIntervalMs <= 1000)) {
    report.problem({ ...where, rule: 'bank-category', message: `sound "${entry.key}" minIntervalMs must be a number from 0 to 1000`, fix: 'Use e.g. minIntervalMs: 60 for rapid hits (the voice policy remembers voices for 1000 ms).' });
  }
  return spec;
}

/** The UI sounds: ids and recipes. Returns Map id → where. */
function checkUiSounds(ctx, report) {
  const { root, uiRel, options, stats } = ctx;
  const parsed = readEntries(root, uiRel, 'UI_SOUNDS', report);
  const ids = new Map();
  if (parsed === null) return ids;
  for (const entry of parsed.entries) {
    stats.checked += 1;
    const where = { file: uiRel, line: lineOf(parsed.source, entry.index) };
    ids.set(entry.key, { ...where, isMusic: false });
    if (!UI_ID.test(entry.key)) report.problem({ ...where, rule: 'sound-id', message: `UI sound id "${entry.key}" is not ui.<kebab>`, fix: 'Name UI sounds ui.toggle, ui.success, ui.error ... so feature ids can never collide with them.' });
    if (entry.error) {
      literalProblem(report, uiRel, parsed.source, entry);
      continue;
    }
    if (checkRecipe(report, where, entry.key, entry.value, LIMITS.maxEffectMs) && options['wav-dir']) {
      writeWav(options['wav-dir'], 'ui', entry.key, entry.value);
      stats.wavs += 1;
    }
  }
  return ids;
}

/** One feature or game bank. Returns Map id → where (with isMusic). */
function checkBank(ctx, bank, report) {
  const { root, options, stats } = ctx;
  const parsed = readEntries(root, bank.rel, bank.constant, report);
  const ids = new Map();
  for (const entry of parsed?.entries ?? []) {
    stats.checked += 1;
    const where = { file: bank.rel, line: lineOf(parsed.source, entry.index) };
    ids.set(entry.key, { ...where, isMusic: false });
    if (!BANK_ID.test(entry.key)) report.problem({ ...where, rule: 'sound-id', message: `sound id "${entry.key}" is not a kebab-case noun${entry.key.startsWith('ui.') ? ' (ui. is the UI sounds\' namespace)' : ''}`, fix: "Name sounds after what happened: 'complete', 'goal', 'streak', 'delete'." });
    if (entry.error) {
      literalProblem(report, bank.rel, parsed.source, entry);
      continue;
    }
    const spec = checkSpec(report, where, entry);
    if (spec === null) continue;
    if (spec.category === 'music') ids.set(entry.key, { ...where, isMusic: true });
    const limit = spec.category === 'music' ? LIMITS.maxMusicMs : LIMITS.maxEffectMs;
    if (checkRecipe(report, where, entry.key, spec.recipe, limit) && options['wav-dir']) {
      writeWav(options['wav-dir'], bank.name, entry.key, spec.recipe);
      stats.wavs += 1;
    }
  }
  const testRel = bank.rel.replace(/\.ts$/, '.test.ts');
  const testSource = readRel(root, testRel);
  if (testSource === null || !/\brecipeProblems\b/.test(testSource)) report.problem({ file: testRel, line: 1, rule: 'bank-test', message: `no bank test that runs recipeProblems over ${bank.constant}`, fix: 'Copy templates/src/features/__FEATURE__/sounds/__FEATURE__-sounds.test.ts next to the bank.' });
  const wired = ctx.composed.some((args) => new RegExp(`\\b${bank.constant}\\b`).test(args));
  if (!wired) report.problem({ file: bank.rel, line: 1, rule: 'bank-unwired', message: `${bank.constant} is never passed to composeSoundBank, so none of its sounds is loaded`, fix: `In the root layout: services.audio.load(composeSoundBank(${bank.constant}, ...)).` });
  return ids;
}

function checkCues(ctx, banks, uiIds, report) {
  const all = new Map(uiIds);
  for (const { ids } of banks) for (const [id, where] of ids) all.set(id, where);
  const byOwner = new Map(banks.map((bank) => [bank.owner, bank]));
  const cued = new Map();
  const missingReported = new Set();
  for (const cue of findCues(ctx.files)) {
    const owner = ownerFolderOf(ctx.layout, cue.file);
    const bank = owner === null ? undefined : byOwner.get(owner);
    if (ctx.only.length > 0 && (owner === null || !ctx.only.includes(basename(owner)))) continue;
    ctx.stats.checked += 1;
    cued.set(cue.id, [...(cued.get(cue.id) ?? []), owner]);
    if (owner !== null && bank === undefined) {
      if (!missingReported.has(owner)) report.problem({ file: cue.file, line: cue.line, rule: 'bank-missing', message: `${owner} cues sound "${cue.id}" but has no sounds/${basename(owner)}-sounds.ts`, fix: 'Copy templates/src/features/__FEATURE__/sounds/ (bank and test) and add one recipe per cued sound.' });
      missingReported.add(owner);
    } else if (bank !== undefined && !bank.ids.has(cue.id)) {
      report.problem({ file: cue.file, line: cue.line, rule: 'cue-unknown', message: `cue names sound "${cue.id}", which is not in ${bank.constant}`, fix: `Add "${cue.id}" to ${bank.rel}, or fix the id (UI moments play through playUiFeedback).` });
    } else if (bank === undefined && !all.has(cue.id) && !(cue.id.startsWith('ui.') && !ctx.hasUiBank)) {
      report.problem({ file: cue.file, line: cue.line, rule: 'cue-unknown', message: `cue names sound "${cue.id}", which no bank holds`, fix: 'Add it to the bank of the feature it belongs to, or fix the id.' });
    }
  }
  for (const bank of banks) {
    for (const [id, where] of bank.ids) {
      if (!where.isMusic && !(cued.get(id) ?? []).includes(bank.owner)) report.problem({ file: where.file, line: where.line, rule: 'sound-unused', message: `sound "${id}" is never cued in ${bank.owner}`, fix: `Cue it from the feature's cue table (sound: '${id}') or a track cue, or delete it.` });
    }
  }
  for (const [id, where] of ctx.only.length > 0 ? [] : uiIds) {
    if (!cued.has(id)) report.problem({ file: where.file, line: where.line, rule: 'sound-unused', message: `UI sound "${id}" is never cued`, fix: `Give it a moment in UI_FEEDBACK (sound: '${id}') or delete it.` });
  }
}

function checkDuplicates(banks, uiIds, report) {
  const seen = new Map(uiIds);
  let musicCount = 0;
  for (const bank of banks) {
    for (const [id, where] of bank.ids) {
      if (where.isMusic) musicCount += 1;
      const first = seen.get(id);
      if (first !== undefined && first.file !== where.file) report.problem({ ...where, rule: 'sound-id', message: `sound id "${id}" is also in ${first.file}`, fix: 'Ids are unique across banks (composeSoundBank throws on a clash): rename one.' });
      if (first === undefined) seen.set(id, where);
    }
  }
  if (musicCount > 1) report.problem({ file: banks.find((bank) => [...bank.ids.values()].some((where) => where.isMusic))?.rel ?? '', line: 1, rule: 'bank-category', message: `${musicCount} music entries across the banks`, fix: 'The app has at most one looped music entry (most have none).' });
}

async function checkSynthDrift(root, layout, synthRel, report) {
  if (!existsSync(join(root, synthRel))) return;
  let synthesize;
  try {
    const app = enableAppImports(root, { aliases: layout.aliases });
    ({ synthesizeRecipe: synthesize } = await app.load(synthRel));
  } catch (error) {
    report.problem({ file: synthRel, line: 1, rule: 'synth-drift', message: `the app's synth cannot be loaded as pure TypeScript: ${reasonOf(error)}`, fix: 'Keep synthesize-recipe.ts pure (only @/core/rng/sfc32 and types), as the template is.' });
    return;
  }
  if (typeof synthesize !== 'function') {
    report.problem({ file: synthRel, line: 1, rule: 'synth-drift', message: 'synthesize-recipe.ts does not export synthesizeRecipe', fix: 'Copy templates/src/services/audio/synth/synthesize-recipe.ts.' });
    return;
  }
  const hash = sha256(encodeWav(synthesize(GOLDEN_RECIPE, RATE), RATE));
  if (hash !== GOLDEN_WAV_SHA256) report.problem({ file: synthRel, line: 1, rule: 'synth-drift', message: "the app's synthesizeRecipe no longer renders like this checker's port (golden WAV sha256 differs)", fix: 'Revert the synth change, or change the port in scripts/lib/synth.mjs and its golden hash with it: otherwise the quality gate and the WAV previews judge a different sound than the device plays.' });
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to check: ${root} has no package.json, so it is not an app repo root`, 'Run from the app repo root, or pass it as the first argument.');
  selfCheck();
  const layout = resolveLayout(root, { srcDir: options['src-dir'] });
  const report = createReporter({ name: SPEC.name, json: options.json });
  const audioDir = `${layout.servicesDir}/audio`;
  const uiRel = `${audioDir}/synth/ui-sounds.ts`;
  const files = (existsSync(join(root, layout.srcDir)) ? walkRepo(root, { include: ['*.ts', '*.tsx'] }) : [])
    .filter((rel) => rel.startsWith(`${layout.srcDir}/`) && !TEST_FILE.test(rel) && !BANK_FILE.test(rel) && rel !== uiRel)
    .map((rel) => ({ rel, source: maskComments(readFileSync(join(root, rel), 'utf8')) }));
  const banks = findBanks(root, layout);
  const usesAudio = existsSync(join(root, audioDir)) || files.some((file) => /from\s+['"]react-native-audio-api['"]/.test(file.source));
  if (banks.length === 0 && !existsSync(join(root, uiRel)) && !usesAudio) return report.notApplicable(`no sound bank, no ${audioDir} and no source file imports react-native-audio-api`);
  const only = options.owner;
  const unknown = only.filter((name) => !banks.some((bank) => bank.name === name) && !files.some((file) => ownerFolderOf(layout, file.rel)?.endsWith(`/${name}`)));
  if (unknown.length > 0) fail(`nothing to check: no feature or game folder "${unknown[0]}" with sounds or cues in ${root}`, `Pass an existing owner (${banks.map((bank) => bank.name).join(', ') || 'none found'}).`);
  if (options['wav-dir']) options['wav-dir'] = resolve(options['wav-dir']);
  const composed = files.flatMap((file) => [...file.source.matchAll(/\bcomposeSoundBank\s*\(/g)].map((match) => callArguments(file.source, match.index + match[0].length)));
  const ctx = { root, layout, uiRel, options, files, only, composed, hasUiBank: existsSync(join(root, uiRel)), stats: { checked: 0, wavs: 0 } };
  if (usesAudio && !existsSync(join(root, uiRel))) report.problem({ file: uiRel, line: 0, rule: 'bank-missing', message: 'the app has an audio layer but no UI_SOUNDS', fix: 'Copy templates/src/services/audio/synth/ui-sounds.ts (one sound per UI_FEEDBACK moment).' });
  const uiIds = checkUiSounds(ctx, report);
  const checked = banks.filter((bank) => only.length === 0 || only.includes(bank.name)).map((bank) => ({ ...bank, ids: checkBank(ctx, bank, report) }));
  checkDuplicates(checked, uiIds, report);
  checkCues(ctx, checked, uiIds, report);
  await checkSynthDrift(root, layout, `${audioDir}/synth/synthesize-recipe.ts`, report);
  if (options['wav-dir']) report.note(`wrote ${ctx.stats.wavs} WAV files to ${toPosix(relative(process.cwd(), options['wav-dir'])) || '.'}`);
  return report.finish({ checked: ctx.stats.checked, unit: 'sounds and cues' });
});
