// src/games/arena-chase/sounds/arena-chase-sounds.test.ts (stand-in)
import { recipeProblems } from '@/services/audio/synth/recipe-problems';

import { ARENA_CHASE_SOUNDS } from './arena-chase-sounds';

it('renders every sound cleanly', () => {
  for (const spec of Object.values(ARENA_CHASE_SOUNDS)) expect(recipeProblems(spec.recipe)).toStrictEqual([]);
});
