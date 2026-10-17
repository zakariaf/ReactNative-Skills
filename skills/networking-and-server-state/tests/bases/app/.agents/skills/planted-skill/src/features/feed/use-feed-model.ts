// src/features/feed/use-feed-model.ts: planted (an installed skill's bad fixture).
import { useQuery } from '@tanstack/react-query';

export function useFeedModel(): unknown {
  return useQuery({ queryKey: ['feed'], queryFn: () => fetch('/feed').then((response) => response.json()) });
}
