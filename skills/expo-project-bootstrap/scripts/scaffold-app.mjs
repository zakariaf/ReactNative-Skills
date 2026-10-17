#!/usr/bin/env node
// scaffold-app.mjs: writes the skeleton of a new Expo app from this skill's templates (one app at the
// repo root: root configs, gate scripts, the variant config, a starter route and screen, placeholder
// art). Dry run by default (prints the plan); --write creates the files. It never overwrites a file
// that differs from what the templates produce: that is a conflict to resolve (or --replace <file>).
// Run: node ${CLAUDE_SKILL_DIR}/scripts/scaffold-app.mjs [repo-root] --app-id <id> --name <name> [--write]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildPlan, leftoversIn, preExistingEntries, validateVariables, variablesFrom } from './lib/bootstrap-plan.mjs';
import { createReporter, fail, parseArgs, requireDir, resolveLayout, run } from './check-lib.mjs';

const SPEC = {
  name: 'scaffold-app',
  summary: 'Plans (default) or writes (--write) every file of a new Expo app skeleton at the repo root: the canonical root configs, the gate scripts, the dependency policy, app.config.ts with three variants, a starter route and screen, placeholder icons. Identical files are left alone, .gitignore, .claude/settings.json and CLAUDE.md are merged, any other existing file that differs is a conflict, and template leftovers (app.json, the demo components) are reported.',
  usage: '[repo-root] --app-id <reverse-dns> --name <display name> [options]',
  options: {
    'app-id': { type: 'string', value: 'id', help: 'Production iOS bundle id and Android package, e.g. com.acme.tasks (development and preview append .dev and .preview)' },
    name: { type: 'string', value: 'text', help: 'Display name on the home screen, e.g. "Tasks"' },
    slug: { type: 'string', value: 'slug', help: 'Expo slug and package.json name (default: the name in kebab case)' },
    scheme: { type: 'string', value: 'scheme', help: 'URL scheme (default: the slug without hyphens)' },
    write: { type: 'boolean', help: 'Write the files (without it nothing is changed)' },
    replace: { type: 'string', multiple: true, value: 'file', help: 'Overwrite this conflicting repo file with the template' },
    compare: { type: 'boolean', help: 'Fail unless every file already equals what the templates produce (proves a generated tree is current)' },
  },
  positionals: { min: 0, max: 1 },
  details: [
    'Rules reported:',
    '  conflict   an existing file differs from the template (or .claude/settings.json disagrees with the gates)',
    '  leftover   a file or folder of Expo\'s default template that the skeleton replaces (app.json, src/components/, ...)',
    '  differs    (--compare) a file is missing or is not what the templates produce',
    '',
    'Images (assets/icons/<variant>/, assets/images/) are placeholders: an existing image is kept.',
    'When multi-package: run it inside the app folder (apps/<app>), then follow references/project-layout.md.',
    '',
    'Example: node scaffold-app.mjs . --app-id com.acme.tasks --name "Tasks" --write',
  ].join('\n'),
};

run(async () => {
  const { options, positionals } = parseArgs(process.argv.slice(2), SPEC);
  const root = requireDir(positionals[0] ?? '.', 'repo root');
  if (!options['app-id'] || !options.name) fail('pass --app-id <reverse-dns> and --name <display name>', 'Ask the developer for the registered store id and the display name, e.g. --app-id com.acme.tasks --name "Tasks" (nothing is written without --write).');
  const vars = variablesFrom({ appId: options['app-id'], name: options.name, slug: options.slug, scheme: options.scheme });
  const { problems, notes } = validateVariables(vars);
  if (problems.length) fail(problems.join('; '), 'Fix the option values and rerun.');

  const report = createReporter({ name: 'scaffold-app' });
  for (const note of notes) report.note(`NOTE ${note}`);
  const plan = buildPlan(root, vars);
  const replace = new Set(options.replace);
  for (const rel of replace) if (!plan.some((entry) => entry.rel === rel)) fail(`--replace ${rel} names no file the templates produce`, 'Pass the repo path of a file the plan lists as a conflict.');
  const counts = { create: 0, merge: 0, same: 0, conflict: 0, replaced: 0 };
  for (const entry of plan) {
    let action = entry.action;
    if (action === 'conflict' && replace.has(entry.rel)) action = 'replaced';
    counts[action] += 1;
    if (options.compare) {
      if (action !== 'same') report.problem({ file: entry.rel, rule: 'differs', message: action === 'create' ? 'is missing' : 'is not what the templates produce', fix: 'Regenerate the tree with --write, or update the templates.' });
      continue;
    }
    if (action === 'conflict') {
      report.problem({ file: entry.rel, rule: 'conflict', message: entry.notes.join('; '), fix: `Read both, keep what the developer needs, then rerun with --replace ${entry.rel} (or edit the file to the template content).` });
      continue;
    }
    const notesText = entry.notes.length ? ` (${entry.notes.join('; ')})` : '';
    if (action !== 'same' || notesText) console.log(`${options.write ? 'wrote' : 'plan '} ${action.padEnd(8)} ${entry.rel}${notesText}`);
    if (options.write && action !== 'same') {
      const target = join(root, entry.rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.content);
    }
  }
  const layout = resolveLayout(root);
  for (const item of leftoversIn(root, { routesDir: layout.routesDir })) {
    report.problem({ file: item.rel, rule: 'leftover', message: `is a template leftover: ${item.why}`, fix: item.fix });
  }
  const ignored = preExistingEntries(root).map((entry) => entry.name);
  console.log(`app: ${vars.name} (${vars.appId}, slug ${vars.slug}, scheme ${vars.scheme}); variants development (${vars.appId}.dev), preview (${vars.appId}.preview), production`);
  console.log(`pre-existing top-level entries ignored by Prettier, ESLint and the root TypeScript program: ${ignored.length ? ignored.join(', ') : 'none'}`);
  console.log(`${options.write ? 'written' : 'planned'}: ${counts.create} new, ${counts.merge} merged, ${counts.replaced} replaced, ${counts.same} unchanged, ${counts.conflict} conflicts${options.write ? '' : ' (dry run: add --write to create the files)'}`);
  return report.finish({ checked: plan.length, unit: 'template files' });
});
