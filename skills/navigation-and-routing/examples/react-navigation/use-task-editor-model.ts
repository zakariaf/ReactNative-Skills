// src/features/task-editor/use-task-editor-model.ts (React Navigation static API): the editor's model
// hook blocks removal while the draft is unsaved. The confirmed path replays the blocked action; a save
// leaves through the leaving ref, because the "unsaved" state has not re-rendered yet when it navigates.
import { usePreventRemove, useNavigation } from '@react-navigation/native';
import { useRef, useState } from 'react';

import type { NavigationAction } from '@react-navigation/native';

export type TaskEditorModel = {
  readonly isDiscardPromptOpen: boolean;
  readonly onChangeTitle: (title: string) => void;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
};

export function useTaskEditorModel(): TaskEditorModel {
  const navigation = useNavigation();
  const [title, setTitle] = useState('');
  const [blocked, setBlocked] = useState<NavigationAction | null>(null);
  const isLeavingRef = useRef(false);
  usePreventRemove(title.length > 0, ({ data }) => {
    if (isLeavingRef.current) navigation.dispatch(data.action);
    else setBlocked(data.action);
  });
  return {
    isDiscardPromptOpen: blocked !== null,
    onChangeTitle: setTitle,
    onDiscard: () => {
      if (blocked === null) return;
      isLeavingRef.current = true;
      navigation.dispatch(blocked);
    },
    onSave: () => {
      isLeavingRef.current = true;
      navigation.popTo('Home');
    },
  };
}
