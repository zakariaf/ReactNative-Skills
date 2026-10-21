#!/usr/bin/env node
// plan-dependency.mjs: before adding, upgrading or removing a package, prints the exact commands the
// policy requires for it (npx expo install <pkg>@<table spec> for Expo-managed packages, an exact npm
// install in the right place otherwise, companions in the same command, peers and overrides when
// multi-package, approvals, checks) and fails when the request breaks the policy: banned, do-not-add,
// held back, not in the table, another version than the table's, or (with npm facts) too young,
// deprecated or under a licence the app does not allow.
// Run: node ${CLAUDE_SKILL_DIR}/scripts/plan-dependency.mjs <package>[@<version>] [repo-root]

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { activeExcludes, bareVersion, parseAllowScriptsKey, banFix, describePlace, doNotAddBlocks, doNotAddEntry, effectiveBans, installed, isAllowedLicense, isAppRow, isDevRow, loadBanLists, manifestFile, placesOf, policyPath, readPolicy, readRepo, releaseAgeDays } from './lib/policy.mjs';
import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';

const SPEC = {
  name: 'plan-dependency',
  summary: 'Prints the policy-conformant plan for adding, upgrading (<package>@<version>) or removing (--remove) one package, and fails when the request is banned, on the do-not-add list, held back, not in the dependency policy, or not the policy\'s version. With --online (or --npm-view <file>) it also checks the publish age as npm measures it (from the exact moment, against the .npmrc min-release-age, at least 7 days, honouring valid dated excludes), deprecation, the licence and the install scripts, and puts the script review before the install; a request refused outright (banned, do-not-add, held back, another version) asks npm nothing, and for a package outside the policy an npm error is a note, not a stop.',
  usage: '<package>[@<version>] [repo-root] [options]',
  options: {
    policy: { type: 'string', value: 'file', help: 'The dependency policy, repo-relative (default: rn-skills.config.json "dependencyPolicy", else <contractsDir>/dependency-policy.json)' },
    remove: { type: 'boolean', help: 'Plan the removal of the package instead' },
    'peer-of': { type: 'string', value: 'workspace', help: 'When multi-package: the shared workspace whose code imports the package (adds its "*" peer and the root override first)' },
    online: { type: 'boolean', help: 'Run npm view for the publish date, deprecation, licence and scripts (network)' },
    'npm-view': { type: 'string', value: 'file', help: 'Use a saved `npm view <pkg>@<v> version time license scripts deprecated --json` output instead of the network' },
    now: { type: 'string', value: 'ISO time', help: 'The moment the release age is measured at, as npm measures it (default: the current time)' },
    today: { type: 'string', value: 'YYYY-MM-DD', help: 'Only the day the dated exclude blocks are read for (default: the UTC day of --now); it never moves the age check' },
  },
  positionals: { min: 1, max: 2 },
  details: [
    'Rules: banned do-not-add held-back not-in-table version-differs too-young deprecated licence',
    'Companions (packages a row lets float: test-renderer for RNTL, the @typescript-eslint/* packages',
    'for typescript-eslint, the expo-router peers) are printed and pinned in the plan.',
    'Examples:',
    '  node plan-dependency.mjs expo-haptics .',
    '  node plan-dependency.mjs react-native-google-mobile-ads@17.2.0 . --online',
    '  node plan-dependency.mjs expo-haptics . --peer-of packages/ui      (when multi-package)',
    '  node plan-dependency.mjs zustand . --remove',
    '  node plan-dependency.mjs expo-haptics . --npm-view view.json --now 2026-10-03T10:00:00Z',
  ].join('\n'),
};

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const ONE_REACT = ['react', 'react-native'];
/** Registry installs run preinstall, install and postinstall; prepare runs only for git or local sources. */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

function parseRequest(text) {
  const match = /^(@[^@/]+\/[^@]+|[^@]+)(?:@(.+))?$/.exec(text);
  if (!match) fail(`"${text}" is not a package name`, 'Pass <name> or <name>@<version>, for example expo-haptics or zustand@5.0.15.');
  return { name: match[1], version: match[2] ?? null };
}

