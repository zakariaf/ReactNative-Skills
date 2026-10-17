// test/a11y/app-contrast.test.ts
// Every colour table the contrast contract lists (the theme palette first) meets WCAG 2.2 AA in every
// colour set, and keeps its distinct colours apart for colour-blind eyes: the Jest twin of
// check-contrast.mjs. It finds the contract where the checker does (rn-skills.config.json
// "contrastContract", else contracts/contrast.json) and holds it to the same thresholds
// (quality-gates.json may raise them, never lower them).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  asContract,
  colorSetsOf,
  contractPathOf,
  contrastProblems,
  distinctProblems,
  parseJsonc,
  thresholdsOf,
} from './contrast-contract';

const ROOT = join(__dirname, '..', '..');

function readRepoJson(file: string): unknown {
  const path = join(ROOT, file);
  return existsSync(path) ? parseJsonc(readFileSync(path, 'utf8')) : undefined;
}

const CONTRACT_FILE = contractPathOf(readRepoJson('rn-skills.config.json'));
// A missing contract fails here, as it fails check-contrast.mjs: nothing would prove the colours.
const CONTRACT = asContract(readRepoJson(CONTRACT_FILE));
const MIN = thresholdsOf(readRepoJson('quality-gates.json'));

describe('the contrast contract', () => {
  it('lists at least one palette and names each once', () => {
    const names = CONTRACT.palettes.map((palette) => palette.name);
    expect(names).not.toHaveLength(0);
    expect(names).toStrictEqual([...new Set(names)]);
  });

  for (const palette of CONTRACT.palettes) {
    describe(`the ${palette.name} palette`, () => {
      // The contract names the module; Jest compiles TypeScript palettes on require.
      const sets = colorSetsOf(palette, require(join(ROOT, palette.file)));

      it('meets WCAG 2.2 AA for every declared pair in every colour set', () => {
        const exceptions = CONTRACT.exceptions ?? [];
        expect(contrastProblems(palette, sets, { exceptions, min: MIN })).toStrictEqual([]);
      });

      it('keeps every distinct list apart for protan, deutan and tritan eyes', () => {
        expect(distinctProblems(palette, sets, MIN.cvd)).toStrictEqual([]);
      });
    });
  }
});
