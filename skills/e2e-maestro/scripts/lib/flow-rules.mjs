// flow-rules.mjs: the per-file rules of check-flows that need only the parsed flow (a helper, not an
// entry point): header and tags, quarantine, text selectors and retries, the "Open in …?" guard, AI
// commands, Maestro command lines in comments, and the walkers the checker shares.

const SELECTOR_COMMANDS = new Set(['tapOn', 'doubleTapOn', 'longPressOn', 'assertVisible', 'assertNotVisible', 'copyTextFrom', 'scrollUntilVisible', 'extendedWaitUntil']);
const SYSTEM_UI = /^system-ui:\s*\S.{5,}/;
/** Any in-app control whose text is OPEN (an ad's call to action, an "Open" row) matches a bare 'Open'. */
const IN_APP_OPEN = 'OPEN';

/** Calls visit(key, value, parentKey, owner) for every map entry of a parsed value, depth first. */
export function visitMaps(value, visit, parentKey = null) {
  if (Array.isArray(value)) {
    for (const item of value) visitMaps(item, visit, parentKey);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child, parentKey, value);
      visitMaps(child, visit, key);
    }
  }
}

/** The runFlow targets of a flow: { file, env, line } (the short and the long form). */
export function runFlowTargets(parsed) {
  const targets = [];
  visitMaps(parsed.steps, (key, value, parentKey, owner) => {
    if (key !== 'runFlow') return;
    const line = owner.lines?.[key] ?? 0;
    if (typeof value === 'string') targets.push({ file: value, env: {}, line });
    else if (value && typeof value === 'object' && typeof value.file === 'string') targets.push({ file: value.file, env: value.env ?? {}, line });
  });
  return targets;
}

/** True when some step selects or waits for an element by id. */
export function hasIdStep(parsed) {
  let found = false;
  visitMaps(parsed.steps, (key, value) => {
    if (key === 'id' && typeof value === 'string') found = true;
  });
  return found;
}

const hasSystemUiComment = (comments, line) => comments.some((comment) => comment.line < line && comment.line >= line - 6 && SYSTEM_UI.test(comment.text));

/** flow-header, env-shadows-cli and flow-tags; returns the flow's tags. */
export function checkHeader(ctx, info, parsed, { cliVars }) {
  const problem = (line, rule, message, fix) => ctx.report.problem({ file: ctx.rel, line, rule, message, fix });
  const header = parsed.header ?? {};
  const line = (key) => header.lines?.[key] ?? 1;
  if (header.appId !== '${APP_ID}') problem(line('appId'), 'flow-header', `appId is ${JSON.stringify(header.appId ?? null)}, not \${APP_ID}`, 'Write appId: ${APP_ID}; the runner passes the app id with -e (it differs per variant).');
  const env = header.env && typeof header.env === 'object' ? Object.keys(header.env) : [];
  for (const name of env.filter((key) => cliVars.has(key))) problem(line('env'), 'env-shadows-cli', `env: sets ${name}, which the runner passes with -e`, `Remove ${name} from env:; in Maestro 2.10 a flow's env: value wins over -e, so every run would use the flow's value.`);
  if (info.kind === 'subflow') return [];
  if (typeof header.name !== 'string' || header.name.trim() === '') problem(1, 'flow-header', 'has no name:', 'Add name: <what the journey proves, in a sentence> (it becomes the JUnit test name).');
  const tags = Array.isArray(header.tags) ? header.tags.map(String) : [];
  if (tags.length === 0) {
    problem(1, 'flow-header', 'has no tags:', 'Add tags: [smoke] (or [journeys, offline], [rtl], [a11y], ...).');
    return [];
  }
  for (const tag of tags.filter((item) => !ctx.tags.has(item))) problem(line('tags'), 'flow-tags', `unknown tag "${tag}"`, `Use ${[...ctx.tags].join(', ')}, or add the tag to contracts/e2e.json "tags".`);
  if (info.kind === 'flow' && info.area === 'a11y' && !tags.includes('a11y')) problem(line('tags'), 'flow-tags', 'a flow in flows/a11y/ without the a11y tag', 'Add a11y to tags: the runner runs these at the largest text size only.');
  if (info.kind === 'flow' && info.area !== 'a11y' && tags.includes('a11y')) problem(line('tags'), 'flow-tags', 'tagged a11y outside flows/a11y/', 'Move it to flows/a11y/: the runner\'s large-text step runs that folder, and the flows step leaves a11y flows out.');
  if (info.kind === 'manual' && !tags.includes(info.folder)) problem(line('tags'), 'flow-tags', `a ${info.folder}/ flow without the ${info.folder} tag`, `Add ${info.folder} to tags, so a report names where the flow came from.`);
  if (info.kind === 'screenshots' && !tags.includes('screenshots')) problem(line('tags'), 'flow-tags', 'the matrix flow without the screenshots tag', 'Add screenshots to tags.');
  return tags;
}

