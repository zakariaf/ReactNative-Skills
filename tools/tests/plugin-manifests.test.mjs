#!/usr/bin/env node
// plugin-manifests.test.mjs: checks the install manifests against tools/catalog.json and the skills on disk:
// .claude-plugin/marketplace.json (two plugins, every skill in exactly one, games only in react-native-games,
// the shared metadata), no root .claude-plugin/plugin.json (its name would rename both plugins),
// .codex-plugin/plugin.json, skills.json, docs/skills-data.js and the install lines in README.md. Then it
// plants one bug per rule in a temporary copy and proves each is caught.
//   node tools/tests/plugin-manifests.test.mjs [--repo <dir>]

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReporter, makeTempDir, parseArgs, removeTempDir, run } from '../shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const REPO_URL = 'https://github.com/zakariaf/ReactNative-Skills';
export const MARKETPLACE = 'react-native-skills';
export const PLUGIN_OF = { core: 'react-native', games: 'react-native-games' };
export const INSTALL_LINES = [
  '/plugin marketplace add zakariaf/ReactNative-Skills',
  `/plugin install react-native@${MARKETPLACE}`,
  `/plugin install react-native-games@${MARKETPLACE}`,
];

const readJsonIn = (repo, rel, problems) => {
  const path = join(repo, rel);
  if (!existsSync(path)) {
    problems.push({ file: rel, rule: 'manifest-missing', message: 'does not exist', fix: rel.endsWith('marketplace.json') || rel === 'skills.json' ? 'Run: node tools/build-catalog.mjs' : 'Restore it.' });
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push({ file: rel, rule: 'manifest-json', message: `is not valid JSON: ${error.message}`, fix: 'Fix the JSON.' });
    return null;
  }
};

