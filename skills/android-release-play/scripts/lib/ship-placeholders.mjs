// ship-placeholders.mjs: the well-known placeholder values a ship gate refuses by name (a helper, not
// an entry point). Templates and scaffolds ship placeholders on purpose (a template bundle id,
// Google's sample AdMob ids, the all-zero template AdMob publisher, example.com links, __UPPER_SNAKE__
// tokens) so an app builds on day one;
// a release, store-artifact or completeness gate must never let one through. A placeholder is often
// format-valid (Google's sample app id matches ^ca-app-pub-\d{16}~\d{10}$), so the gates compare the
// values themselves.
//
//   PLACEHOLDER_RULE                      'ship-placeholder', the rule id every gate reports under
//   PLACEHOLDERS                          [{ id, value, name, matches(text), fix }]
//   placeholdersIn(text)                  every entry a whole value is (a bundle id, an ad unit id, a host)
//   placeholderName(value)                the first entry's name, or null
//   placeholdersInText(source)            every quoted placeholder inside a source file (app.config.ts):
//                                         [{ index, value, name, entry }] sorted by index
//   placeholderProblem({ entry, value, where, file, line })   a report.problem() entry
//   bundleIdProblem(id, { platform })     why a bundle id / Android package may not ship, or null
//   isGoogleSampleAdId(id)                true for Google's documented sample (test) AdMob ids
//
// No mode turns a placeholder into a pass (a keyless --rehearsal only skips the signing rule).
// Every placeholder is one FAIL line with its fix; no fixed app-id domain, no extra result line.

/** The rule every ship gate reports a placeholder under. */
export const PLACEHOLDER_RULE = 'ship-placeholder';

/** Google's documented AdMob publisher id for sample (test) app and ad unit ids. */
const GOOGLE_SAMPLE_PUBLISHER = 'ca-app-pub-3940256099942544';
/**
 * The all-zero publisher admob-ads-and-consent's templates write (app ids
 * 'ca-app-pub-0000000000000000~<10 digits>', units '.../<10 digits>'): format-valid on purpose, so
 * the production config evaluates, and never a real account.
 */
const TEMPLATE_PUBLISHER = 'ca-app-pub-0000000000000000';

