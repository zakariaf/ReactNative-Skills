// src/services/audio/audio-api-audio-adapter.ts, the opt-in part (example: a shape to imitate)
// Only for an app that ships a recorded sound listed in contracts/audio-feedback.json bundledSounds
// (with its licence and source). The default adapter synthesises every sound; this is the one place
// that may decode a file. Not verified on a device: prove it on a release build of iOS and Android
// before relying on it (react-native-audio-api 0.13.6 resolves a module number through
// Image.resolveAssetSource, read from source; a URL would be fetched, which feedback never does).
import type { AudioBuffer, AudioContext } from 'react-native-audio-api';

/** A bank entry for a recorded sound: the module number of a bundled asset instead of a recipe. */
export type BundledSoundSpec = {
  readonly category: 'sfx' | 'ui';
  /** require('@/assets/sounds/chime.wav'): a local asset, never a URL. */
  readonly asset: number;
  readonly minIntervalMs?: number;
};

/** Inside the adapter's load(): decode each bundled asset once, at startup, next to the recipes. */
export async function decodeBundled(
  ctx: AudioContext,
  specs: Readonly<Record<string, BundledSoundSpec>>,
  reportError: (error: unknown) => void,
): Promise<ReadonlyMap<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  for (const [id, spec] of Object.entries(specs)) {
    try {
      buffers.set(id, await ctx.decodeAudioData(spec.asset));
    } catch (error) {
      // A sound that fails to decode stays silent; the failure is recorded, never thrown into the UI.
      reportError(error);
    }
  }
  return buffers;
}
