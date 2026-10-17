// src/use-tracker.ts (planted: an installed skill's fixture; check-analytics must not scan it)
import { PostHog } from 'posthog-react-native';

const client = new PostHog('phc_abcdefghijklmnopqrstuvwxyz0123456789ABCD', { enableSessionReplay: true });
export const send = (title: string) => client.capture('typed', { title });
