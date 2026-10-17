#!/usr/bin/env node
// build-cases.mjs: generates the sample skills the validator self-test runs on, into a folder the
// caller names (tests/selftest.mjs uses a temporary folder; nothing is committed). Two valid base
// skills (one without scripts, one with) give the good-* cases; every other case is a base with
// exactly one planted bug, so it must fail with exactly one rule.
// Layout: <out>/<case-id>/skills/<skill-folder>/... and <out>/<case-id>/case.json.
// Usage: node tools/tests/build-cases.mjs <out-dir>   (to inspect the cases by hand)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, resultLine, run } from '../shared/scripts/check-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHARED = join(HERE, '..', 'shared');
const checkLib = () => readFileSync(join(SHARED, 'scripts', 'check-lib.mjs'), 'utf8');

// ---------------------------------------------------------------------------------------------
// Base skills
// ---------------------------------------------------------------------------------------------

export const DESCRIPTION = 'Checks sample greetings for the validator self-test. Use when testing the skill validator. Not for real apps (validate-skills).';

function skillMd({ name, description = DESCRIPTION, scripted, extraFrontmatter = '', extraWorkflow = '' }) {
  const workflowRun = scripted ? '3. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-greeting.mjs greetings` and fix every FAIL line until it prints `RESULT: PASS`.\n' : '';
  const doneRun = scripted ? '- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-greeting.mjs greetings` prints `RESULT: PASS`.\n' : '';
  const fileRows = scripted
    ? [
        '| `scripts/check-greeting.mjs` | Checker for the greeting rule | Workflow step 3 |',
        '| `scripts/selftest.mjs` | Proves the checker | After changing the checker |',
        '| `scripts/check-lib.mjs` | Shared script helper (synced) | Never by hand |',
        '| `assets/shared.json` | Shared files this skill copies in | When adding a shared file |',
        '| `tests/fixtures/` | Good and planted-bad inputs | When adding a rule |',
      ].join('\n') + '\n'
    : '';
  return `---
name: ${name}
description: ${description}
${extraFrontmatter}---

# Sample greetings

A small, valid skill that the validator self-test changes one rule at a time.

## Rules that must hold

1. **Greet first.** Every greeting starts with "Hello", so the reader knows what it is.

## Workflow

1. Read [references/guide.md](references/guide.md).
2. Copy [templates/greeting.ts](templates/greeting.ts) into the app and fill in the placeholder.
${workflowRun}${extraWorkflow}
## Definition of done

- [ ] The greeting is copied and filled in.
${doneRun}
## Anti-patterns

- Skipping the guide and guessing the wording.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/guide.md](references/guide.md) | How greetings are written | Workflow step 1 |
| [templates/greeting.ts](templates/greeting.ts) | Greeting function to copy | Workflow step 2 |
${fileRows}
## Related skills

- None
`;
}

export const GUIDE = `# Writing greetings

Greetings open every message in the sample app.

- Start with "Hello".
- Follow with the name and a comma.
- Keep it under forty characters.
`;

const TEMPLATE = `// src/features/greeting/greeting.ts
export function __FUNCTION_NAME__(name: string): string {
  return \`Hello, \${name}\`;
}
`;

export const CHECKER = `#!/usr/bin/env node
// check-greeting.mjs: checks that every .txt greeting in a folder starts with "Hello".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createReporter, parseArgs, requireDir, run, walk } from './check-lib.mjs';

const SPEC = {
  name: 'check-greeting',
  summary: 'Checks that every .txt file in the folder starts with "Hello".',
  usage: '[folder]',
  positionals: { min: 0, max: 1 },
};

run(async () => {
  const { positionals } = parseArgs(process.argv.slice(2), SPEC);
  const folder = requireDir(positionals[0] ?? '.', 'folder');
  const report = createReporter({ name: 'check-greeting' });
  const files = walk(folder, { include: ['*.txt'] });
  for (const rel of files) {
    if (!readFileSync(join(folder, rel), 'utf8').startsWith('Hello')) {
      report.problem({ file: rel, line: 1, rule: 'greeting', message: 'does not start with "Hello"', fix: 'Start the greeting with "Hello".' });
    }
  }
  return report.finish({ checked: files.length, unit: 'greetings' });
});
`;

