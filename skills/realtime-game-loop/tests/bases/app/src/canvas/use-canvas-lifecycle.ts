// src/canvas/use-canvas-lifecycle.ts
// Stand-in for skia-canvas-rendering's lifecycle hook (the checker only reads that it exists).
export function useCanvasLifecycle(input: { readonly isFocused: boolean }): void {
  void input;
}
