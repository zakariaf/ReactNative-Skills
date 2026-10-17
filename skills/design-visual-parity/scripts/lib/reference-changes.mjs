// The log of intended reference changes: the reference manifest's "referenceChanges"
// (<referencesDir>/manifest.json). Every deliberate change of the committed references (a design
// change the reviewer approved, a re-render after a renderer or font change) is recorded here, never
// as a waiver:
//   { "id": "D-12", "date": "2026-10-02", "frames": ["tasks-default"], "variants": [],
//     "what": "<what changed in the references>", "why": "<the decision and who approved it>" }
// shoot-design.mjs --update-reference keeps the log and refuses to rewrite references without an entry
// dated today naming them; --check validates it, and check-signoff.mjs prints the entries of every
// frame it signs off, so the report to the reviewer names them.
import { referenceNames } from './contract.mjs';

const CHANGE_KEYS = ['id', 'date', 'frames', 'variants', 'what', 'why'];

/** Problems of a manifest's referenceChanges (strings), checked against the frame catalogue. */
export function referenceChangeProblems(manifest, { frames, designFacts = {} }) {
  const list = manifest?.referenceChanges;
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['referenceChanges must be a list of { id, date, frames, variants, what, why }'];
  const problems = [];
  const variantNames = new Set([...frames.values()].flatMap((f) => referenceNames(f, designFacts).slice(1)));
  const ids = new Set();
  list.forEach((entry, i) => {
    const at = `referenceChanges[${i}]${entry?.id ? ` (${entry.id})` : ''}`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${at} is not an object`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !CHANGE_KEYS.includes(k));
    if (extra.length) problems.push(`${at} has unknown fields ${extra.join(', ')}`);
    if (typeof entry.id !== 'string' || !entry.id.trim()) problems.push(`${at} needs an id (the design change or decision that asked for it)`);
    else if (ids.has(entry.id)) problems.push(`${at}: the id ${entry.id} is used twice`);
    ids.add(entry.id);
    if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) problems.push(`${at} needs "date": "YYYY-MM-DD"`);
    for (const key of ['frames', 'variants']) {
      if (!Array.isArray(entry[key])) problems.push(`${at} needs "${key}": a list (empty when none)`);
    }
    for (const key of entry.frames ?? []) if (!frames.has(key)) problems.push(`${at} names the unknown frame ${key}`);
    for (const name of entry.variants ?? []) if (!variantNames.has(name)) problems.push(`${at} names the unknown variant ${name}`);
    for (const key of ['what', 'why']) {
      if (typeof entry[key] !== 'string' || entry[key].trim().length < 20) problems.push(`${at} needs "${key}" (20+ characters)`);
    }
  });
  return problems;
}

/** The change entries that touch one frame, or one of its variants. */
export function changesForFrame(manifest, frameKey) {
  return (Array.isArray(manifest?.referenceChanges) ? manifest.referenceChanges : []).filter(
    (entry) => (entry.frames ?? []).includes(frameKey) || (entry.variants ?? []).some((name) => name === frameKey || name.startsWith(`${frameKey}--`)),
  );
}