/** smoke-quarantine and quarantine-note (at most 7 days, with a dated reason). */
export function checkQuarantine(rel, tags, parsed, today, report) {
  if (!tags.includes('quarantine')) return;
  if (tags.includes('smoke')) report.problem({ file: rel, line: parsed.header?.lines?.tags ?? 1, rule: 'smoke-quarantine', message: 'a smoke flow is quarantined', fix: 'Fix it now: a failing smoke flow blocks the release; quarantine is only for non-smoke flows.' });
  const note = parsed.comments.map((comment) => /^quarantine (\d{4}-\d{2}-\d{2}):\s*(\S.*)$/.exec(comment.text)).find(Boolean);
  if (!note) {
    report.problem({ file: rel, line: 1, rule: 'quarantine-note', message: 'quarantined without a "# quarantine YYYY-MM-DD: <reason>" comment', fix: "Add the comment with today's date and the reason, report it, and fix the flow within 7 days." });
    return;
  }
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${note[1]}T00:00:00Z`)) / 86_400_000;
  if (age > 7) report.problem({ file: rel, line: 1, rule: 'quarantine-note', message: `quarantined since ${note[1]} (${Math.round(age)} days)`, fix: 'Fix the flow (the wait, the setup or the app) and remove quarantine from its tags; the limit is 7 days.' });
}

/** text-selector and retry-app-assertion. */
export function checkSelectors(rel, parsed, report) {
  visitMaps(parsed.steps, (key, value, parentKey, owner) => {
    const line = owner.lines?.[key] ?? 0;
    const isSelector = SELECTOR_COMMANDS.has(key) || key === 'visible' || key === 'notVisible' || key === 'element';
    const isTextScalar = typeof value === 'string' && isSelector && key !== 'extendedWaitUntil';
    const isTextMap = value && typeof value === 'object' && !Array.isArray(value) && isSelector && typeof value.text === 'string' && value.id === undefined && value.point === undefined;
    if ((isTextScalar || isTextMap) && !hasSystemUiComment(parsed.comments, line)) report.problem({ file: rel, line, rule: 'text-selector', message: `${key} selects by visible text ("${String(isTextScalar ? value : value.text).slice(0, 40)}")`, fix: 'Select by id (testID): flows run unchanged in every locale and on both platforms. Only OS-owned UI may use text, under a "# system-ui: <why>" comment.' });
    if (key === 'retry' && !hasSystemUiComment(parsed.comments, line)) report.problem({ file: rel, line, rule: 'retry-app-assertion', message: 'retry: wraps steps', fix: 'Fix the wait (extendedWaitUntil on an id) or the setup instead; retry only around OS-owned UI, under a "# system-ui: <why>" comment.' });
  });
}

function textMatches(selector, text) {
  try {
    return new RegExp(`^(?:${selector})$`, 'is').test(text);
  } catch {
    return selector.toLowerCase() === text.toLowerCase();
  }
}

function selectorText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' && value.id === undefined && value.point === undefined) return value.text;
  return null;
}

/** open-alert-guard: a guard or tap that matches any OPEN text is not iOS's "Open in …?" alert. */
export function checkOpenAlertGuard(rel, parsed, report) {
  const fix = "Guard on iOS's alert title, when: { visible: 'Open in .*\\?' }, and tap { text: 'Open', below: 'Open in .*\\?', optional: true }, as subflows/open-link.yaml does.";
  visitMaps(parsed.steps, (key, value, parentKey, owner) => {
    const line = owner.lines?.[key] ?? 0;
    const text = selectorText(value);
    if (text === null || !textMatches(text, IN_APP_OPEN)) return;
    if (parentKey === 'when' && (key === 'visible' || key === 'notVisible')) report.problem({ file: rel, line, rule: 'open-alert-guard', message: `a runFlow guard on ${key} '${text}' also matches any in-app OPEN button (Maestro's text match ignores case), not only iOS's "Open in …?" alert`, fix });
    const isScoped = value && typeof value === 'object' && value.below !== undefined;
    if (key === 'tapOn' && !isScoped) report.problem({ file: rel, line, rule: 'open-alert-guard', message: `tapOn '${text}' taps whatever OPEN text is on screen first, an in-app button included`, fix });
  });
}

/** ai-command: the commands that upload screenshots to a third-party service. */
export function checkAiCommands(rel, text, report) {
  text.split('\n').forEach((line, index) => {
    const match = /^\s*-\s*(assertWithAI|assertNoDefectsWithAI|extractTextWithAI)\b/.exec(line);
    if (match) report.problem({ file: rel, line: index + 1, rule: 'ai-command', message: `${match[1]} uploads screenshots to a third-party service`, fix: 'Assert by id and text; review screenshots by opening the PNGs.' });
  });
}

/** The Maestro command a comment holds: from the word holding maestro (a path too) to the end of the line, at most 120 characters. */
const commandText = (text, at) => {
  const start = text.slice(0, at).search(/\S*$/);
  const command = text.slice(start).split('\n')[0].trim();
  return command.length > 120 ? `${command.slice(0, 117)}...` : command;
};

/** run-command-device: a Maestro command line in a comment names its device and driver port first. */
export function checkRunCommands(rel, comments, report) {
  for (const comment of comments) {
    const match = /\bmaestro\b(.*?)\s(test|hierarchy|record|start-device)\b/.exec(comment.text);
    if (!match) continue;
    if (/--device\s+\S+/.test(match[1]) && /--driver-host-port\s+\S+/.test(match[1])) continue;
    report.problem({ file: rel, line: comment.line, rule: 'run-command-device', message: `the command "${commandText(comment.text, match.index)}" does not name --device <id> and --driver-host-port <port> before ${match[2]}`, fix: "Write maestro --device <udid or serial> --driver-host-port <port> test ...: the run must name this session's device and a driver port of its own." });
  }
}

/** Steps that exist on Android only: on iOS Maestro 2.10 runs them as no-ops (IOSDriver.backPress is empty, setAirplaneMode only logs). */
const ANDROID_ONLY = new Set(['back', 'setAirplaneMode', 'toggleAirplaneMode']);
const isAndroidOnly = ({ name, arg }) => ANDROID_ONLY.has(name) || (name === 'pressKey' && typeof arg === 'string' && /^back$/i.test(arg.trim()));

/**
 * platform-guard: an Android-only step outside a runFlow whose when.platform is Android. Unguarded, the
 * step passes on iOS without doing anything, so the flow goes green there without proving the step.
 */
export function checkPlatformGuard(rel, parsed, commandOf, report) {
  const fix = 'Wrap it: - runFlow: { when: { platform: Android }, commands: [ <the step> ] } (and give iOS its own step under when: { platform: iOS } when the journey needs one there).';
  const walkSteps = (steps, platform) => {
    if (!Array.isArray(steps)) return;
    steps.forEach((step, index) => {
      const command = commandOf(step);
      const line = steps.lines?.[index] ?? 0;
      if (isAndroidOnly(command) && platform !== 'android') {
        const where = platform === null ? 'outside a runFlow guarded by when: { platform: Android }' : `inside a runFlow guarded by when: { platform: ${platform === 'ios' ? 'iOS' : platform} }`;
        report.problem({ file: rel, line, rule: 'platform-guard', message: `${command.name}${command.name === 'pressKey' ? ` ${String(command.arg).trim()}` : ''} runs on Android only and sits ${where}: on iOS Maestro skips it silently and the flow passes without it`, fix });
      }
      const arg = command.arg;
      if (!arg || typeof arg !== 'object' || Array.isArray(arg) || !Array.isArray(arg.commands)) return;
      const guard = command.name === 'runFlow' && arg.when && typeof arg.when === 'object' && typeof arg.when.platform === 'string' ? arg.when.platform.trim().toLowerCase() : null;
      walkSteps(arg.commands, guard ?? platform);
    });
  };
  walkSteps(parsed.steps, null);
}
