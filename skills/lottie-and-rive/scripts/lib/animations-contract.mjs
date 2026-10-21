// animations-contract.mjs: loads contracts/animations.json and judges its budgets and records (a
// helper of check-animations.mjs, not an entry point). Every problem goes to the reporter with the
// contract line of the key at fault.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { fail, lineOf } from '../check-lib.mjs';

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PLACEHOLDER = /^(todo|tbd|unknown|n\/a|none|-+|\?+|x+|fill me)$/i;

/** Reads and parses the contract, or stops with exit 2 and the fix. */
export function loadContract(root, contractRel) {
  const abs = join(root, contractRel);
  const fix = `Copy templates/contracts/animations.json and animations.schema.json of the lottie-and-rive skill to ${contractRel.replace(/[^/]+$/, '')}, then add one record per Lottie or Rive file.`;
  if (!existsSync(abs)) fail(`${contractRel} not found: the animation records are missing`, fix);
  const text = readFileSync(abs, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    fail(`${contractRel} is not valid JSON (${String(error.message).split('\n')[0]})`, 'Fix the JSON; animations.schema.json describes every key.');
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.animations)) {
    fail(`${contractRel} has no "animations" list`, 'Write { "animations": [] } at least; animations.schema.json describes every key.');
  }
  return { rel: contractRel, text, data };
}

/** The line of `"key"` inside record `index` (the record's first line when the key is absent). */
export function recordLine(contract, index, key) {
  const { text, data } = contract;
  const listAt = Math.max(0, text.indexOf('"animations"'));
  const starts = [];
  let from = listAt;
  for (const record of data.animations) {
    const anchor = record && typeof record === 'object' && typeof record.id === 'string' ? `"id": ${JSON.stringify(record.id)}` : '{';
    const at = text.indexOf(anchor, from);
    starts.push(at === -1 ? from : at);
    from = (at === -1 ? from : at) + 1;
  }
  const start = starts[index] ?? listAt;
  const end = starts[index + 1] ?? text.length;
  const keyAt = key ? text.indexOf(`"${key}"`, start) : -1;
  return lineOf(text, keyAt !== -1 && keyAt < end ? keyAt : start);
}

/** The contract line of a top-level key (budgets.<key> when nested is given). */
export function keyLine(contract, key, nested) {
  const { text } = contract;
  const at = text.indexOf(`"${key}"`);
  if (at === -1) return 1;
  if (!nested) return lineOf(text, at);
  const inner = text.indexOf(`"${nested}"`, at);
  return lineOf(text, inner === -1 ? at : inner);
}

/** The app's budgets: library defaults, then the contract's, each checked against the ceiling. */
export function judgeBudgets(contract, table, report) {
  const { defaults, ceilings } = table.budgets;
  const given = contract.data.budgets && typeof contract.data.budgets === 'object' ? contract.data.budgets : {};
  const budgets = { ...defaults };
  for (const [key, ceiling] of Object.entries(ceilings)) {
    const value = given[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !(value > 0) || value > ceiling) {
      report.problem({ file: contract.rel, line: keyLine(contract, 'budgets', key), rule: 'unbudgeted-file', message: `budgets.${key} is ${JSON.stringify(value)}, looser than the library ceiling ${ceiling}`, fix: `Set budgets.${key} to ${ceiling} or less; a looser budget is no budget.` });
      continue;
    }
    budgets[key] = value;
  }
  return budgets;
}

/** The Lottie header of a .json file ({ fr, ip, op, frLine }), or null when it is not a Lottie file. */
export function lottieHeader(abs) {
  let data;
  const text = readFileSync(abs, 'utf8');
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const isLottie = data !== null && typeof data === 'object' && ['fr', 'ip', 'op'].every((key) => typeof data[key] === 'number') && Array.isArray(data.layers);
  if (!isLottie) return null;
  const frAt = text.search(/"fr"\s*:/);
  return { fr: data.fr, ip: data.ip, op: data.op, frLine: frAt === -1 ? 1 : lineOf(text, frAt) };
}

const isText = (value) => typeof value === 'string' && value.trim().length >= 2 && !PLACEHOLDER.test(value.trim()) && !/__[A-Z_]+__/.test(value);

