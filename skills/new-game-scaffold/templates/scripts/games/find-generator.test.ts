// scripts/games/find-generator.test.ts
import { findGenerator, generatorCandidates, SKILL_FOLDERS, SKILL_NAME } from './find-generator.ts';

const generatorIn = (folder: string): string => `${folder}/${SKILL_NAME}/scripts/scaffold-game.mjs`;

describe('findGenerator', () => {
  it('lists one candidate per install folder, the skills CLI folder first', () => {
    expect(generatorCandidates()).toStrictEqual(SKILL_FOLDERS.map(generatorIn));
    expect(SKILL_FOLDERS[0]).toBe('.agents/skills');
  });

  it('prefers the skills CLI folder when the skill is installed twice', () => {
    const installed = new Set(generatorCandidates());

    expect(findGenerator((path) => installed.has(path))).toBe(generatorIn('.agents/skills'));
  });

  it('finds a vendored copy', () => {
    const vendored = generatorIn('skills');

    expect(findGenerator((path) => path === vendored)).toBe(vendored);
  });

  it('returns null when the skill is not installed', () => {
    expect(findGenerator(() => false)).toBeNull();
  });
});