const SELFTEST = `#!/usr/bin/env node
// selftest.mjs: proves check-greeting.mjs passes the good fixture and catches the planted bug.

import { runSelftest } from './check-lib.mjs';

await runSelftest(import.meta.url, [{ script: 'check-greeting.mjs', fixtures: '../tests/fixtures', args: (dir) => [dir] }]);
`;

export function baseBasic(name) {
  return {
    'SKILL.md': skillMd({ name, scripted: false }),
    'references/guide.md': GUIDE,
    'templates/greeting.ts': TEMPLATE,
  };
}

export function baseScripted(name) {
  return {
    'SKILL.md': skillMd({ name, scripted: true }),
    'references/guide.md': GUIDE,
    'templates/greeting.ts': TEMPLATE,
    'scripts/check-greeting.mjs': CHECKER,
    'scripts/selftest.mjs': SELFTEST,
    'scripts/check-lib.mjs': checkLib(),
    'assets/shared.json': '[\n  { "from": "scripts/check-lib.mjs", "to": "scripts/check-lib.mjs" }\n]\n',
    'tests/fixtures/good/hello.txt': 'Hello, Ada\n',
    'tests/fixtures/bad-rude/hello.txt': 'Go away\n',
    'tests/fixtures/bad-rude/EXPECT.txt': 'greeting\n',
  };
}

function baseRunbook(name) {
  return {
    ...baseBasic(name),
    'SKILL.md': skillMd({ name, scripted: false, extraFrontmatter: 'disable-model-invocation: true\n', extraWorkflow: '3. Stop and ask the developer before sending the greeting anywhere.\n' }),
  };
}

// ---------------------------------------------------------------------------------------------
// Cases: { id, base, folder, mutate(files, name) -> files, rules, root: { file: content } }
// ---------------------------------------------------------------------------------------------

const replace = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`build-cases: "${from.slice(0, 40)}" not found`);
  return text.replace(from, to);
};
const withSkill = (files, change) => ({ ...files, 'SKILL.md': change(files['SKILL.md']) });
const withDescription = (description) => (files) => withSkill(files, (text) => replace(text, `description: ${DESCRIPTION}`, `description: ${description}`));
const withGuide = (extra) => (files) => ({ ...files, 'references/guide.md': `${GUIDE}\n${extra}` });
const withFrontmatter = (line) => (files) => withSkill(files, (text) => replace(text, `${DESCRIPTION}\n`, `${DESCRIPTION}\n${line}\n`));
const fileRow = '| Greeting function to copy | Workflow step 2 |\n';

const HOSTILE_SCRIPT = `#!/usr/bin/env node
// check-greeting.mjs written without the shared helper (planted bug for the validator self-test).

import { readdirSync, readFileSync } from 'node:fs';

if (process.argv.includes('--help')) {
  console.log('Usage: node check-greeting.mjs [folder]');
  process.exit(0);
}
const folder = process.argv[2] ?? '.';
const files = readdirSync(folder).filter((name) => name.endsWith('.txt'));
if (files.length === 0) {
  console.log('ERROR nothing to check');
  console.log('RESULT: FAIL (1 problems)');
  process.exit(2);
}
let problems = 0;
for (const name of files) {
  if (!readFileSync(\`\${folder}/\${name}\`, 'utf8').startsWith('Hello')) {
    problems += 1;
    console.log(\`FAIL \${name}:1 [greeting] does not start with "Hello" Fix: start with Hello.\`);
  }
}
console.log(problems ? \`RESULT: FAIL (\${problems} problems)\` : 'RESULT: PASS');
process.exitCode = problems ? 1 : 0;
`;

const LONG_LINE = 'This sentence only pads the workflow so that the Definition of done starts too far down the file for compaction to keep it. ';

const c = (id, base, mutate, rules, extra = {}) => ({ id, base, folder: extra.folder ?? id, mutate, rules, root: extra.root ?? {} });
const same = (files) => files;

