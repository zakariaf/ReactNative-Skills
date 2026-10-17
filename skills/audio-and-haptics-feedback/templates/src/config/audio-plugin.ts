// src/config/audio-plugin.ts
// The react-native-audio-api config plugin entry. Pure and neutral: app.config.ts runs this file in
// Node (type stripping) and lists AUDIO_API_PLUGIN in its plugins; without that line every default
// below applies.
import type { ExpoConfig } from 'expo/config';

type PluginEntry = NonNullable<ExpoConfig['plugins']>[number];

/**
 * Every default overridden (verified on react-native-audio-api 0.13.6, src/plugin/withAudioAPI.ts):
 * no iOS background audio mode, no Android FOREGROUND_SERVICE permissions or media-playback service,
 * and no FFmpeg or prebuilt-library downloads at build time. After `npx expo prebuild`, Info.plist
 * has no UIBackgroundModes audio and no NSMicrophoneUsageDescription, the merged AndroidManifest has
 * no FOREGROUND_SERVICE permission, and the Podfile and gradle.properties carry the disable flags.
 */
export const AUDIO_API_PLUGIN: PluginEntry = [
  'react-native-audio-api',
  {
    iosBackgroundMode: false,
    androidPermissions: [],
    androidForegroundService: false,
    disableFFmpeg: true,
    disableStaticExternalLibs: true,
  },
];
