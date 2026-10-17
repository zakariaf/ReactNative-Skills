// src/games/game-registry.ts
// The app's games. One factory per game: each closes over its own typed module and calls the one
// generic seam, so the list itself holds only erased GameHost values and needs no cast.
import { GAME_HOST_CONFIG } from '@/config/game-host-config';
import { LIGHTS_OUT_HOSTED } from '@/games/lights-out/lights-out-hosted';
import { createGameHost } from '@/services/game-host/game-host';

import type { GameHost, GameHostDeps } from '@/services/game-host/game-host';

/** What every host shares; each game adds its own options from the config. */
export type SharedHostDeps = Omit<GameHostDeps, 'options'>;

const HOST_FACTORIES: readonly ((deps: SharedHostDeps) => GameHost)[] = [
  (deps) => createGameHost(LIGHTS_OUT_HOSTED, { ...deps, options: GAME_HOST_CONFIG['lights-out'] }),
];

/** Called once, in the composition root, after the data layer opened (never at import time). */
export function createGameHosts(deps: SharedHostDeps): readonly GameHost[] {
  return HOST_FACTORIES.map((create) => create(deps));
}
