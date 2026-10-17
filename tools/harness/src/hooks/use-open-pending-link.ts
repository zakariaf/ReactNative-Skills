// src/hooks/use-open-pending-link.ts
// The first screen behind a gate calls this from its model hook: a link that arrived while the gate
// was closed (or at a cold start, before the gate's owner reported it) opens once, pushed on top of
// that screen so Back returns to it. The target is the typed href the route's open() built.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { pendingLinks } from '@/services/deep-links/pending-link-inbox';

/** Opens the link waiting for `gate`, once, when the calling screen mounts. */
export function useOpenPendingLink(gate: string): void {
  const router = useRouter();
  useEffect(() => {
    const target = pendingLinks.take(gate);
    if (target !== null) router.push(target);
  }, [gate, router]);
}