/** Every manifest problem in a repo folder: [{ file, rule, message, fix }]. */
export function checkManifests(repo) {
  const problems = [];
  const add = (file, rule, message, fix) => problems.push({ file, rule, message, fix });
  const catalog = readJsonIn(repo, 'tools/catalog.json', problems);
  if (!catalog) return problems;
  const built = catalog.skills.filter((skill) => existsSync(join(repo, 'skills', skill.name, 'SKILL.md')));
  const expected = new Map(built.map((skill) => [skill.name, PLUGIN_OF[skill.plugin]]));

  // Claude Code marketplace
  const market = readJsonIn(repo, '.claude-plugin/marketplace.json', problems);
  if (market) {
    if (market.name !== MARKETPLACE) add('.claude-plugin/marketplace.json', 'marketplace-name', `is named ${JSON.stringify(market.name)}`, `Name it ${MARKETPLACE}: the README install lines use it.`);
    if (!market.owner?.name) add('.claude-plugin/marketplace.json', 'marketplace-owner', 'has no owner.name', 'Add the owner.');
    const names = (market.plugins ?? []).map((entry) => entry?.name);
    for (const name of Object.values(PLUGIN_OF)) if (!names.includes(name)) add('.claude-plugin/marketplace.json', 'plugin-missing', `has no ${name} entry`, 'Run: node tools/build-catalog.mjs');
    const placed = new Map();
    const versions = new Set();
    for (const entry of market.plugins ?? []) {
      if (!Object.values(PLUGIN_OF).includes(entry?.name)) continue;
      const file = `.claude-plugin/marketplace.json (${entry.name})`;
      if (entry.source !== './') add(file, 'plugin-source', `source is ${JSON.stringify(entry.source)}`, 'Use "./" (the skills live at the repo root).');
      for (const key of ['homepage', 'repository']) if (entry[key] !== REPO_URL) add(file, 'plugin-metadata', `${key} is ${JSON.stringify(entry[key])}`, `Use ${REPO_URL} (tools/build-catalog.mjs PLUGIN_META).`);
      if (entry.license !== 'MIT') add(file, 'plugin-metadata', `license is ${JSON.stringify(entry.license)}`, 'Use MIT (the LICENSE file).');
      if (!/^\d+\.\d+\.\d+$/.test(entry.version ?? '')) add(file, 'plugin-metadata', `version is ${JSON.stringify(entry.version)}`, 'Use a semver version (tools/build-catalog.mjs PLUGIN_META).');
      versions.add(entry.version);
      if (typeof entry.description !== 'string' || entry.description.length < 40) add(file, 'plugin-metadata', 'has no description', 'Run: node tools/build-catalog.mjs');
      if (!Array.isArray(entry.skills)) {
        add(file, 'plugin-skills', 'has no "skills" list, so it would load every folder in skills/', 'Run: node tools/build-catalog.mjs');
        continue;
      }
      for (const path of entry.skills) {
        const name = /^\.\/skills\/([a-z0-9-]+)$/.exec(path)?.[1];
        if (!name || !existsSync(join(repo, 'skills', name, 'SKILL.md'))) {
          add(file, 'plugin-skill-path', `lists ${path}, which is not a skill folder with a SKILL.md`, 'Run: node tools/build-catalog.mjs');
          continue;
        }
        if (placed.has(name)) add(file, 'skill-listed-twice', `${name} is also listed in ${placed.get(name)}`, 'List each skill once, in exactly one plugin (tools/catalog.json "plugin").');
        placed.set(name, entry.name);
        if (expected.has(name) && expected.get(name) !== entry.name) add(file, 'skill-wrong-plugin', `${name} belongs to ${expected.get(name)} (tools/catalog.json)`, 'Run: node tools/build-catalog.mjs');
      }
    }
    for (const name of expected.keys()) if (!placed.has(name)) add('.claude-plugin/marketplace.json', 'skill-unlisted', `${name} is in no plugin, so no install loads it`, 'Run: node tools/build-catalog.mjs');
    if (versions.size > 1) add('.claude-plugin/marketplace.json', 'plugin-version', `the plugins carry different versions: ${[...versions].join(', ')}`, 'Release both plugins with one version.');
    const codex = readJsonIn(repo, '.codex-plugin/plugin.json', problems);
    if (codex) {
      if (codex.name !== 'react-native') add('.codex-plugin/plugin.json', 'codex-manifest', `name is ${JSON.stringify(codex.name)}`, 'Name it react-native.');
      for (const key of ['homepage', 'repository']) if (codex[key] !== REPO_URL) add('.codex-plugin/plugin.json', 'codex-manifest', `${key} is ${JSON.stringify(codex[key])}`, `Use ${REPO_URL}.`);
      if (codex.skills !== './skills/') add('.codex-plugin/plugin.json', 'codex-manifest', `skills is ${JSON.stringify(codex.skills)}`, 'Point it at "./skills/".');
      if (versions.size === 1 && !versions.has(codex.version)) add('.codex-plugin/plugin.json', 'plugin-version', `version ${codex.version} differs from the marketplace's ${[...versions][0]}`, 'Release every manifest with one version.');
    }
  }
  if (existsSync(join(repo, '.claude-plugin', 'plugin.json'))) add('.claude-plugin/plugin.json', 'plugin-json-present', 'exists: both "source": "./" entries would take its name, so the games skills would load as react-native:<skill>', 'Delete it; the marketplace entries carry the metadata.');

  // Generated catalogue data agrees with the catalogue.
  const skillsJson = readJsonIn(repo, 'skills.json', problems);
  if (skillsJson) {
    if (skillsJson.repo !== 'zakariaf/ReactNative-Skills') add('skills.json', 'catalog-data', `repo is ${JSON.stringify(skillsJson.repo)}`, 'Run: node tools/build-catalog.mjs');
    const listed = new Map((skillsJson.skills ?? []).map((skill) => [skill.name, skill.plugin]));
    if (listed.size !== expected.size || [...expected].some(([name, plugin]) => listed.get(name) !== plugin)) add('skills.json', 'catalog-data', 'its skills or plugins differ from tools/catalog.json and the skills on disk', 'Run: node tools/build-catalog.mjs');
  }
  const siteData = existsSync(join(repo, 'docs', 'skills-data.js')) ? readFileSync(join(repo, 'docs', 'skills-data.js'), 'utf8') : null;
  const siteSkills = siteData && /window\.SKILLS = ([\s\S]*?);\n/.exec(siteData);
  if (!siteSkills) add('docs/skills-data.js', 'site-data', 'is missing or has no window.SKILLS', 'Run: node tools/build-catalog.mjs');
  else if (JSON.parse(siteSkills[1]).length !== expected.size) add('docs/skills-data.js', 'site-data', 'lists a different number of skills', 'Run: node tools/build-catalog.mjs');
  const site = existsSync(join(repo, 'docs', 'index.html')) ? readFileSync(join(repo, 'docs', 'index.html'), 'utf8') : '';
  if (!site.includes('src="skills-data.js"')) add('docs/index.html', 'site-page', 'is missing or does not load skills-data.js', 'Restore the catalogue page.');

  // README install lines and the licence.
  const readme = existsSync(join(repo, 'README.md')) ? readFileSync(join(repo, 'README.md'), 'utf8') : '';
  for (const line of INSTALL_LINES) if (!readme.includes(line)) add('README.md', 'readme-install', `has no line "${line}"`, 'Add the install line (the marketplace and plugin names must match the manifests).');
  if (!existsSync(join(repo, 'LICENSE'))) add('LICENSE', 'license', 'does not exist', 'Restore the MIT licence.');
  return problems;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const rules = (problems) => [...new Set(problems.map((problem) => problem.rule))].sort();
let repoUnderTest = REPO;

test('the repo: the manifests agree with the catalogue', () => {
  const problems = checkManifests(repoUnderTest);
  assert.deepEqual(problems, [], problems.map((problem) => `${problem.file} [${problem.rule}] ${problem.message}`).join(' | '));
});

test('planted bugs: each is caught by its own rule', () => {
  const tmp = makeTempDir('manifests-');
  try {
    const copy = join(tmp, 'repo');
    for (const rel of ['tools/catalog.json', '.claude-plugin', '.codex-plugin', 'skills.json', 'docs/skills-data.js', 'docs/index.html', 'README.md', 'LICENSE']) cpSync(join(REPO, rel), join(copy, rel), { recursive: true });
    const catalog = JSON.parse(readFileSync(join(REPO, 'tools', 'catalog.json'), 'utf8'));
    for (const skill of catalog.skills) {
      if (!existsSync(join(REPO, 'skills', skill.name, 'SKILL.md'))) continue;
      mkdirSync(join(copy, 'skills', skill.name), { recursive: true });
      writeFileSync(join(copy, 'skills', skill.name, 'SKILL.md'), '---\nname: x\n---\n');
    }
    assert.deepEqual(checkManifests(copy), []);
    const marketPath = join(copy, '.claude-plugin', 'marketplace.json');
    const pristine = readFileSync(marketPath, 'utf8');
    const plant = (rule, edit, alsoExpected = []) => {
      const market = JSON.parse(pristine);
      edit(market);
      writeFileSync(marketPath, JSON.stringify(market));
      assert.deepEqual(rules(checkManifests(copy)), [rule, ...alsoExpected].sort(), rule);
      writeFileSync(marketPath, pristine);
    };
    const core = (market) => market.plugins.find((entry) => entry.name === 'react-native');
    const games = (market) => market.plugins.find((entry) => entry.name === 'react-native-games');
    plant('skill-wrong-plugin', (market) => core(market).skills.push(games(market).skills.pop()));
    plant('skill-listed-twice', (market) => core(market).skills.push(core(market).skills[1]));
    plant('skill-unlisted', (market) => core(market).skills.pop());
    plant('plugin-skill-path', (market) => core(market).skills.push('./skills/not-a-skill'));
    plant('plugin-metadata', (market) => (games(market).repository = 'https://github.com/someone/fork'));
    plant('plugin-version', (market) => (games(market).version = '0.0.1'));
    plant('plugin-source', (market) => (core(market).source = './plugins/core'));
    plant('plugin-missing', (market) => (market.plugins = market.plugins.filter((entry) => entry.name !== 'react-native-games')), ['skill-unlisted']);
    plant('marketplace-name', (market) => (market.name = 'rn-skills'));
    writeFileSync(join(copy, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'react-native' }));
    assert.deepEqual(rules(checkManifests(copy)), ['plugin-json-present']);
    rmSync(join(copy, '.claude-plugin', 'plugin.json'));
    const readme = readFileSync(join(copy, 'README.md'), 'utf8');
    writeFileSync(join(copy, 'README.md'), readme.replaceAll('react-native-games@react-native-skills', 'react-native-games@rn'));
    assert.deepEqual(rules(checkManifests(copy)), ['readme-install']);
    writeFileSync(join(copy, 'README.md'), readme);
    const codexPath = join(copy, '.codex-plugin', 'plugin.json');
    const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
    writeFileSync(codexPath, JSON.stringify({ ...codex, skills: './other/' }));
    assert.deepEqual(rules(checkManifests(copy)), ['codex-manifest']);
    writeFileSync(codexPath, JSON.stringify(codex));
    rmSync(join(copy, 'skills', catalog.skills[0].name), { recursive: true });
    assert.ok(rules(checkManifests(copy)).includes('catalog-data'), 'a skill folder that disappears makes skills.json stale');
  } finally {
    removeTempDir(tmp);
  }
});

run(async () => {
  const { options } = parseArgs(process.argv.slice(2), {
    name: 'plugin-manifests.test',
    summary: 'Checks .claude-plugin/marketplace.json, .codex-plugin/plugin.json, skills.json, docs/skills-data.js and the README install lines against tools/catalog.json, then proves each rule on planted bugs.',
    usage: '[--repo <dir>]',
    options: { repo: { type: 'string', value: 'dir', help: 'Repository to check (default: this one)' } },
  });
  if (options.repo) repoUnderTest = resolve(options.repo);
  const report = createReporter({ name: 'plugin-manifests.test' });
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      report.problem({ file: 'tools/tests/plugin-manifests.test.mjs', rule: 'manifests', message: `${name}: ${String(error?.message ?? error).split('\n').join(' | ')}`, fix: 'Fix the manifest (node tools/build-catalog.mjs regenerates most of them) or this test.' });
    }
  }
  return report.finish({ checked: tests.length, unit: 'tests' });
});
