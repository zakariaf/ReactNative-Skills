// src/services/share/fake-share.ts
import type { SharePort } from './share-port';

export function createFakeShare(): SharePort {
  return { shareTask: () => Promise.resolve('shared') };
}
