// src/features/tasks/components/empty-tasks-mascot.tsx (example: a shape to imitate)
// The empty state of the task list: an informative Rive state machine (it looks up when the person
// touches it) with one translated label for VoiceOver and TalkBack. Light, so it never waits for
// another moment; its frame rate is the record's fps, so a 120 Hz screen still draws 30 frames a
// second. Under Reduce Motion, in a test build held still and off screen it rests on its first frame.
import { StyleSheet } from 'react-native';

import { RiveMoment } from '@/ui/animation/rive-moment';

import type { ReactNode } from 'react';

export type EmptyTasksMascotProps = {
  /** t('tasks.empty.mascotLabel'), from the model hook. */
  readonly label: string;
  readonly isFocused: boolean;
  readonly onError: (error: unknown) => void;
};

const styles = StyleSheet.create({ mascot: { width: 160, height: 160, alignSelf: 'center' } });

export function EmptyTasksMascot({ label, isFocused, onError }: EmptyTasksMascotProps): ReactNode {
  return (
    // contracts/animations.json: empty-tasks-mascot, rive, state-machine "Idle", settles, fps 30,
    // light, informative, reducedMotion { show: frame }.
    <RiveMoment
      source={require('@/assets/animations/empty-tasks-mascot.riv')}
      stateMachineName="Idle"
      frameRate={30}
      still="first-frame"
      weight="light"
      decorative={false}
      label={label}
      isActive={isFocused}
      style={styles.mascot}
      testID="tasks.empty-mascot"
      onError={onError}
    />
  );
}
