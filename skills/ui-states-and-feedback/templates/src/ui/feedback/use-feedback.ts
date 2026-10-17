// src/ui/feedback/use-feedback.ts
import { use } from 'react';

import { FeedbackContext } from './feedback-context';

import type { Feedback } from './feedback-context';

/** notify() and confirm(). A missing provider is a programmer error, so it throws. */
export function useFeedback(): Feedback {
  const feedback = use(FeedbackContext);
  if (feedback === null) throw new Error('useFeedback() needs a <FeedbackProvider> above it');
  return feedback;
}
