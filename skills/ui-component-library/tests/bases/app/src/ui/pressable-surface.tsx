// src/ui/pressable-surface.tsx: fixture stub of design-system-structure's press surface, the one press host.
import { Pressable } from 'react-native';

import { usePressFeedback } from './press-feedback-context';

import type { ReactNode } from 'react';

export type PressableSurfaceProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly accessibilityRole?: 'button' | 'switch';
  readonly children: ReactNode;
};

export function PressableSurface(props: PressableSurfaceProps): ReactNode {
  const onPressFeedback = usePressFeedback();
  const role = props.accessibilityRole ?? 'button';
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={props.label}
      onPress={() => {
        if (role !== 'switch') onPressFeedback();
        props.onPress();
      }}
      testID={props.testID}
    >
      {props.children}
    </Pressable>
  );
}
