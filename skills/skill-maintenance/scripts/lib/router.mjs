// router.mjs: a small lexical stand-in for the agent's skill choice, used by check-routing.mjs to
// catch descriptions that no longer win their own prompts. It scores a prompt against each skill's
// name and description (IDF-weighted word overlap; name words count double; words that only appear
// in the "Not for" clause count against the skill). It is a cheap early warning, not the real
// model: the live mode of check-routing.mjs asks Claude Code itself.

const STOP = new Set(
  ('a an and are as at be by for from in into is it its of on or the to with when use used using not this that these those ' +
    'each every all any via per without only than then so no one two new our my me we you your i can should would could ' +
    'please need needs want wants make makes made do does doing done get got set sets let lets just also there here').split(' '),
);

/** Lowercase content words with a light stem (plural s, -ing, -ed). */
export function tokens(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

/** A light suffix stripper: randomness -> random, determinism/deterministic -> determin, tiles -> tile. */
function stem(word) {
  let out = word;
  for (const suffix of ['ness', 'istic', 'ism', 'ist', 'ity']) {
    if (out.length > suffix.length + 4 && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  if (out.length > 5 && out.endsWith('ing')) return out.slice(0, -3);
  if (out.length > 4 && out.endsWith('ed')) return out.slice(0, -2);
  if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss')) return out.slice(0, -1);
  return out;
}

/** Builds the scorer for a set of skills [{ name, description }]. */
export function buildRouter(skills) {
  const docs = skills.map(({ name, description }) => {
    const at = description.search(/\bNot for\b/);
    const what = at === -1 ? description : description.slice(0, at);
    const notFor = at === -1 ? '' : description.slice(at);
    return { name, nameWords: new Set(tokens(name.replace(/-/g, ' '))), what: new Set(tokens(what)), notFor: new Set(tokens(notFor)) };
  });
  const df = new Map();
  for (const doc of docs) for (const word of new Set([...doc.nameWords, ...doc.what])) df.set(word, (df.get(word) ?? 0) + 1);
  const idf = (word) => Math.log(1 + docs.length / (df.get(word) ?? docs.length));
  return {
    /** Skills ranked for a prompt: [{ name, score }], best first. An exact skill name in the prompt wins. */
    rank(prompt) {
      const words = [...new Set(tokens(prompt))];
      const lower = prompt.toLowerCase();
      return docs
        .map((doc) => {
          let score = new RegExp(`(^|[^a-z0-9-])${doc.name}([^a-z0-9-]|$)`).test(lower) ? 1000 : 0;
          for (const word of words) {
            const weight = idf(word);
            if (doc.nameWords.has(word)) score += 2 * weight;
            if (doc.what.has(word)) score += weight;
            else if (doc.notFor.has(word)) score -= 0.5 * weight;
          }
          return { name: doc.name, score };
        })
        .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
    },
  };
}
