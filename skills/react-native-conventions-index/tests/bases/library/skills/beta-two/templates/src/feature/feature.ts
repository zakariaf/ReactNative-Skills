// src/feature/feature.ts
import { useCount } from '@/core/core';

import { label } from './helper';

export function featureLabel(): string {
  return label(useCount.getState().count);
}
