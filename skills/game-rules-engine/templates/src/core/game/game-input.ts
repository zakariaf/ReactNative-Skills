// src/core/game/game-input.ts
// How touches become moves. The intent function lives with the game's canvas surface
// (src/games/<game-id>/canvas/intent-to-move.ts, canvas-gestures-and-hit-testing writes it): the
// pure zone of rules/ cannot import the canvas kit, so this contract is generic over the intent.

/**
 * Which pan gesture the surface turns into an intent; taps and long presses always work.
 * 'none': tap-only boards (Lights Out); 'swipe': one flick is one move (a sliding puzzle);
 * 'drag': press on a region, release on another; 'aim': the release vector of a pull.
 * Real-time games steer with a stick gesture instead and declare 'none'.
 */
export type PanMode = 'none' | 'swipe' | 'drag' | 'aim';

/** The least the contract needs from an intent: its kind ('tap', 'swipe', 'drag-end', 'aim', ...). */
export type GameIntent = { readonly kind: string };

/**
 * The input members of a game module. `panMode` and `selectRegions` are plain data the screen
 * passes to the gesture layer; `intentToMove` is pure and returns only moves listMoves lists.
 */
export type GameInput<TState, TMove, TIntent extends GameIntent> = {
  readonly panMode: PanMode;
  /**
   * Regions whose taps select instead of act (a tray of pieces); [] for most games. The screen
   * keeps the selection as UI state and passes it on the next tap as `intent.selected`;
   * intentToMove returns null for a tap inside these regions.
   */
  readonly selectRegions: readonly string[];
  readonly intentToMove: (state: TState, intent: TIntent) => TMove | null;
};
