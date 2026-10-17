// src/features/tasks/empty-state.tsx
import { Image } from 'expo-image';

const EMPTY = require('./empty.png') as number;

export function EmptyState(): React.JSX.Element {
  return <Image source={EMPTY} />;
}
