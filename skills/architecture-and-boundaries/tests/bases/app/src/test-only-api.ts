import type { ComponentType } from 'react';

export type TestOnlyApi = {
  readonly DebugScreen: ComponentType;
  readonly TEST_BUILD_SENTINEL: string;
};