function whereList(repo, name) {
  return [...repo.manifests].filter(([, m]) => name in installed(m) || name in (m.peerDependencies ?? {})).map(([ws]) => (ws === '' ? 'the root' : ws));
}

/**
 * npm facts for one version: the saved --npm-view file, else `npm view` with --online, else null.
 * A failing npm view stops the plan (exit 2) unless `soft` is set: then it is a note and the plan
 * goes on without facts (a package outside the policy, already refused, whose name may be wrong).
 */
function npmFacts(options, name, version, soft) {
  if (options['npm-view']) return JSON.parse(readFileSync(options['npm-view'], 'utf8'));
  if (!options.online) return null;
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', 'time', 'license', 'scripts', 'deprecated', '--json'], { encoding: 'utf8' });
  const why = `npm view ${name}@${version} failed: ${(result.stderr || result.stdout || String(result.error ?? '')).trim().split('\n')[0]}`;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (soft) return void console.log(`note     ${why} (no npm facts for this request; check the name and the version)`);
  return fail(why, 'Check the name and version, and the network.');
}

/**
 * The release age as npm measures it: from the exact moment (--now, default the current time) back
 * to the publish time, against the .npmrc min-release-age in whole days of 24 hours. --today only
 * names the day the dated exclude blocks are read for.
 */
function checkAge(facts, request, context, add) {
  const { today, nowMs, npmrc } = context;
  const published = facts.time?.[request.version];
  if (!published) return;
  const days = releaseAgeDays(npmrc);
  const ageMs = nowMs - Date.parse(published);
  const ageDays = Math.floor(ageMs / DAY_MS);
  console.log(`age      ${request.name}@${request.version} was published ${published.slice(0, 10)} (${ageDays} days before ${new Date(nowMs).toISOString().slice(0, 16)}Z; the .npmrc asks for ${days})`);
  if (ageMs >= days * DAY_MS) return;
  const covered = activeExcludes(npmrc, today).find((entry) => entry.regex.test(request.name));
  if (covered) return console.log(`covered  by the dated exclude ${covered.pattern} (block expires ${covered.expires})`);
  // Rounded up to the minute, so the printed moment is never earlier than npm's.
  const oldEnough = new Date(Math.ceil((Date.parse(published) + days * DAY_MS) / MINUTE_MS) * MINUTE_MS).toISOString();
  const expires = oldEnough.slice(0, 10);
  add('npm registry', 0, 'too-young', `${request.name}@${request.version} is ${ageDays} days old; min-release-age=${days} will refuse it`, `Wait until ${oldEnough.slice(0, 16)}Z, or (only for a needed fix, with the developer's agreement) add "# exclude-block expires=${expires} reason=<link>" (the publish date + ${days} days) with min-release-age-exclude[]=${request.name} to .npmrc.`);
}

/** The install scripts a registry install of this version runs (from npm facts): [[event, command]]. */
const installScriptsOf = (facts) => Object.entries(facts?.scripts ?? {}).filter(([key]) => INSTALL_SCRIPTS.includes(key));

/**
 * What the root allowScripts already decides for name@version, matched like npm 11.17 (a deny wins;
 * only true and false count): { kind, key } with kind 'denies' (a reviewed denial; key form 'any'
 * covers every version), 'approves' (a pinned approval of this version), or 'unpinned' (only a
 * name-only true matches: npm runs the script, but nobody reviewed this version, so it is no
 * approval); null when nothing matches.
 */
function scriptDecision(repo, name, version) {
  const allow = repo.manifests.get('')?.allowScripts ?? {};
  const matching = Object.keys(allow)
    .map((key) => ({ key, value: allow[key], ...parseAllowScriptsKey(key) }))
    .filter((entry) => entry.name === name && typeof entry.value === 'boolean' && (entry.kind === 'any' || (entry.kind === 'versions' && entry.versions.includes(version))));
  const deny = matching.find((entry) => entry.value === false);
  if (deny) return { kind: 'denies', key: deny.key, everyVersion: deny.kind === 'any' };
  const pinned = matching.find((entry) => entry.kind === 'versions');
  if (pinned) return { kind: 'approves', key: pinned.key };
  const any = matching.find((entry) => entry.kind === 'any');
  return any ? { kind: 'unpinned', key: any.key } : null;
}

