// app.config.ts: the fixture app's config (only the media plugin entries matter here).
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Tasks',
  slug: 'tasks',
  plugins: [
    'expo-router',
    [
      'expo-image-picker',
      {
        photosPermission: 'permissions.photos.usage-description',
        cameraPermission: 'permissions.camera.usage-description',
        microphonePermission: false,
      },
    ],
    [
      'expo-media-library',
      {
        savePhotosPermission: 'permissions.photos-add.usage-description',
        photosPermission: false,
        granularPermissions: [],
      },
    ],
  ],
  android: {
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    ],
  },
});
