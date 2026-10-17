// Planted findings inside an installed skill: check-push must never read this file.
import { requestPermissionsAsync, setNotificationHandler } from 'expo-notifications';
import { router } from 'expo-router';

export function planted(response: { data: { url: string } }): void {
  setNotificationHandler(null);
  requestPermissionsAsync().catch(() => undefined);
  router.push(response.data.url);
  fetch('https://exp.host/--/api/v2/push/send').catch(() => undefined);
}
