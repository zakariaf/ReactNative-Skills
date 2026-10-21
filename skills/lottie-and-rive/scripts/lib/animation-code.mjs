// animation-code.mjs: the per-file rules of check-animations.mjs over app source (a helper, not an
// entry point): which files import a runtime, remote sources, and each <LottieMoment> / <RiveMoment>
// tag held against its record in contracts/animations.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lineOf, matchGlob } from '../check-lib.mjs';
import { findCalls, findJsxTags, importsOf, jsxAttributes, literalOf, maskCode, resolveImport, scanSource } from './source-scan.mjs';

const MOMENT_TAGS = { LottieMoment: 'lottie', RiveMoment: 'rive' };
const PLAYER_TAGS = new Set(['LottieView', 'RiveView', ...Object.keys(MOMENT_TAGS)]);
const ANIMATION_SPEC = /\.(riv|lottie)$/i;
const REMOTE_FILE = /^https?:\/\/\S+\.(riv|lottie)(?:[?#]\S*)?$/i;
const REMOTE_JSON = /^https?:\/\/\S+\.json(?:[?#]\S*)?$/i;
const REQUIRE_LITERAL = /^require\(\s*(['"])([^'"]+)\1\s*\)$/;

const isPackage = (spec, name) => spec === name || spec.startsWith(`${name}/`);

/** Reads one source file and returns what the rules need. */
export function readSource(root, rel) {
  const text = readFileSync(join(root, rel), 'utf8');
  const scan = scanSource(text);
  return { rel, text, scan, masked: maskCode(text), imports: importsOf(scan) };
}

/** True when the file imports an approved runtime as a value (a type-only import draws nothing). */
export function runtimeImports(source, table) {
  return source.imports.filter((entry) => !entry.typeOnly && Object.keys(table.approved).some((name) => isPackage(entry.spec, name)));
}

/** Imports of a runtime outside the wrappers, and of an unapproved runtime anywhere. */
export function judgeImports({ source, table, wrapperFiles, report }) {
  for (const entry of source.imports) {
    const unapproved = Object.keys(table.unapproved).find((name) => isPackage(entry.spec, name));
    if (unapproved) {
      report.problem({ file: source.rel, line: entry.line, rule: 'unapproved-runtime', message: `imports ${entry.spec}: ${table.unapproved[unapproved]}`, fix: 'Play Lottie files with lottie-react-native and Rive files with @rive-app/react-native, through LottieMoment and RiveMoment; UI motion is Reanimated (motion-and-animation).' });
    }
  }
  const isWrapper = wrapperFiles.some((glob) => matchGlob(source.rel, glob));
  if (isWrapper) return;
  for (const entry of runtimeImports(source, table)) {
    report.problem({ file: source.rel, line: entry.line, rule: 'no-reduce-motion-fallback', message: `imports ${entry.spec} outside the animation wrappers, so nothing holds it still under Reduce Motion`, fix: 'Render <LottieMoment> or <RiveMoment> from src/ui/animation/ instead; only the wrapper files (contracts/animations.json wrapperFiles) import a runtime.' });
  }
}

/** Remote animation sources: URL literals of .riv/.lottie files, .json URLs next to a runtime, fromURL, { uri }. */
export function judgeRemote({ source, table, report }) {
  const touchesAnimation = runtimeImports(source, table).length > 0 || source.imports.some((entry) => /(lottie|rive)-(moment|player)$/.test(entry.spec));
  const remote = (line, what) => report.problem({ file: source.rel, line, rule: 'remote-animation-source', message: `${what}: an animation loaded from the network fails offline and can change under the app`, fix: 'Bundle the file under assets/animations/, record it in contracts/animations.json and pass require(\'@/assets/animations/<file>\').' });
  for (const entry of source.scan.strings) {
    if (REMOTE_FILE.test(entry.value) || (touchesAnimation && REMOTE_JSON.test(entry.value))) remote(entry.line, `names the remote file ${entry.value}`);
  }
  const usesRive = source.imports.some((entry) => isPackage(entry.spec, '@rive-app/react-native'));
  if (usesRive) {
    for (const call of findCalls(source.masked, '(?:RiveFileFactory\\.)?fromURL')) remote(lineOf(source.text, call.start), 'loads a Rive file with fromURL()');
  }
  if (!source.rel.endsWith('x')) return;
  for (const tag of findJsxTags(source.text, source.masked).filter((item) => PLAYER_TAGS.has(item.name))) {
    const attr = jsxAttributes(source.text, tag, source.masked).get('source');
    if (attr?.kind === 'expr' && /\buri\s*:/.test(attr.value)) remote(lineOf(source.text, attr.index), `gives <${tag.name}> a { uri } source`);
  }
}

function expectedStill(record) {
  if (record.reducedMotion?.show === 'hidden') return 'hidden';
  return record.runtime === 'lottie' ? record.reducedMotion?.progress : 'first-frame';
}

const literalValue = (attr) => {
  if (!attr) return undefined;
  const text = literalOf(attr);
  if (text !== null) return text;
  if (attr.kind === 'expr' && /^-?\d+(\.\d+)?$/.test(attr.value)) return Number(attr.value);
  return undefined;
};

/** Each <LottieMoment> / <RiveMoment> with a literal require(): recorded, same runtime, same budget, same still. */
export function judgeMoments({ root, source, recordsByFile, aliases, report }) {
  if (!source.rel.endsWith('x')) return [];
  const seen = [];
  for (const tag of findJsxTags(source.text, source.masked).filter((item) => item.name in MOMENT_TAGS)) {
    const attrs = jsxAttributes(source.text, tag, source.masked);
    const sourceAttr = attrs.get('source');
    const required = sourceAttr?.kind === 'expr' ? REQUIRE_LITERAL.exec(sourceAttr.value) : null;
    if (!required) continue;
    const line = lineOf(source.text, sourceAttr.index);
    seen.push(line);
    const resolved = resolveImport(source.rel, required[2], { root, aliases });
    const record = resolved.path ? recordsByFile.get(resolved.path) : undefined;
    if (!record) {
      report.problem({ file: source.rel, line, rule: 'unbudgeted-file', message: `<${tag.name}> plays ${required[2]}, which has no record in contracts/animations.json${resolved.exists ? '' : ' and is not in the repo'}`, fix: 'Add the file under assets/animations/ and its record (budget, fps, reduced motion, licence, source).' });
      continue;
    }
    judgeMomentAgainstRecord({ source, tag, attrs, record, line, report });
  }
  return seen;
}

function judgeMomentAgainstRecord({ source, tag, attrs, record, line, report }) {
  const at = (name) => (attrs.get(name) ? lineOf(source.text, attrs.get(name).index) : line);
  if (MOMENT_TAGS[tag.name] !== record.runtime) {
    report.problem({ file: source.rel, line, rule: 'unapproved-runtime', message: `<${tag.name}> plays ${record.file}, a ${record.runtime} file`, fix: record.runtime === 'rive' ? 'Play .riv files with <RiveMoment>.' : 'Play Lottie files with <LottieMoment>.' });
    return;
  }
  const weight = literalValue(attrs.get('weight'));
  if (typeof weight === 'string' && (weight === 'heavy') !== (record.heavy === true)) {
    report.problem({ file: source.rel, line: at('weight'), rule: 'unbudgeted-file', message: `weight="${weight}" but ${record.name} is recorded heavy: ${record.heavy}`, fix: 'Pass the weight the record declares; a heavy moment plays alone.' });
  }
  const budgetKey = record.runtime === 'lottie' ? 'plays' : 'frameRate';
  const budgetValue = literalValue(attrs.get(budgetKey));
  const recorded = record.runtime === 'lottie' ? record.plays : record.fps;
  if (typeof budgetValue === 'number' && budgetValue !== recorded) {
    report.problem({ file: source.rel, line: at(budgetKey), rule: 'unbudgeted-file', message: `${budgetKey}={${budgetValue}} but ${record.name} is budgeted at ${recorded}`, fix: `Pass ${budgetKey}={${recorded}}, or change the record within budgets.` });
  }
  const still = literalValue(attrs.get('still'));
  const expected = expectedStill(record);
  if (still !== undefined && expected !== undefined && still !== expected) {
    report.problem({ file: source.rel, line: at('still'), rule: 'no-reduce-motion-fallback', message: `still=${JSON.stringify(still)} but ${record.name} records the reduced alternative ${JSON.stringify(expected)}`, fix: 'Pass the still the record declares, so Reduce Motion shows what was reviewed.' });
  }
}

/** Other require()/import of an animation file (outside a moment tag): it must be recorded. */
export function judgeFileReferences({ root, source, recordsByFile, lottieFiles, aliases, skipLines, report }) {
  for (const entry of source.imports) {
    if (skipLines.includes(entry.line)) continue;
    const resolved = resolveImport(source.rel, entry.spec, { root, aliases });
    const isAnimation = ANIMATION_SPEC.test(entry.spec) || (resolved.path !== null && lottieFiles.has(resolved.path));
    if (!isAnimation || (resolved.path && recordsByFile.has(resolved.path))) continue;
    report.problem({ file: source.rel, line: entry.line, rule: 'unbudgeted-file', message: `loads ${entry.spec}, which has no record in contracts/animations.json`, fix: 'Record the file (budget, fps, reduced motion, licence, source) and play it through <LottieMoment> or <RiveMoment>.' });
  }
}

/** True when some wrapper file calls useReduceMotion() (comments and strings blanked). */
export function wrappersReadReduceMotion(sources, wrapperFiles) {
  return sources.some((source) => wrapperFiles.some((glob) => matchGlob(source.rel, glob)) && /(?<![\w$.])useReduceMotion\s*\(/.test(source.masked));
}
