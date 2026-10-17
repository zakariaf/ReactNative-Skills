# Example: the Tasks list and its detail on every window

A shape to imitate, never copied verbatim. One screen, two routes: `/tasks` (the list, with an
optional `selected` search param) and `/tasks/[id]` (the detail). On a compact window each route
shows its own pane; when two panes fit, both routes show the list beside the selected task. The
selection is always the route's. Strings come from the app's catalog (`tasks.detail.empty`).

## Contents

1. Route files
2. The model hook
3. The screen
4. A supporting pane without a breakpoint
5. Tests
6. The contract entry

## 1. Route files

```tsx
// src/app/(app)/tasks/index.tsx
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel('list');
  return <TasksScreen model={model} />;
}
```

```tsx
// src/app/(app)/tasks/[id].tsx
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TaskRoute(): React.JSX.Element {
  const model = useTasksModel('detail');
  return <TasksScreen model={model} />;
}
```

Both routes are thin (architecture-and-boundaries' `route-thin`); the only difference is which pane
the route stands for when one pane fits.

## 2. The model hook

```ts
// src/features/tasks/use-tasks-model.ts
import { router, useLocalSearchParams } from 'expo-router';

import { useT } from '@/i18n/t-context';
import { useListDetailLayout } from '@/ui/adaptive/use-list-detail-layout';

import { useTasks } from './use-tasks';

import type { Task } from './task-list';
import type { ListDetailPanes } from '@/ui/adaptive/use-list-detail-layout';

export type TasksModel = {
  readonly tasks: readonly Task[];
  /** The task the route names, or null (nothing selected, or an id that no longer exists). */
  readonly selected: Task | null;
  readonly panes: ListDetailPanes;
  readonly onePane: 'list' | 'detail';
  readonly emptyHint: string;
  readonly onSelect: (id: string) => void;
};

export function useTasksModel(onePane: 'list' | 'detail'): TasksModel {
  const t = useT();
  const tasks = useTasks();
  // Each route owns one param: the detail route names the task by `id`, the list route by
  // `selected` (two panes only). Read the one this route owns, so a stray param never wins.
  const params = useLocalSearchParams<{ id?: string; selected?: string }>();
  const panes = useListDetailLayout();
  const selectedId = (onePane === 'detail' ? params.id : params.selected) ?? null;
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  return {
    tasks,
    selected,
    panes,
    onePane,
    emptyHint: t('tasks.detail.empty'),
    onSelect: (id) => {
      if (panes.layout.kind === 'one-pane') {
        // One pane: open the detail route; back returns to the list.
        router.push(`/tasks/${id}`);
      } else if (onePane === 'detail') {
        // Two panes on the detail route (a link, or a phone push then rotated or unfolded): change
        // the route's own `id`, so /tasks/t2 becomes /tasks/t3 with no new stack entry.
        router.setParams({ id });
      } else {
        // Two panes on the list route: swap `selected` (no stack entry per tap).
        router.setParams({ selected: id });
      }
    },
  };
}
```

Nothing here watches the window to navigate. When the window crosses the two-pane width, the same
route simply renders the other way (`references/list-detail-and-navigation.md`, section 4).

## 3. The screen

```tsx
// src/features/tasks/tasks-screen.tsx
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeStyles } from '@/theme/make-styles';
import { SPACING } from '@/theme/tokens';
import { ListDetailLayout } from '@/ui/adaptive/list-detail-layout';
import { AppText } from '@/ui/app-text';
import { BELOW_HEADER_EDGES } from '@/ui/screen-frame';

import { TaskDetail } from './components/task-detail';
import { TaskRow } from './components/task-row';

import type { TasksModel } from './use-tasks-model';

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    hint: { padding: SPACING.lg },
  });
  return styles;
});

export function TasksScreen({ model }: { readonly model: TasksModel }): React.JSX.Element {
  const styles = useStyles();
  return (
    <SafeAreaView testID="tasks.screen" edges={BELOW_HEADER_EDGES} style={styles.root}>
      <ListDetailLayout
        testID="tasks.panes"
        panes={model.panes}
        onePane={model.onePane}
        list={
          <FlatList
            testID="tasks.list"
            data={model.tasks}
            keyExtractor={(task) => task.id}
            renderItem={({ item }) => (
              <TaskRow
                task={item}
                isSelected={model.selected?.id === item.id}
                onSelect={model.onSelect}
              />
            )}
          />
        }
        detail={model.selected ? <TaskDetail task={model.selected} /> : null}
        emptyDetail={
          <View style={styles.hint}>
            <AppText testID="tasks.detail.empty" tone="muted">
              {model.emptyHint}
            </AppText>
          </View>
        }
      />
    </SafeAreaView>
  );
}
```

Why a `SafeAreaView` and not `ScreenFrame`: `ScreenFrame` caps its whole column at
`CONTENT_MAX_WIDTH` (640 pt), and two panes need at least 721 pt, so inside it the screen would never
split. A list-detail screen fills the window instead; `ListDetailLayout` caps the detail pane's own
column at `CONTENT_MAX_WIDTH`, and the list pane has its fixed width, so no line runs wide. The edges
are still the named set for what sits around the screen (a header above: `BELOW_HEADER_EDGES`), and
the left and right edges stay on so a landscape notch pads the panes. `ListDetailLayout` measures its
own box inside those edges and `useListDetailLayout` decides from it, so the same screen beside a
side tab bar or in an iPad form sheet gets one pane when two do not fit; before the first layout the
hook estimates from the window minus the same side insets.

## 4. A supporting pane without a breakpoint

Some screens add a side panel (filters, a summary) when the window is wide and short. Decide it
from the window class, never from a number:

```ts
const windowClass = useWindowClass();
const showsSidePanel = windowClass.width === 'regular' && windowClass.isLandscape && !windowClass.isLargeText;
```

If the decision needs a real width ("the panel needs 280 pt beside a 400 pt body"), write it as a
pure function in `src/ui/adaptive/pane-layout.ts` with its window-table test, like
`listDetailLayoutOf`; a `width >= 900` in the screen is a `raw-breakpoint` failure.

## 5. Tests

The routes, at a phone window and iPad windows (the router helper is unit-and-component-tests'
`@test/render-router-with-providers`; the window mock is the one in
`templates/src/ui/adaptive/use-list-detail-layout.test.tsx`):

```tsx
// src/app/(app)/tasks/tasks-routes.test.tsx
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '@/i18n/i18n-provider';
import { renderRouterWithProviders } from '@test/render-router-with-providers';

import TaskRoute from './[id]';
import TasksRoute from './index';

const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

function inWindow(width: number, height: number): void {
  Object.assign(mockWindow, { width, height, fontScale: 1 });
}

function failOnError(error: Error): never {
  throw error;
}

/** A root layout stand-in: the safe-area metrics Jest lacks, the app's copy, the matched route. */
function TestRootLayout(): React.JSX.Element {
  const frame = { x: 0, y: 0, width: mockWindow.width, height: mockWindow.height };
  const insets = { top: 24, right: 0, bottom: 20, left: 0 };
  return (
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <I18nProvider language="en" digits="automatic" onError={failOnError}>
        <Slot />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const routes = {
  _layout: TestRootLayout,
  'tasks/index': TasksRoute,
  'tasks/[id]': TaskRoute,
};

describe('tasks routes', () => {
  it('opens the detail route on a phone', async () => {
    inWindow(402, 874);
    const view = await renderRouterWithProviders(routes, { initialUrl: '/tasks' });
    await userEvent.setup().press(screen.getByTestId('tasks.task-row.task-2'));
    expect(view.getPathname()).toBe('/tasks/task-2');
  });

  it('keeps the list and sets the selection on an iPad mini', async () => {
    inWindow(744, 1133);
    const view = await renderRouterWithProviders(routes, { initialUrl: '/tasks' });
    await userEvent.setup().press(screen.getByTestId('tasks.task-row.task-2'));
    expect(view.getPathname()).toBe('/tasks');
    expect(view.getSearchParams()['selected']).toBe('task-2');
    expect(await screen.findByTestId('tasks.detail.task-2')).toBeOnTheScreen();
  });

  it('shows the list beside the task when a link opens the detail on a wide window', async () => {
    inWindow(1376, 1032);
    await renderRouterWithProviders(routes, { initialUrl: '/tasks/task-2' });
    expect(screen.getByTestId('tasks.panes.list')).toBeOnTheScreen();
    expect(screen.getByTestId('tasks.detail.task-2')).toBeOnTheScreen();
  });

  it('changes the detail route itself when a row is tapped there on two panes', async () => {
    inWindow(1376, 1032);
    const view = await renderRouterWithProviders(routes, { initialUrl: '/tasks/task-2' });
    await userEvent.setup().press(screen.getByTestId('tasks.task-row.task-3'));
    expect(view.getPathname()).toBe('/tasks/task-3');
    expect(await screen.findByTestId('tasks.detail.task-3')).toBeOnTheScreen();
  });

  it('pushes on an iPad mini whose panes get 664 pt beside a side tab bar', async () => {
    inWindow(744, 1133);
    const view = await renderRouterWithProviders(routes, { initialUrl: '/tasks' });
    const layout = { x: 0, y: 0, width: 664, height: 1089 };
    await fireEvent(screen.getByTestId('tasks.panes'), 'layout', { nativeEvent: { layout } });
    expect(screen.queryByTestId('tasks.panes.detail')).not.toBeOnTheScreen();
    await userEvent.setup().press(screen.getByTestId('tasks.task-row.task-2'));
    expect(view.getPathname()).toBe('/tasks/task-2');
  });
});
```

Verified on 2026-10-10 in the reference app with the kit and these files (expo-router 57.0.24,
RNTL 14): all five pass. The fourth is the one that catches a list-route `setParams({ selected })`
called from the detail route: the URL would become `/tasks/task-2?selected=task-3` and the pane would
stay on `task-2`. The fifth fires the layout event Jest never fires by itself, so the pane count
follows the measured box. Await every press and `fireEvent` (RNTL 14's are async; an unawaited press
leaves the pathname unchanged), and read the param with brackets
(`noPropertyAccessFromIndexSignature`). The `_layout` stand-in gives the safe-area metrics Jest lacks
and the app's `I18nProvider` (i18n-strings-and-catalogs; the router helper's provider tree carries no
catalogs), then renders the matched route through `Slot`; a real app's root layout already mounts
both.

## 6. The contract entry

```json
{
  "listDetailScreens": ["src/features/tasks/tasks-screen.tsx"]
}
```

`check-adaptive-layout.mjs` then requires the screen to render `ListDetailLayout`, the pane kit to
exist, and the feature to read its selection from the route.
