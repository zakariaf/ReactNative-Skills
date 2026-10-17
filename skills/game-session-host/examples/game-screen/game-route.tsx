// src/app/game/[gameId].tsx
// The Game route: thin. It parses the raw params with the route's valibot parser (navigation-and-
// routing's paramParsers entry: gameId plus the run to open) and renders the feature screen; a
// link it cannot parse shows the app's own not-found route, never a half-built game.
import { useLocalSearchParams } from 'expo-router';

import NotFoundRoute from '@/app/+not-found';
import { parseGameParams } from '@/features/game/game-params';
import { GameScreen } from '@/features/game/game-screen';

import type { JSX } from 'react';

export default function GameRoute(): JSX.Element {
  const parsed = parseGameParams(useLocalSearchParams());
  if (!parsed.ok) return <NotFoundRoute />;
  return <GameScreen gameId={parsed.value.gameId} open={parsed.value.open} />;
}
