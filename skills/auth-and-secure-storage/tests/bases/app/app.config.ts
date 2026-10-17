// app.config.ts: the Tasks app (fixture). Each variant has its own scheme in a real app.
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Tasks',
  slug: 'tasks',
  scheme: 'tasks',
  plugins: [
    'expo-router',
    // Sign in with Apple: the com.apple.developer.applesignin entitlement.
    'expo-apple-authentication',
    // Android Auto Backup leaves the SecureStore preferences out; no Face ID purpose string.
    ['expo-secure-store', { faceIDPermission: false }],
  ],
});