/** The decision in words, for the scripts line of the npm facts. */
function decisionWords(decision, row) {
  if (decision?.kind === 'approves') return `allowScripts approves it: "${decision.key}": true`;
  if (decision?.kind === 'denies') return `allowScripts denies it${decision.everyVersion ? ' for every version' : ''}: "${decision.key}": false`;
  if (decision?.kind === 'unpinned') return `"${decision.key}" approves every version unreviewed: review it and pin the key, the review step of the plan`;
  return row ? 'review it before the install: the review step of the plan' : 'read it before any install; strict-allow-scripts=true refuses it until approved';
}

function checkFacts(facts, request, row, context, add) {
  const { policy } = context;
  checkAge(facts, request, context, add);
  if (facts.deprecated) {
    console.log(`deprecated ${facts.deprecated}`);
    if (row?.deprecated) console.log(`accepted ${row.deprecated}`);
    else add('npm registry', 0, 'deprecated', `${request.name}@${request.version} is deprecated on npm: "${String(facts.deprecated).slice(0, 160)}"`, 'Choose what the message names instead; a deliberate hold needs a "deprecated": "<why>" entry in its policy row, which the developer agrees to.');
  }
  const shipped = row ? !isDevRow(row) : true;
  if (facts.license !== undefined) {
    console.log(`licence  ${facts.license}`);
    const excepted = policy.licenses.exceptions[request.name]?.license === facts.license;
    if (shipped && !excepted && !isAllowedLicense(facts.license, policy.licenses.allowed)) add('npm registry', 0, 'licence', `${request.name} is licensed ${facts.license}, which the policy does not allow for shipped code`, 'Choose another package, or ask the developer for an entry in "licenses.exceptions" of the dependency policy.');
  }
  const scripts = installScriptsOf(facts);
  const decision = scriptDecision(context.repo, request.name, request.version);
  console.log(`scripts  ${scripts.length ? `${scripts.map(([key, cmd]) => `${key}: ${cmd}`).join('; ')} (${decisionWords(decision, row)})` : 'no install scripts'}`);
}

/**
 * The install command(s) for rows that share a place and an install method. Expo-managed packages
 * get the table's specifier (npx expo install <pkg>@~x.y.z): without one, npx expo install asks
 * Expo's online versions list, which names a patch the day it is published (it wrote ~57.0.20 for
 * expo-constants on 2026-09-29 while the table pinned ~57.0.19). A row with a list of places
 * ("where": ["app", "packages/core"]) is installed in each of them, in one npm command.
 */
function installSteps(repo, row, specs, table) {
  const expoSpecs = specs.map(([name, version]) => `${name}@${table[name]?.spec ?? version}`).join(' ');
  const pinned = specs.map(([name, version]) => `${name}@${version}`).join(' ');
  const places = placesOf(row);
  const steps = places.includes('dev') ? [`npm install -D ${pinned}`] : [];
  const runtime = places.filter((place) => place !== 'dev');
  if (runtime.length === 0) return steps;
  if (repo.mode === 'single') return [...steps, row.install === 'expo' ? `npx expo install ${expoSpecs}` : `npm install ${pinned}`];
  if (row.install === 'expo') return [...steps, ...repo.apps.map((ws) => `(cd ${ws} && npx expo install ${expoSpecs})`)];
  const targets = runtime.flatMap((place) => (place === 'app' ? repo.apps : [place]));
  return [...steps, `npm install ${pinned} ${targets.map((ws) => `-w ${ws}`).join(' ')}`];
}

/**
 * When multi-package: a shared workspace that imports an app row lists it as a "*" peer, and npm
 * resolves that peer on its own (its newest release, at the root, next to the apps' copy) unless the
 * root overrides pin it at the version the apps install. Both go in before the install.
 */
