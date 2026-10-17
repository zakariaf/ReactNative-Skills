// src/i18n/direction-context.tsx
// The layout direction for layout decisions in components: which icons flip, how a coordinate maps
// to the screen. DirectionGate provides readLayoutDirection(); a root drawn outside the app (the
// restart screen) provides its own language's direction. Text takes its direction from the design
// system's TextLocaleProvider instead, which follows the language of the text.
import { createContext, use } from 'react';

import type { Direction } from './languages';
import type { ReactNode } from 'react';

const DirectionContext = createContext<Direction>('ltr');

export type DirectionProviderProps = {
  readonly direction: Direction;
  readonly children: ReactNode;
};

export function DirectionProvider({ direction, children }: DirectionProviderProps): ReactNode {
  return <DirectionContext value={direction}>{children}</DirectionContext>;
}

/** The layout direction; 'ltr' without a provider (Jest lays nothing out and reports LTR). */
export function useDirection(): Direction {
  return use(DirectionContext);
}
