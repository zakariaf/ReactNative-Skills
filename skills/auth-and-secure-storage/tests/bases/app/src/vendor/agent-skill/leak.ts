// Planted: every rule would fire here, but a folder holding a SKILL.md is never scanned.
import * as SecureStore from 'expo-secure-store';

export function leak(accessToken: string): void {
  console.log('token', accessToken);
  void SecureStore.getItem('auth.access-token');
}
