// src/ui/switch-row.tsx (stand-in): a switch is the one control that pulses (selection).
import type { HapticsPort } from '@/services/haptics/haptics-port';

export function pulseSwitch(haptics: HapticsPort): void {
  haptics.play('selection');
}
