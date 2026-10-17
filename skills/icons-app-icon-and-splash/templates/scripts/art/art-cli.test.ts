// scripts/art/art-cli.test.ts
import { readCli, usageOf } from './art-cli.ts';

import type { CliSpec } from './art-cli.ts';

const SPEC: CliSpec = {
  command: 'node scripts/art/render-icon-sheet.ts',
  summary: 'Renders every icon into one contact sheet.',
  options: {
    out: { type: 'string', value: '<file.png>', help: 'Where to write the sheet' },
    check: { type: 'boolean', help: 'Compare with the committed files' },
  },
  notes: ['Exit codes: 0 done, 1 stale, 2 bad input.'],
};

describe('readCli', () => {
  it('returns the values of known flags', () => {
    expect(readCli(SPEC, ['--out', 'reports/art/sheet.png', '--check'])).toStrictEqual({
      kind: 'run',
      values: { out: 'reports/art/sheet.png', check: true },
    });
  });

  it('prints the usage and exits 0 for --help and -h', () => {
    for (const flag of ['--help', '-h']) {
      const outcome = readCli(SPEC, [flag]);
      expect(outcome.kind === 'exit' && outcome.code).toBe(0);
      expect(outcome.kind === 'exit' && outcome.text.split('\n')[0]).toBe(
        'Usage: node scripts/art/render-icon-sheet.ts [--out <file.png>] [--check]',
      );
    }
  });

  it('refuses an unknown flag with exit 2 and a pointer to --help', () => {
    const outcome = readCli(SPEC, ['--chek']);
    expect(outcome.kind === 'exit' && outcome.code).toBe(2);
    expect(outcome.kind === 'exit' && outcome.text).toContain("Unknown option '--chek'");
    expect(outcome.kind === 'exit' && outcome.text).toContain(`Run: ${SPEC.command} --help`);
  });

  it('refuses a flag without its value and a stray positional', () => {
    expect(readCli(SPEC, ['--out']).kind === 'exit').toBe(true);
    expect(readCli(SPEC, ['sheet.png']).kind === 'exit').toBe(true);
  });
});

describe('usageOf', () => {
  it('shows a required flag without brackets', () => {
    const out = {
      type: 'string',
      value: '<file.png>',
      isRequired: true,
      help: 'The sheet',
    } as const;
    expect(usageOf({ ...SPEC, options: { out } }).split('\n')[0]).toBe(
      'Usage: node scripts/art/render-icon-sheet.ts --out <file.png>',
    );
  });

  it('lists every option, --help and the notes', () => {
    expect(usageOf(SPEC).split('\n').slice(4)).toStrictEqual([
      'Options:',
      '  --out <file.png>  Where to write the sheet',
      '  --check           Compare with the committed files',
      '  -h, --help        Show this help and exit',
      '',
      'Exit codes: 0 done, 1 stale, 2 bad input.',
    ]);
  });
});
