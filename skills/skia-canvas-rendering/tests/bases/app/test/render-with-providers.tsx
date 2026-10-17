// test/render-with-providers.tsx (a stand-in: unit-and-component-tests owns the real file)
import { render } from '@testing-library/react-native';

import type { ReactElement } from 'react';

export function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  return render(ui);
}