/** Judges every record: source, runtime and job, budget, frame rate, bounds, reduced motion, licence. */
export function judgeRecords({ root, contract, table, budgets, report }) {
  const byRuntime = Object.fromEntries(Object.entries(table.approved).map(([pkg, entry]) => [entry.runtime, { pkg, ...entry }]));
  const records = [];
  contract.data.animations.forEach((record, index) => {
    const at = (key) => ({ file: contract.rel, line: recordLine(contract, index, key) });
    const problem = (key, rule, message, fix) => report.problem({ ...at(key), rule, message, fix });
    if (record === null || typeof record !== 'object') {
      problem(null, 'unbudgeted-file', `animations[${index}] is not a record`, 'Write one object per file; animations.schema.json describes it.');
      return;
    }
    const name = typeof record.id === 'string' ? record.id : `animations[${index}]`;
    if (typeof record.file !== 'string' || record.file.length === 0) {
      problem('file', 'unbudgeted-file', `${name} names no file`, 'Set "file" to the repo-relative path of the bundled file.');
      return;
    }
    if (URL_LIKE.test(record.file)) {
      problem('file', 'remote-animation-source', `${name} points at ${record.file}, a remote file`, 'Download the file into assets/animations/, bundle it, and record that path: a remote animation fails offline and can change under the app.');
      return;
    }
    records.push({ ...record, index, name });
    judgeRuntime(record, name, byRuntime, problem);
    judgeLicence(record, name, problem);
    judgeReduced(record, name, problem);
    judgeBudget({ root, record, name, budgets, problem, report });
  });
  return records;
}

function judgeRuntime(record, name, byRuntime, problem) {
  const runtime = byRuntime[record.runtime];
  if (!runtime) {
    problem('runtime', 'unapproved-runtime', `${name} has runtime ${JSON.stringify(record.runtime)}`, 'Use "lottie" (lottie-react-native) or "rive" (@rive-app/react-native), the two approved runtimes.');
    return;
  }
  const ext = extname(record.file).toLowerCase();
  if (!runtime.extensions.includes(ext)) {
    problem('runtime', 'unapproved-runtime', `${name} plays a ${ext} file with ${record.runtime}`, `${runtime.pkg} plays ${runtime.extensions.join(' and ')} files; record the runtime that plays this file.`);
  }
  if (!runtime.jobs.includes(record.job)) {
    problem('job', 'unapproved-runtime', `${name} gives ${record.runtime} the job ${JSON.stringify(record.job)}`, `${record.runtime} is approved for ${runtime.jobs.join(' and ')} only (${runtime.why}); use the other runtime, or Reanimated for UI motion (motion-and-animation).`);
  }
}

function judgeLicence(record, name, problem) {
  for (const key of ['licence', 'source']) {
    if (!isText(record[key])) {
      problem(key, 'missing-licence-record', `${name} has no ${key} (${JSON.stringify(record[key] ?? null)})`, key === 'licence' ? 'Record the licence the file is used under (for example the Lottie Simple License, CC0-1.0, or commissioned with rights assigned); ask the developer when it is not known.' : 'Record where the file came from: the page it was downloaded from, the vendor, or "made by the team".');
    }
  }
}

function judgeReduced(record, name, problem) {
  const reduced = record.reducedMotion;
  const fix = 'Set "reducedMotion": { "show": "frame", "progress": <0..1> } for Lottie, { "show": "frame" } for Rive, or { "show": "hidden" } for decorative art.';
  if (typeof record.decorative !== 'boolean') {
    problem('decorative', 'no-reduce-motion-fallback', `${name} does not say whether it is decorative`, 'Set "decorative": true (hidden from screen readers) or false (one image with a label); the reduced alternative depends on it.');
  }
  if (!reduced || typeof reduced !== 'object' || !['frame', 'hidden'].includes(reduced.show)) {
    problem('reducedMotion', 'no-reduce-motion-fallback', `${name} declares no reduced-motion alternative`, fix);
    return;
  }
  if (reduced.show === 'hidden' && record.decorative !== true) {
    problem('reducedMotion', 'no-reduce-motion-fallback', `${name} hides itself under Reduce Motion but carries information`, 'Show a still frame instead; only decorative art may disappear.');
  }
  if (reduced.show === 'frame' && record.runtime === 'lottie' && !(typeof reduced.progress === 'number' && reduced.progress >= 0 && reduced.progress <= 1)) {
    problem('reducedMotion', 'no-reduce-motion-fallback', `${name} shows a still frame but names no progress`, 'Add "progress": 0 to 1, the frame that still tells the story (often 1, the end state).');
  }
}

