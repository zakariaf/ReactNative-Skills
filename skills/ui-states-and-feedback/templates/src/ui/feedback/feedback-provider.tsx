// src/ui/feedback/feedback-provider.tsx
// The app's one feedback host, mounted once in the root providers: model hooks call notify() for
// a notice and confirm() for a question that must be answered (through useFeedback()); this
// provider holds the one notice and the one open question and renders both above every screen.
// The context carries only the two stable functions, never the changing state.
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { createConfirmGate } from './confirm';
import { ConfirmDialog } from './confirm-dialog';
import { FEEDBACK_TEST_IDS, FeedbackContext } from './feedback-context';
import { INITIAL_NOTICE_STATE, noticeReducer } from './notice';
import { NoticeHost } from './notice-host';

import type { ConfirmOutcome, ConfirmRequest } from './confirm';
import type { Feedback } from './feedback-context';
import type { NoticeEvent } from './notice';
import type { ReactNode } from 'react';

export type FeedbackProviderProps = {
  /** Translated "Dismiss" for a notice that stays until dismissed. */
  readonly dismissLabel: string;
  /** useSafeAreaInsets().bottom in the root providers. */
  readonly bottomInset: number;
  readonly isReducedMotion: boolean;
  readonly children: ReactNode;
};

const styles = StyleSheet.create({ fill: { flex: 1 } });

function createFeedback(
  dispatch: (event: NoticeEvent) => void,
  ask: (request: ConfirmRequest) => Promise<ConfirmOutcome>,
): Feedback {
  let serial = 0;
  return {
    notify: (request) => {
      serial += 1;
      dispatch({ type: 'notice-shown', notice: { ...request, serial } });
    },
    confirm: ask,
  };
}

export function FeedbackProvider(props: FeedbackProviderProps): ReactNode {
  const [notices, dispatch] = useReducer(noticeReducer, INITIAL_NOTICE_STATE);
  const [gate] = useState(createConfirmGate);
  const [feedback] = useState(() => createFeedback(dispatch, gate.ask));
  const request = useSyncExternalStore(gate.subscribe, gate.current, gate.current);
  // A question still open when the host goes away is answered, so no caller waits forever.
  useEffect(
    () => () => {
      gate.answer('dismissed');
    },
    [gate],
  );
  return (
    <FeedbackContext value={feedback}>
      <View style={styles.fill}>
        {props.children}
        <NoticeHost
          testID={FEEDBACK_TEST_IDS.notice}
          notice={notices.current}
          onClose={(serial) => {
            dispatch({ type: 'notice-closed', serial });
          }}
          dismissLabel={props.dismissLabel}
          bottomInset={props.bottomInset}
          isReducedMotion={props.isReducedMotion}
        />
      </View>
      <ConfirmDialog
        testID={FEEDBACK_TEST_IDS.confirm}
        request={request}
        onAnswer={gate.answer}
        isReducedMotion={props.isReducedMotion}
      />
    </FeedbackContext>
  );
}
