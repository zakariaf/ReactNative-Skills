// scripts/deps/engines-floor.test.ts
import { ENGINE_FLOORS, admitsBelow, enginesProblems } from './engines-floor.ts';

describe('admitsBelow', () => {
  it.each([
    ['>=11.17.0', false],
    ['>=11.17', false],
    ['^11.17.0', false],
    ['>= 11.17.0', false],
    ['>11.17.0', false],
    ['11.17.0 - 12', false],
    ['>=12 || >=11.17.0', false],
    ['>=10 <12 >=11.17', false],
    ['>=11.16.0', true],
    ['>11.16.9', true],
    ['>=10', true],
    ['11.x', true],
    ['*', true],
    ['', true],
    ['<12', true],
    ['< 12', true],
    ['>=11.17.0 || >=10', true],
    ['>=11.17.0-rc.1', true],
  ])('reports whether npm range %j admits a version below 11.17.0 (%s)', (range, isBelow) => {
    expect(admitsBelow(range, ENGINE_FLOORS.npm)).toBe(isBelow);
  });

  it('treats a missing range as open', () => {
    expect(admitsBelow(undefined, ENGINE_FLOORS.node)).toBe(true);
  });

  it('reads Node ranges against 22.18', () => {
    expect(admitsBelow('>=22.18', ENGINE_FLOORS.node)).toBe(false);
    expect(admitsBelow('^22.18.0 || ^24 || >=26', ENGINE_FLOORS.node)).toBe(false);
    expect(admitsBelow('>=22', ENGINE_FLOORS.node)).toBe(true);
  });
});

describe('enginesProblems', () => {
  it('accepts the canonical engines', () => {
    expect(enginesProblems({ engines: { node: '>=22.18', npm: '>=11.17.0' } })).toStrictEqual([]);
  });

  it('reports missing engines, which leave engine-strict guarding nothing', () => {
    expect(enginesProblems({})).toStrictEqual([
      'package.json "engines.npm" is missing: set it to ">=11.17.0"',
      'package.json "engines.node" is missing: set it to ">=22.18"',
    ]);
  });

  it('reports a range that lets an older npm run the install', () => {
    expect(enginesProblems({ engines: { node: '>=22.18', npm: '>=10' } })).toStrictEqual([
      'package.json "engines.npm" is ">=10", which admits npm below 11.17.0: set it to ">=11.17.0"',
    ]);
  });
});
