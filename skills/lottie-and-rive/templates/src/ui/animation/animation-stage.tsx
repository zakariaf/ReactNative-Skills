// src/ui/animation/animation-stage.tsx
// Owned by the lottie-and-rive skill. At most one heavy animation plays on screen at a time: every
// heavy moment that wants to play queues on the stage, the first in the queue plays, the others hold
// their still frame until it is done or unmounts. Light moments never queue. Mount
// <AnimationStageProvider> once above the screens (the root stack's providers, or one screen); with
// no provider every heavy moment plays, so the provider is part of the wiring the tests prove.
import { createContext, use, useEffect, useId, useState, useSyncExternalStore } from 'react';

import type { AnimationWeight } from './animation-playback';
import type { ReactNode } from 'react';

export type AnimationStage = {
  /** The heavy moment that may play now, or null. */
  readonly holder: () => string | null;
  readonly enqueue: (id: string) => void;
  readonly leave: (id: string) => void;
  readonly subscribe: (onChange: () => void) => () => void;
};

/** A fresh stage: a first-come queue of heavy moments that want to play. */
export function createAnimationStage(): AnimationStage {
  const queue: string[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    holder: () => queue[0] ?? null,
    enqueue: (id) => {
      if (queue.includes(id)) return;
      queue.push(id);
      notify();
    },
    leave: (id) => {
      const at = queue.indexOf(id);
      if (at === -1) return;
      queue.splice(at, 1);
      notify();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}

const AnimationStageContext = createContext<AnimationStage | null>(null);

export type AnimationStageProviderProps = { readonly children: ReactNode };

export function AnimationStageProvider({ children }: AnimationStageProviderProps): ReactNode {
  const [stage] = useState(createAnimationStage);
  return <AnimationStageContext value={stage}>{children}</AnimationStageContext>;
}

const noHolder = (): string | null => null;
const noSubscription = (): (() => void) => () => undefined;

/** True when this moment may play now: always for a light one, for a heavy one while it holds the stage. */
export function useAnimationSlot(weight: AnimationWeight, shouldPlay: boolean): boolean {
  const stage = use(AnimationStageContext);
  const id = useId();
  const isHeavy = weight === 'heavy';
  const holder = useSyncExternalStore(
    stage?.subscribe ?? noSubscription,
    stage?.holder ?? noHolder,
    stage?.holder ?? noHolder,
  );
  useEffect(() => {
    if (stage === null || !isHeavy || !shouldPlay) return undefined;
    stage.enqueue(id);
    return () => {
      stage.leave(id);
    };
  }, [stage, id, isHeavy, shouldPlay]);
  if (!isHeavy || stage === null) return true;
  return holder === id;
}
