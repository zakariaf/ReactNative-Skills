// src/features/tasks/components/task-map.tsx
// The map of task locations is a physical surface: north is up and west is left in every language.
import { PhysicalDirectionView } from '@/ui/physical-direction-view';

import { TaskMapCanvas } from './task-map-canvas';

export function TaskMap({ label }: { readonly label: string }): React.JSX.Element {
  return (
    <PhysicalDirectionView testID="tasks.map">
      <TaskMapCanvas accessibilityLabel={label} />
    </PhysicalDirectionView>
  );
}
