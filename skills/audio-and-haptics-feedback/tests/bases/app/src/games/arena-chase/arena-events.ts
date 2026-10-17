// src/games/arena-chase/arena-events.ts (stand-in): drained sim events, once per frame on JS.
import type { AudioPort } from '@/services/audio/audio-port';
import type { HapticsPort } from '@/services/haptics/haptics-port';

export function onCaught(audio: AudioPort, haptics: HapticsPort): void {
  audio.play('caught');
  haptics.play('heavy');
}