function peerSteps(repo, peerOf, name, row) {
  if (repo.mode !== 'monorepo' || !peerOf || !isAppRow(row) || ONE_REACT.includes(name)) return [];
  if (!repo.shared.includes(peerOf)) fail(`--peer-of ${peerOf} is not a shared workspace (shared: ${repo.shared.join(', ') || 'none'})`, 'Name the workspace folder whose code imports the package, for example packages/ui.');
  return [`add "${name}": "*" to ${manifestFile(peerOf)} peerDependencies and "${name}": "${row.version}" to the root package.json overrides (the "*" peer then resolves to the apps' version, not npm's newest)`];
}

/**
 * Companions ride in on the row's caret range or auto-installed peer, so they are pinned in the same
 * change: overrides first, then companions with another install method, then one command for the
 * row and the companions it shares a place and a method with.
 */
function companionSteps(repo, policy, name, row) {
  const table = policy.packages;
  const before = [];
  const together = [[name, row.version]];
  for (const companion of row.companions ?? []) {
    console.log(`companion ${companion.package} ${companion.version} (${companion.via}): ${companion.why}`);
    const other = table[companion.package];
    const present = [...repo.manifests.values()].some((m) => companion.package in installed(m));
    if (companion.via === 'overrides') {
      before.push(`add "${companion.package}": "${companion.version}" to the root package.json overrides`);
      continue;
    }
    if (present) continue;
    if (!other) {
      before.push(`npm install -D ${companion.package}@${companion.version}`);
      continue;
    }
    if (JSON.stringify(placesOf(other)) === JSON.stringify(placesOf(row)) && other.install === row.install) together.unshift([companion.package, companion.version]);
    else before.push(...installSteps(repo, other, [[companion.package, companion.version]], table));
  }
  return { before, together };
}

/**
 * The review that comes before the install. strict-allow-scripts=true makes npm stop an install
 * whose tree holds an install script allowScripts does not cover, before anything runs; so the
 * script is read first and approved by its pinned key, and only then installed. Without npm facts
 * the step says how to look.
 */
function reviewStep(repo, request, version, facts) {
  const scripts = installScriptsOf(facts);
  const key = `"${request.name}@${version}": true`;
  if (facts && scripts.length === 0) return [];
  const decision = scriptDecision(repo, request.name, version);
  if (decision?.kind === 'approves') {
    console.log(`decided  allowScripts already approves the install script of ${request.name}@${version} with the pinned key "${decision.key}" (a new version needs a new review)`);
    return [];
  }
  if (decision?.kind === 'denies') {
    console.log(`decided  allowScripts denies the install script of ${decision.everyVersion ? `${request.name} for every version` : `${request.name}@${version}`} ("${decision.key}": false; npm installs the package without running it)`);
    return [];
  }
  // A name-only true lets npm run the script of any version: it is no review, so the step stays.
  const replace = decision?.kind === 'unpinned' ? ` in place of "${decision.key}" (a name-only true approves every future version unreviewed; check-deps-policy.mjs fails it as unpinned-approval)` : '';
  if (!facts) return [`review first: npm view ${request.name}@${version} scripts (or plan with --online); read any preinstall, install or postinstall (npm pack ${request.name}@${version}, then the file it runs) and add ${key} to allowScripts in the root package.json${replace} before installing`];
  return [`review first: ${request.name}@${version} runs ${scripts.map(([event, command]) => `${event}: ${command}`).join('; ')}; read it (npm pack ${request.name}@${version}, then the file it runs), then add ${key} to allowScripts in the root package.json${replace} before installing, or "${request.name}": false to skip it (strict-allow-scripts=true refuses the install until one of them is there, and nothing runs)`];
}

/**
 * The checks a request must pass before any plan is printed. Returns { row, refused }: refused is
 * the rule that stopped the request (then no install steps are printed), or null.
 */
