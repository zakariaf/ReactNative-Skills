// src/ui/adaptive/list-detail-layout.test.tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { View } from 'react-native';

import { CONTENT_MAX_WIDTH } from '@/theme/tokens';
import { renderWithProviders } from '@test/render-with-providers';

import { ListDetailLayout } from './list-detail-layout';
import { LIST_PANE_WIDTH } from './pane-layout';

import type { ListDetailLayoutProps } from './list-detail-layout';
import type { ListDetailPanes } from './use-list-detail-layout';
import type { ReactElement, ReactNode } from 'react';

function noLayout(): void {
  // The tests set the pane layout directly; the hook's own test covers the measured width.
}

const ONE_PANE: ListDetailPanes = { layout: { kind: 'one-pane' }, onLayout: noLayout };
const TWO_PANES: ListDetailPanes = {
  layout: { kind: 'two-pane', listWidth: LIST_PANE_WIDTH },
  onLayout: noLayout,
};

/** Calls onMount once per mount, so a test can tell a kept pane from a remounted one. */
function MountProbe({ onMount }: { readonly onMount: () => void }): ReactNode {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <View testID="tasks.list-probe" />;
}

function panes(overrides: Partial<ListDetailLayoutProps>): ReactElement {
  return (
    <ListDetailLayout
      testID="tasks.panes"
      panes={ONE_PANE}
      onePane="list"
      list={<View testID="tasks.list" />}
      detail={<View testID="tasks.detail" />}
      emptyDetail={<View testID="tasks.no-selection" />}
      {...overrides}
    />
  );
}

describe('ListDetailLayout', () => {
  it('shows only the list on the list route when one pane fits', async () => {
    await renderWithProviders(panes({}));
    expect(screen.getByTestId('tasks.list')).toBeOnTheScreen();
    expect(screen.queryByTestId('tasks.panes.detail')).not.toBeOnTheScreen();
  });

  it('shows only the detail on the detail route when one pane fits', async () => {
    await renderWithProviders(panes({ onePane: 'detail' }));
    expect(screen.getByTestId('tasks.detail')).toBeOnTheScreen();
    expect(screen.queryByTestId('tasks.panes.list')).not.toBeOnTheScreen();
  });

  it('shows both panes side by side when two fit, the list at the layout width', async () => {
    await renderWithProviders(panes({ panes: TWO_PANES }));
    expect(screen.getByTestId('tasks.panes')).toHaveStyle({ flexDirection: 'row' });
    expect(screen.getByTestId('tasks.panes.list')).toHaveStyle({ width: LIST_PANE_WIDTH });
    expect(screen.getByTestId('tasks.detail')).toBeOnTheScreen();
  });

  it('caps the detail at a readable width', async () => {
    await renderWithProviders(panes({ panes: TWO_PANES }));
    expect(screen.getByTestId('tasks.panes.detail-column')).toHaveStyle({
      maxWidth: CONTENT_MAX_WIDTH,
    });
  });

  it('fills the detail pane with the empty hint while nothing is selected', async () => {
    await renderWithProviders(panes({ panes: TWO_PANES, detail: null }));
    expect(screen.getByTestId('tasks.no-selection')).toBeOnTheScreen();
  });

  it('reports its own width, so the pane count follows the box and not the window', async () => {
    const onLayout = jest.fn();
    await renderWithProviders(panes({ panes: { ...ONE_PANE, onLayout } }));
    const layout = { x: 0, y: 0, width: 664, height: 1000 };
    await fireEvent(screen.getByTestId('tasks.panes'), 'layout', { nativeEvent: { layout } });
    expect(onLayout).toHaveBeenCalledWith({ nativeEvent: { layout } });
  });

  it('keeps the list mounted when the box crosses the two-pane width', async () => {
    const onMount = jest.fn();
    const list = <MountProbe onMount={onMount} />;
    const view = await renderWithProviders(panes({ list }));
    await view.rerender(panes({ list, panes: TWO_PANES }));
    await view.rerender(panes({ list }));
    expect(screen.getByTestId('tasks.list-probe')).toBeOnTheScreen();
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
