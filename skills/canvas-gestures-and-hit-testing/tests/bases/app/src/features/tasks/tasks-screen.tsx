// src/features/tasks/tasks-screen.tsx
// The screen renders the canvas with the gesture layer's input; it builds no gesture itself.
import { View } from 'react-native';

import { SurfaceCanvas } from '@/canvas/surface-canvas';

import type { TasksModel } from './use-tasks-model';

export function TasksScreen(props: { readonly model: TasksModel }): React.JSX.Element {
  const { model } = props;
  return (
    <View testID="tasks.screen">
      <SurfaceCanvas
        picture={model.picture}
        input={model.grid.input}
        accessibilityLabel={model.gridLabel}
      />
    </View>
  );
}
