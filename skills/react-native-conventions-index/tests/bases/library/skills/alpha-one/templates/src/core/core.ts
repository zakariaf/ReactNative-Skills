// src/core/core.ts
import { create } from 'zustand';

import { double } from './util';

export const useCount = create(() => ({ count: double(1) }));
