// src/services/deep-links/link-gates.ts
// Which Stack.Protected gates are open, for +native-intent: it runs outside React (no context, no
// session store), so the component that owns a guard reports it here through useLinkGate. A gate
// nobody reported is closed, so a gated link waits in the inbox instead of opening a screen the
// guard would hide (on SDK 57 the guard sends it to the first reachable screen and it is lost).
export type LinkGateRegistry = {
  /** Records whether `gate` is open now. */
  readonly set: (gate: string, isOpen: boolean) => void;
  /** True only while the gate's owner says it is open. */
  readonly isOpen: (gate: string) => boolean;
};

const openGates = new Set<string>();

/** The app's one registry. */
export const linkGates: LinkGateRegistry = {
  set: (gate, isOpen) => {
    if (isOpen) openGates.add(gate);
    else openGates.delete(gate);
  },
  isOpen: (gate) => openGates.has(gate),
};