export const CASE_TABLE = [
  c('good-basic', baseBasic, same, []),
  c('good-scripted', baseScripted, same, []),
  c('good-runbook', baseRunbook, same, [], { folder: 'run-greeting-send' }),
  c('good-overlay', baseScripted, (files) => ({ ...files, 'tests/fixtures/bad-planted/EXPECT.txt': 'greeting\n', 'tests/fixtures/bad-planted/mutation.json': '[\n  { "write": { "file": "hello.txt", "content": "Go away\\n" } }\n]\n', 'tests/fixtures/bad-planted/DELETE.txt': 'old.txt\n' }), []),
  c('good-inline-expect', baseScripted, (files) => ({ ...files, 'tests/fixtures/CASES.json': '{\n  "bad-inline": { "expect": ["greeting"], "ops": [{ "write": { "file": "hello.txt", "content": "Go away\\n" } }] }\n}\n' }), []),
  c('skill-md', baseBasic, (files) => ({ ...files, 'SKILL.md': null }), ['skill-md']),
  c('fm-line1', baseBasic, (files) => withSkill(files, (text) => `\n${text}`), ['fm-line1']),
  c('fm-close', baseBasic, (files) => withSkill(files, (text) => replace(text, `${DESCRIPTION}\n---\n`, `${DESCRIPTION}\n`)), ['fm-close']),
  c('fm-yaml', baseBasic, withDescription('Checks sample greetings. Use when: testing the skill validator.'), ['fm-yaml']),
  c('fm-key', baseBasic, withFrontmatter('paths: "**/*.ts"'), ['fm-key']),
  c('fm-dmi-runbook', baseBasic, withFrontmatter('disable-model-invocation: true'), ['fm-dmi-runbook']),
  c('fm-dmi-runbook-no-ask', baseRunbook, (files) => withSkill(files, (text) => replace(text, '3. Stop and ask the developer before sending the greeting anywhere.\n', '3. Send the greeting.\n')), ['fm-dmi-runbook'], { folder: 'run-greeting-send' }),
  c('fm-no-allowed-tools', baseBasic, withFrontmatter('allowed-tools: Read'), ['fm-no-allowed-tools']),
  c('name-format', baseBasic, same, ['name-format'], { folder: 'Name-Format' }),
  c('name-match', baseBasic, (files) => withSkill(files, (text) => replace(text, 'name: name-match', 'name: other-name')), ['name-match']),
  c('name-reserved', baseBasic, same, ['name-reserved'], { folder: 'simplify' }),
  c('desc-length', baseBasic, withDescription(`Checks sample greetings for the validator self-test, ${'and keeps adding words to the description '.repeat(6)}. Use when testing the skill validator.`), ['desc-length']),
  c('desc-angle', baseBasic, withDescription('Checks sample greetings for a <name>. Use when testing the skill validator.'), ['desc-angle']),
  c('desc-verb', baseBasic, withDescription('Sample greetings checker for the self-test. Use when testing the skill validator.'), ['desc-verb']),
  c('desc-person', baseBasic, withDescription('Checks sample greetings so you can test things. Use when testing the skill validator.'), ['desc-person']),
  c('desc-trigger', baseBasic, withDescription('Checks sample greetings for the validator self-test of the skill library.'), ['desc-trigger']),
  c('skill-lines', baseBasic, (files) => withSkill(files, (text) => replace(text, '- Skipping the guide and guessing the wording.\n', `- Skipping the guide and guessing the wording.\n${'- Another sample anti-pattern line.\n'.repeat(280)}`)), ['skill-lines']),
  c('sections', baseBasic, (files) => withSkill(files, (text) => {
    const block = '## Anti-patterns\n\n- Skipping the guide and guessing the wording.\n\n';
    return replace(replace(text, block, ''), '## Definition of done', `${block}## Definition of done`);
  }), ['sections']),
  c('section-format', baseBasic, (files) => withSkill(files, (text) => replace(text, '1. **Greet first.**', '- **Greet first.**')), ['section-format']),
  c('dod-position', baseBasic, (files) => withSkill(files, (text) => replace(text, '## Definition of done', `${`${LONG_LINE}\n`.repeat(170)}\n## Definition of done`)), ['dod-position']),
  c('dod-script', baseScripted, (files) => withSkill(files, (text) => replace(text, '- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-greeting.mjs greetings` prints `RESULT: PASS`.\n', '- [ ] The greetings read well aloud.\n')), ['dod-script']),
  c('link-resolve', baseBasic, (files) => withSkill(files, (text) => replace(text, '## Definition of done', '3. Then read [the missing notes](references/missing.md).\n\n## Definition of done')), ['link-resolve']),
  c('files-listed', baseBasic, (files) => ({ ...files, 'references/extra.md': '# Extra\n\nA file nobody listed.\n' }), ['files-listed']),
  c('files-exist', baseBasic, (files) => withSkill(files, (text) => replace(text, fileRow, `${fileRow}| \`references/ghost.md\` | A file that is not there | Never |\n`)), ['files-exist']),
  c('ref-toc', baseBasic, (files) => ({ ...files, 'references/guide.md': `${GUIDE}\n${Array.from({ length: 110 }, (_, i) => `- Greeting example ${i + 1}: Hello, friend number ${i + 1}.`).join('\n')}\n` }), ['ref-toc']),
  c('no-project-ref', baseBasic, withGuide('Before you commit, run node tools/validate-skills.mjs on the library.\n'), ['no-project-ref']),
  c('no-project-ref-home', baseBasic, withGuide('The draft lives in /home/someone/greetings.md for now.\n'), ['no-project-ref']),
  c('no-project-ref-other-skill', baseBasic, withGuide('The wording rules are in .claude/skills/other-skill/references/words.md.\n'), ['no-project-ref']),
  c('no-runtime-env', baseBasic, withGuide('The data folder is under CLAUDE_PLUGIN_ROOT when the skill runs as a plugin.\n'), ['no-runtime-env']),
  c('no-runtime-env-script', baseScripted, (files) => ({ ...files, 'scripts/check-greeting.mjs': replace(CHECKER, "const SPEC = {", "const skillDir = process.env.CLAUDE_SKILL_DIR ?? '.';\nvoid skillDir;\n\nconst SPEC = {") }), ['no-runtime-env']),
  c('no-shouting', baseBasic, withGuide('It is IMPORTANT to greet first.\n'), ['no-shouting']),
  c('device-explicit', baseBasic, withGuide('To see a greeting on the simulator:\n\n```sh\nmaestro test flows/greeting.yaml\n```\n'), ['device-explicit']),
  c('device-explicit-adb', baseBasic, withGuide('To see a greeting on the emulator:\n\n```sh\nadb shell am start -n com.example.greetings/.MainActivity\n```\n'), ['device-explicit']),
  c('layout', baseBasic, (files) => withSkill({ ...files, 'notes.txt': 'Loose notes at the top of the skill.\n' }, (text) => replace(text, fileRow, `${fileRow}| \`notes.txt\` | Loose notes | Never |\n`)), ['layout']),
  c('fixture-hygiene', baseScripted, (files) => ({ ...files, 'tests/fixtures/good/.gitignore': 'build/\n' }), ['fixture-hygiene']),
  c('fixture-hygiene-metadata', baseScripted, (files) => ({ ...files, 'tests/fixtures/good/metadata.json': '{ "kind": "export" }\n' }), ['fixture-hygiene']),
  c('fixture-budget', baseScripted, (files) => ({ ...files, 'tests/fixtures/good/filler.txt': `Hello, ${'x'.repeat(300 * 1024)}\n` }), ['fixture-budget']),
  c('fixture-budget-binary', baseScripted, (files) => ({ ...files, 'tests/fixtures/good/blob.bin': Buffer.from([0, 1, 2, 0, 3, 4]) }), ['fixture-budget']),
  c('script-lib', baseScripted, (files) => ({ ...files, 'scripts/check-greeting.mjs': HOSTILE_SCRIPT }), ['script-lib']),
  c('script-deps', baseScripted, (files) => ({ ...files, 'scripts/check-greeting.mjs': replace(CHECKER, "import { join } from 'node:path';\n", "import { join } from 'node:path';\nimport fs from 'fs';\n") }), ['script-deps']),
  c('script-help', baseScripted, (files) => ({ ...files, 'scripts/check-greeting.mjs': replace(CHECKER, "const SPEC = {", "if (process.argv.includes('--help')) process.exit(3);\n\nconst SPEC = {") }), ['script-help']),
  c('script-result', baseScripted, (files) => ({ ...files, 'scripts/check-greeting.mjs': replace(CHECKER, "const SPEC = {", "if (process.argv.length === 2) {\n  console.log('checked nothing');\n  process.exit(0);\n}\n\nconst SPEC = {") }), ['script-result']),
  c('selftest-missing', baseScripted, (files) => withSkill({ ...files, 'scripts/selftest.mjs': null }, (text) => replace(text, '| `scripts/selftest.mjs` | Proves the checker | After changing the checker |\n', '')), ['selftest-missing']),
  c('fixtures', baseScripted, (files) => ({ ...files, 'tests/fixtures/bad-rude/EXPECT.txt': null }), ['fixtures']),
  c('fixtures-overlay', baseScripted, (files) => ({ ...files, 'tests/fixtures/bad-overlay/EXPECT.txt': 'greeting\n', 'tests/fixtures/bad-overlay/mutation.json': '[\n  { "frobnicate": { "file": "hello.txt" } }\n]\n' }), ['fixtures']),
  c('fixtures-inline-stale', baseScripted, (files) => ({ ...files, 'tests/fixtures/CASES.json': '{\n  "bad-gone": [{ "write": { "file": "hello.txt", "content": "Go away\\n" } }],\n  "bad-empty": { "expect": [], "ops": [] }\n}\n' }), ['fixtures']),
  c('shared-json', baseScripted, (files) => ({ ...files, 'assets/shared.json': '[\n  { "from": "scripts/check-lib.mjs" }\n]\n' }), ['shared-json']),
  c('shared-drift', baseScripted, (files) => ({ ...files, 'scripts/check-lib.mjs': `${files['scripts/check-lib.mjs']}// a local edit that the canonical copy does not have\n` }), ['shared-drift']),
  c('shared-undeclared', baseScripted, (files) => withSkill({ ...files, 'assets/shared.json': null }, (text) => replace(text, '| `assets/shared.json` | Shared files this skill copies in | When adding a shared file |\n', '')), ['shared-undeclared']),
  c('library-layout', baseBasic, same, ['library-layout'], { folder: 'library-layout', root: { 'README.md': '# Skills\n\nA catalogue that belongs in the repo README.\n' } }),
];

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