function vetRequest(context, request, add) {
  const { policy, bans } = context;
  const { name } = request;
  const row = policy.packages[name];
  const refuse = (rule, message, fix) => {
    add(name, 0, rule, message, fix);
    return { row: row ?? null, refused: rule };
  };
  const ban = bans.find((rule) => rule.regex.test(name));
  if (ban) return refuse('banned', `${name} is banned: ${ban.reason}`, `Never install it.${banFix(ban)}`);
  // A scoped entry ({ where, allowIn }) refuses only a request whose row would put the package where it is kept out.
  const kept = doNotAddEntry(policy, name);
  if (kept !== null && (row === undefined || placesOf(row).some((place) => doNotAddBlocks(kept, place)))) {
    return refuse('do-not-add', `${name}${kept.where === null ? '' : ` (kept out of ${describePlace(context.repo, kept.where)})`}: ${kept.reason}`, kept.where === null ? 'Do not install it.' : `Do not install it there; a row whose "where" lies outside ${describePlace(context.repo, kept.where)} (a dev row for test tooling) may allow it${kept.allowIn.length > 0 ? `, imported only by ${kept.allowIn.join(', ')}` : ''}.`);
  }
  const held = policy.heldBack.find((entry) => entry.package === name);
  if (held && request.version && !new RegExp(held.allowed).test(bareVersion(request.version))) return refuse('held-back', `${name}@${request.version} crosses a held-back major`, `Stay on the pinned line until: ${held.trigger}.`);
  if (!row) return refuse('not-in-table', `${name} is not in the dependency policy`, 'Stop and ask the developer. If approved: check age, deprecation, licence and install script (--online), add its row to the policy in the same commit, then plan again.');
  const version = request.version ?? row.version;
  if (bareVersion(version) !== row.version) return refuse('version-differs', `the dependency policy pins ${name} ${row.version}, not ${version}`, 'An upgrade follows references/procedures.md: old enough for the .npmrc min-release-age, changelog read, every app together; change the row in the same commit, then plan again.');
  return { row, refused: null };
}

/** The steps for a vetted request: review, peers and overrides, companions, the install, checks. */
function printPlan(context, request, row, facts) {
  const { repo, policy, peerOf } = context;
  const { name } = request;
  const present = whereList(repo, name);
  console.log(`package  ${name} ${row.spec} (${row.install === 'expo' ? 'Expo-managed' : 'exact npm pin'}; belongs in ${describePlace(repo, row.where)}) - ${row.why}`);
  console.log(`present  ${present.length ? present.join(', ') : 'nowhere yet'}`);
  const steps = [...reviewStep(repo, request, row.version, facts), ...peerSteps(repo, peerOf, name, row)];
  const { before, together } = companionSteps(repo, policy, name, row);
  steps.push(...before, ...installSteps(repo, row, together, policy.packages));
  steps.push('npm approve-scripts --allow-scripts-pending   (must print "No packages with unreviewed install scripts."; an install that stopped with ESTRICTALLOWSCRIPTS ran nothing: review each package it names, add its pinned key, run the install again)');
  if (row.install === 'expo') steps.push(`${repo.mode === 'single' ? '' : 'in every Expo app: '}npx expo install --check && npx expo-doctor`);
  steps.push('npm run -s check:unused   (knip: the package must be imported by the code that needed it)');
  steps.push('node ${CLAUDE_SKILL_DIR}/scripts/check-deps-policy.mjs .   (one-version and companion catch a copy that floated in)');
  if (row.native) steps.push('native change: rebuild the binaries (npx expo prebuild --clean, then a development build on a named iOS simulator and Android emulator, or eas build --profile development with a simulator profile: ios.simulator true, an APK for Android); before the next release, a preview or release build on both too, and read the podspec and build.gradle for build-time downloads (references/procedures.md, "After a native change")');
  steps.forEach((step, index) => console.log(`step ${index + 1}   ${step}`));
  if (steps.some((step) => step.includes('npx expo install ') && step.includes('@'))) console.log('note     keep the @<spec> in each npx expo install: it writes the policy\'s specifier. A plain npx expo install <pkg> writes whatever Expo\'s online versions list names today, which can be a patch published that day; that patch stays a WARN with its due date in scripts/deps/check-deps.ts and moves on that date through the upgrade procedure.');
}

