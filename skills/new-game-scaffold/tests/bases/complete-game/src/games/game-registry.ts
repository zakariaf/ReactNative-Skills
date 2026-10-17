// src/games/game-registry.ts
// Self-test stand-in: game-session-host writes the real file; check-game-scaffold reads its import and factory.
import { GAME_HOST_CONFIG } from '@/config/game-host-config';
import { LIGHTS_OUT_HOSTED } from '@/games/lights-out/lights-out-hosted';
import { createGameHost } from '@/services/game-host/game-host';

import type { GameHost, GameHostDeps } from '@/services/game-host/game-host';

const HOST_FACTORIES: readonly ((deps: Omit<GameHostDeps, 'options'>) => GameHost)[] = [
  (deps) => createGameHost(LIGHTS_OUT_HOSTED, { ...deps, options: GAME_HOST_CONFIG['lights-out'] }),
];

export function createGameHosts(deps: Omit<GameHostDeps, 'options'>): readonly GameHost[] {
  return HOST_FACTORIES.map((create) => create(deps));
}
