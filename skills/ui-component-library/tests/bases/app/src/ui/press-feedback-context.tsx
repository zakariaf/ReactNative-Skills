// src/ui/press-feedback-context.tsx: fixture stub of design-system-structure's press feedback seam.
import { createContext, use } from 'react';

const PressFeedbackContext = createContext<() => void>(() => undefined);

export function usePressFeedback(): () => void {
  return use(PressFeedbackContext);
}
