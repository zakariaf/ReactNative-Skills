// scripts/games/find-generator.ts
// Pure: where the new-game-scaffold skill's generator sits in this repo. Agents install skills into
// different folders (.agents/skills for the skills CLI, .claude/skills for Claude Code, skills/ when
// the repo vendors them); `npm run new-game` must find the one generator wherever it is, so the npm
// script and the skill write exactly the same files from the same templates.

export const SKILL_NAME = 'new-game-scaffold';

/** The install folders, most specific first. */
export const SKILL_FOLDERS: readonly string[] = ['.agents/skills', '.claude/skills', 'skills'];

/** Every place the generator may sit, repo-relative. */
export function generatorCandidates(): readonly string[] {
  return SKILL_FOLDERS.map((folder) => `${folder}/${SKILL_NAME}/scripts/scaffold-game.mjs`);
}

/** The first candidate that exists, or null when the skill is not installed in this repo. */
export function findGenerator(exists: (path: string) => boolean): string | null {
  return generatorCandidates().find((path) => exists(path)) ?? null;
}