function judgeBudget({ root, record, name, budgets, problem, report }) {
  const abs = join(root, record.file);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    problem('file', 'unbudgeted-file', `${name} names ${record.file}, which is not in the repo`, 'Add the file at that path or remove the record.');
    return;
  }
  const size = statSync(abs).size;
  if (!Number.isInteger(record.maxBytes) || record.maxBytes < 1 || record.maxBytes > budgets.maxBytes) {
    problem('maxBytes', 'unbudgeted-file', `${name} has maxBytes ${JSON.stringify(record.maxBytes ?? null)} (budgets.maxBytes is ${budgets.maxBytes})`, `Give it a byte budget of at most ${budgets.maxBytes}.`);
  } else if (size > record.maxBytes) {
    report.problem({ file: record.file, line: 1, rule: 'unbudgeted-file', message: `${record.file} is ${size} bytes, over its budget of ${record.maxBytes}`, fix: 'Re-export it smaller (fewer layers and keyframes, no embedded raster images, a .lottie archive), or raise maxBytes with the reviewer within budgets.maxBytes.' });
  }
  if (size >= budgets.heavyFromBytes && record.heavy !== true) {
    problem('heavy', 'unbudgeted-file', `${name} is ${size} bytes (heavy from ${budgets.heavyFromBytes}) but is not declared heavy`, 'Set "heavy": true and pass weight="heavy": it then plays alone on screen.');
  } else if (typeof record.heavy !== 'boolean') {
    problem('heavy', 'unbudgeted-file', `${name} does not say whether it is heavy`, 'Set "heavy": true (full screen, large or costly; plays alone) or false.');
  }
  if (!Number.isInteger(record.fps) || record.fps < 1 || record.fps > budgets.maxFps) {
    problem('fps', 'unbudgeted-file', `${name} has fps ${JSON.stringify(record.fps ?? null)} (budgets.maxFps is ${budgets.maxFps})`, `Record the frame rate, at most ${budgets.maxFps}.`);
  }
  if (record.runtime === 'lottie') judgeLottieBudget({ abs, record, name, budgets, problem, report });
  if (record.runtime === 'rive' && record.settles !== true) {
    problem('settles', 'unbudgeted-file', `${name} is not confirmed to settle: an idle state with an endless timeline is an unbounded loop`, 'Ask the designer to make every state rest, then set "settles": true.');
  }
}

function judgeLottieBudget({ abs, record, name, budgets, problem, report }) {
  const isBounded = Number.isInteger(record.plays) && record.plays >= 1 && record.plays <= budgets.maxPlays;
  if (!isBounded) {
    problem('plays', 'unbudgeted-file', `${name} plays ${JSON.stringify(record.plays ?? null)} times: a loop must be bounded (1 to ${budgets.maxPlays})`, `Set "plays" from 1 to ${budgets.maxPlays}; an endless loop is never a Lottie moment.`);
  } else if (record.job === 'one-shot' && record.plays !== 1) {
    problem('plays', 'unbudgeted-file', `${name} is a one-shot that plays ${record.plays} times`, 'Set "plays": 1, or make it a "loop".');
  }
  if (extname(record.file).toLowerCase() !== '.json') return;
  const header = lottieHeader(abs);
  if (header === null) {
    report.problem({ file: record.file, line: 1, rule: 'unbudgeted-file', message: `${record.file} is not a Lottie file (no fr, ip, op and layers)`, fix: 'Export it again as Lottie JSON (Bodymovin or LottieFiles).' });
    return;
  }
  if (header.fr > budgets.maxFps || header.fr !== record.fps) {
    report.problem({ file: record.file, line: header.frLine, rule: 'unbudgeted-file', message: `${record.file} is authored at ${header.fr} fps; its record says ${record.fps} and budgets.maxFps is ${budgets.maxFps}`, fix: 'Export it at 30 (or the record\'s rate) and keep the record equal to the file.' });
  }
  const seconds = ((header.op - header.ip) / header.fr) * (isBounded ? record.plays : 1);
  if (seconds > budgets.maxSeconds) {
    problem('plays', 'unbudgeted-file', `${name} runs ${seconds.toFixed(1)} s (${header.op - header.ip} frames at ${header.fr} fps, ${record.plays} plays), over budgets.maxSeconds ${budgets.maxSeconds}`, 'Shorten the animation or play it fewer times.');
  }
}
