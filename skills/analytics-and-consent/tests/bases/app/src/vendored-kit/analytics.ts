// src/vendored-kit/analytics.ts (planted: pruned because the folder holds a SKILL.md)
import { PostHog } from 'posthog-react-native';

export const client = new PostHog('key', { captureTouches: true });
export function trackPath(pathname: string): void {
  client.capture('screen', { pathname });
}
