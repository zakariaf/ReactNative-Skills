// test/web/root-html.test.tsx
// The root HTML is a route file (src/app/+html.tsx), so its test lives here: route folders hold
// routes only.
import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import RootHtml, { GROUND_CSS } from '@/app/+html';
import { PALETTE } from '@/theme/palette';

import type { TestInstance } from 'test-renderer';

function hostsOfType(container: TestInstance, type: string): TestInstance[] {
  return container.queryAll((instance) => instance.type === type);
}

describe('RootHtml', () => {
  it('names the source language and direction and renders the page inside body', async () => {
    await render(
      <RootHtml>
        <View testID="web-root.page" />
      </RootHtml>,
    );

    expect(hostsOfType(screen.container, 'html')[0]?.props).toMatchObject({
      lang: 'en',
      dir: 'ltr',
    });
    expect(hostsOfType(screen.container, 'body')[0]).toContainElement(
      screen.getByTestId('web-root.page'),
    );
  });

  it('lets the safe-area insets reach the page', async () => {
    await render(<RootHtml />);

    const viewport = hostsOfType(screen.container, 'meta').find(
      (meta) => meta.props['name'] === 'viewport',
    );
    expect(viewport?.props).toMatchObject({
      content: expect.stringContaining('viewport-fit=cover'),
    });
  });

  it('paints the ground of both schemes before JavaScript runs', () => {
    expect(GROUND_CSS).toContain(`body{background-color:${PALETTE.light.background};}`);
    expect(GROUND_CSS).toContain(
      `(prefers-color-scheme: dark){body{background-color:${PALETTE.dark.background};}}`,
    );
  });
});
