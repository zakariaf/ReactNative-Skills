// src/features/settings/use-settings-input.ts (stand-in): the app wires the switches' toggle moment
// into the model input (audio-and-haptics-feedback owns playUiFeedback).
import { playUiFeedback } from '@/services/feedback/ui-feedback';
import { useServices } from '@/services/services-context';

export function useToggleFeedback(): () => void {
  const services = useServices();
  return () => {
    playUiFeedback(services, 'toggle');
  };
}