function planRemove(context, request) {
  const { repo, policy } = context;
  const present = [...repo.manifests].filter(([, m]) => request.name in installed(m) || request.name in (m.peerDependencies ?? {}));
  if (present.length === 0) console.log(`present  ${request.name} is not declared in any package.json`);
  present.forEach(([ws, m], index) => {
    const isPeer = !(request.name in installed(m));
    console.log(`step ${index + 1}   ${isPeer ? `remove "${request.name}" from ${manifestFile(ws)} peerDependencies` : `npm uninstall ${request.name}${ws ? ` -w ${ws}` : ''}`}`);
  });
  const overrides = repo.manifests.get('')?.overrides ?? {};
  const companions = (policy.packages[request.name]?.companions ?? []).filter((companion) => companion.via === 'overrides').map((companion) => companion.package);
  for (const key of [request.name, ...companions].filter((item) => item in overrides)) console.log(`step     remove "${key}" from the root package.json overrides`);
  const approvals = Object.keys(repo.manifests.get('')?.allowScripts ?? {}).filter((key) => key === request.name || key.startsWith(`${request.name}@`));
  for (const key of approvals) console.log(`step     remove "${key}" from the root package.json allowScripts (nothing installs it any more)`);
  console.log('then     remove its imports, config plugin entry and Jest mock; delete its row from the dependency policy; npm approve-scripts --allow-scripts-pending; npm run -s check:unused; check-deps-policy.mjs .');
}

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const target = positionals[1] ?? '.';
  const root = requireDir(target, 'repo root');
  if (!existsSync(join(root, 'package.json'))) fail(`nothing to plan against: ${target} has no package.json`, 'Pass the repo root as the second argument: plan-dependency.mjs <package> <repo-root>.');
  // One rule for the age: the moment is --now (default: the current time), as npm measures it;
  // --today only names the day the dated excludes are read for, and defaults to that moment's day.
  const nowMs = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (Number.isNaN(nowMs)) fail(`--now "${options.now}" is not an ISO time`, 'Pass a time such as 2026-10-03T10:25:00Z.');
  const today = options.today ?? new Date(nowMs).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today "${today}" is not YYYY-MM-DD`, 'Pass a date such as 2026-10-03.');
  const request = parseRequest(positionals[0]);
  const layout = resolveLayout(root);
  const read = readPolicy(root, policyPath(layout, options.policy));
  if (!read.exists) fail(`no dependency policy at ${read.rel}`, `Copy templates/contracts/dependency-policy.json of the dependency-management skill to ${read.rel} first (check-deps-policy.mjs reports the same as policy-contract).`);
  if (!read.policy) fail(`the dependency policy ${read.rel} is not usable: ${read.errors[0]}`, 'Fix it (check-deps-policy.mjs lists every policy-contract problem), then plan again.');
  const repo = readRepo(root);
  const policy = read.policy;
  if (options['peer-of'] && repo.mode !== 'monorepo') fail(`--peer-of ${options['peer-of']} needs npm workspaces, and this repo has none`, 'Drop --peer-of: a single app has no shared packages.');
  const context = { repo, policy, bans: effectiveBans(policy, loadBanLists()), peerOf: options['peer-of'], today, nowMs, npmrc: repo.npmrc };
  const report = createReporter({ name: 'plan-dependency' });
  const add = (file, line, rule, message, fix) => report.problem({ file, line, rule, message, fix });
  if (options.remove) {
    planRemove(context, request);
    return report.finish({ checked: 1, unit: 'requests' });
  }
  const { row, refused } = vetRequest(context, request, add);
  // A request refused outright needs no npm facts (and must not stop on an npm error for a version
  // that does not exist). A package outside the policy does: the developer decides with them.
  if (refused !== null && refused !== 'not-in-table') return report.finish({ checked: 1, unit: 'requests' });
  const facts = npmFacts(options, request.name, request.version ?? row?.version ?? 'latest', refused !== null);
  if (refused === null) printPlan(context, request, row, facts);
  // Without a version (a package outside the table), npm's latest is the one to age-check.
  if (facts) checkFacts(facts, { name: request.name, version: request.version ?? row?.version ?? facts.version }, row, context, add);
  return report.finish({ checked: 1, unit: 'requests' });
});
