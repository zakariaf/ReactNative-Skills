// src/ui/feedback/confirm.ts
// The top rung of the feedback ladder: a question that must be answered before the person goes
// on. Kept for what cannot be undone; anything reversible happens at once and offers Undo. The
// answer has three outcomes, and only 'confirmed' ever runs the action: leaving the dialog any
// other way (Android back, a newer question, the app root unmounting) is 'dismissed'.

export type ConfirmOutcome = 'confirmed' | 'cancelled' | 'dismissed';

export type ConfirmRequest = {
  /** Translated, names the consequence: "Delete 3 done tasks?", never "Are you sure?". */
  readonly title: string;
  /** Translated, what cannot be undone: "They are removed for good." */
  readonly body: string;
  /** Translated verb of the action: "Delete tasks", never "OK" or "Yes". */
  readonly confirmLabel: string;
  /** Translated "Cancel": the safe choice, placed first. */
  readonly cancelLabel: string;
  /** 'destructive' paints the confirm button in the danger colours. */
  readonly tone: 'destructive' | 'default';
  /** '<screen>.<what>-dialog'; the parts derive .title, .body, .confirm, .cancel. */
  readonly testID: string;
};

/** The one open question, as an external store the provider renders. */
export type ConfirmGate = {
  /** Opens the question; a question already open is answered 'dismissed' first. */
  readonly ask: (request: ConfirmRequest) => Promise<ConfirmOutcome>;
  /** Answers the open question (no-op when none is open). */
  readonly answer: (outcome: ConfirmOutcome) => void;
  readonly current: () => ConfirmRequest | null;
  readonly subscribe: (listener: () => void) => () => void;
};

type Open = {
  readonly request: ConfirmRequest;
  readonly resolve: (outcome: ConfirmOutcome) => void;
};

export function createConfirmGate(): ConfirmGate {
  const listeners = new Set<() => void>();
  let open: Open | null = null;
  const change = (next: Open | null): void => {
    open = next;
    for (const listener of listeners) listener();
  };
  const answer = (outcome: ConfirmOutcome): void => {
    if (open === null) return;
    const { resolve } = open;
    change(null);
    resolve(outcome);
  };
  return {
    ask: (request) =>
      new Promise((resolve) => {
        answer('dismissed');
        change({ request, resolve });
      }),
    answer,
    current: () => open?.request ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