/** Write every case under outDir. Returns [{ id, folder, rules, dir (the case), skillsRoot }]. */
export function buildCases(outDir) {
  const written = [];
  for (const { id, base, folder, mutate, rules, root } of CASE_TABLE) {
    const caseDir = join(outDir, id);
    const skillsRoot = join(caseDir, 'skills');
    writeTree(join(skillsRoot, folder), mutate(base(folder), folder));
    writeTree(skillsRoot, root);
    writeFileSync(join(caseDir, 'case.json'), `${JSON.stringify({ id, folder, expect: rules.length ? 'fail' : 'pass', rules }, null, 2)}\n`);
    written.push({ id, folder, rules, dir: caseDir, skillsRoot });
  }
  return written;
}

const SPEC = {
  name: 'build-cases',
  summary: 'Writes the validator self-test cases (two base skills and the one-planted-bug mutation table in this file) into the given folder, for inspection. tests/selftest.mjs generates them into a temporary folder itself.',
  usage: '<out-dir>',
  positionals: { min: 1, max: 1 },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(async () => {
    const { positionals } = parseArgs(process.argv.slice(2), SPEC);
    const cases = buildCases(resolve(positionals[0]));
    for (const item of cases) console.log(`wrote ${item.id}/skills/${item.folder} (${item.rules.length ? `expects ${item.rules.join(', ')}` : 'expects PASS'})`);
    console.log(`build-cases: ${cases.length} cases written to ${resolve(positionals[0])}`);
    console.log(resultLine(0));
    return 0;
  });
}