const entry = (id, value, name, matches, fix) => Object.freeze({ id, value, name, matches, fix });
const hostOf = (text) => {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([^/:?#\s]+)/i.exec(String(text).trim());
  return match ? match[1].toLowerCase() : '';
};
const isExampleHost = (host) => /(^|\.)example\.(com|org|net)$/.test(host) || /(^|\.)(example|test|invalid|localhost)$/.test(host);

/**
 * Every value a ship gate refuses by name. `matches(text)` tests one whole value (a bundle id, an ad
 * unit id, a URL, an email address); placeholdersInText() finds them inside source files.
 */
export const PLACEHOLDERS = Object.freeze([
  entry('template-bundle-id', 'com.example.*', 'the template bundle id (com.example.*)', (text) => /^com\.example(\.|$)/i.test(String(text).trim()), 'Set your own reverse-DNS id in app.config.ts (ios.bundleIdentifier and android.package), the id registered in App Store Connect and Google Play.'),
  entry('google-sample-admob-app-id', `${GOOGLE_SAMPLE_PUBLISHER}~*`, "Google's sample AdMob app id", (text) => String(text).trim().startsWith(`${GOOGLE_SAMPLE_PUBLISHER}~`), 'Use the AdMob app id of your own AdMob app for release builds; keep the sample id for development builds only (select it by app variant).'),
  entry('google-sample-admob-unit-id', `${GOOGLE_SAMPLE_PUBLISHER}/*`, "Google's sample AdMob ad unit id", (text) => String(text).trim().startsWith(`${GOOGLE_SAMPLE_PUBLISHER}/`), 'Use your own ad unit ids for release builds; keep the sample (test) units for development builds only (select them by app variant).'),
  entry('template-admob-app-id', `${TEMPLATE_PUBLISHER}~*`, 'the template AdMob app id (all-zero publisher)', (text) => String(text).trim().startsWith(`${TEMPLATE_PUBLISHER}~`), 'Put the AdMob app id of your own AdMob app into the production variant (admob-ads-and-consent); the all-zero template id serves no ads and is not your account.'),
  entry('template-admob-unit-id', `${TEMPLATE_PUBLISHER}/*`, 'a template AdMob ad unit id (all-zero publisher)', (text) => String(text).trim().startsWith(`${TEMPLATE_PUBLISHER}/`), 'Put your own ad unit ids into the production variant (admob-ads-and-consent); the all-zero template units serve no ads.'),
  entry('example-email', '*@example.com', 'a placeholder email address (@example.com)', (text) => /^[^@\s]+@[^@\s]+$/.test(String(text).trim()) && isExampleHost(String(text).trim().split('@')[1].toLowerCase()), 'Use a real support address you read; the stores show it to users.'),
  entry('example-domain', 'example.com', 'a placeholder domain (example.com)', (text) => !String(text).includes('@') && isExampleHost(hostOf(text)), 'Use your real domain (privacy policy, support, terms, universal links); the stores and reviewers open these links.'),
  entry('template-token', '__UPPER_SNAKE__', 'an unfilled template placeholder (__NAME__)', (text) => /__[A-Z][A-Z0-9_]*__/.test(String(text)), 'Replace every __UPPER_SNAKE__ token the template left with the real value.'),
]);

/** Every PLACEHOLDERS entry a whole value is. */
export function placeholdersIn(text) {
  if (typeof text !== 'string') return [];
  return PLACEHOLDERS.filter((item) => item.matches(text));
}

/** The placeholder's name for a message, or null. */
export function placeholderName(value) {
  return placeholdersIn(String(value ?? ''))[0]?.name ?? null;
}

/** True for Google's documented sample (test) AdMob app and ad unit ids. */
export function isGoogleSampleAdId(id) {
  return typeof id === 'string' && id.trim().startsWith(`${GOOGLE_SAMPLE_PUBLISHER}`);
}

/**
 * Every quoted placeholder inside a source file: a string literal ('...', "...", `...` without ${})
 * whose whole value is a placeholder, plus __UPPER_SNAKE__ tokens anywhere in a literal.
 * Returns [{ index, value, name, entry }] sorted by index (index of the opening quote).
 */
export function placeholdersInText(source) {
  const found = [];
  for (const match of String(source).matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const value = match[2];
    if (match[1] === '`' && value.includes('${')) continue;
    const hits = placeholdersIn(value);
    for (const item of hits) found.push({ index: match.index, value, name: item.name, entry: item });
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * The problem a gate reports for a placeholder: rule ship-placeholder, naming where it sits (a config
 * field, or a place inside a built app), the value and the fix. Pass it to report.problem().
 */
export function placeholderProblem({ entry: item, value = item.value, where = 'a value', file, line = 0 }) {
  return {
    file,
    line,
    rule: PLACEHOLDER_RULE,
    message: `${where} is ${item.name}: ${value}`,
    fix: `${item.fix} A placeholder never ships; no option turns this into a pass.`,
  };
}

/**
 * Why a bundle id or Android package may not ship (a placeholder, not reverse-DNS), or null.
 * platform 'ios': letters, digits, hyphens and dots (Apple); 'android': each part starts with a
 * letter, then letters, digits or underscores (Java package rules); omitted: either form passes.
 */
export function bundleIdProblem(bundleId, { platform = null } = {}) {
  const id = String(bundleId ?? '').trim();
  if (id === '') return '(missing) is not a reverse-DNS id';
  const placeholder = placeholdersIn(id)[0];
  if (placeholder) return `${id} is ${placeholder.name}`;
  const ios = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(id);
  const android = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(id);
  if (platform === 'ios' && !ios) return `${id} is not a valid iOS bundle id (letters, digits, hyphens; dot-separated, at least two parts)`;
  if (platform === 'android' && !android) return `${id} is not a valid Android package (dot-separated parts that start with a letter; letters, digits, underscores)`;
  if (platform === null && !ios && !android) return `${id} is not a reverse-DNS id (dot-separated parts of letters and digits, at least two parts)`;
  return null;
}
