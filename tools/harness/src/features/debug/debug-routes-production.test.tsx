// src/features/debug/debug-routes-production.test.tsx
// The second line of defence: in a production bundle the gate is null, and a debug URL that reaches
// the router anyway (an old link, a typed URL) lands on the first screen instead of an empty page.
// The gate is mocked to what Metro leaves in a production bundle.
import { screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';

import DebugLayout from '@/app/(debug)/_layout';
import DebugMenuRoute from '@/app/(debug)/debug/index';
import DebugSetupRoute from '@/app/(debug)/debug/setup';
import { AppText } from '@/ui/app-text';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import { DEBUG_LINK_PATH } from './debug-links';

jest.mock('@/test-only', () => ({ TEST_ONLY: null }));

function RootLayout(): React.JSX.Element {
  return <Slot />;
}

function Home(): React.JSX.Element {
  return <AppText testID="tasks.list">home</AppText>;
}

async function openUrl(url: string): Promise<string> {
  const view = await renderRouterWithProviders(
    {
      _layout: RootLayout,
      '(app)/index': Home,
      '(debug)/_layout': DebugLayout,
      '(debug)/debug/index': DebugMenuRoute,
      '(debug)/debug/setup': DebugSetupRoute,
    },
    { initialUrl: url },
  );
  await screen.findByTestId('tasks.list');
  return view.getPathname();
}

describe('the debug routes in a production bundle', () => {
  it('sends /debug to the first screen', async () => {
    expect(await openUrl('/debug')).toBe('/');
  });

  it('sends a debug link to the first screen without applying it', async () => {
    expect(await openUrl(`/${DEBUG_LINK_PATH}?offline=1&open=tasks`)).toBe('/');
  });
});
