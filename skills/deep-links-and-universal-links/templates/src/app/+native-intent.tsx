// src/app/+native-intent.tsx
// Expo Router's hook for every incoming native link (custom scheme, universal link, Android app
// link; cold start and warm): its redirectSystemPath decides what the URL opens before the router
// routes it. The decision lives in src/features/deep-links/redirect-system-path.ts, where it is
// tested; this file only exposes it (no default export: it is not a screen).
export { redirectSystemPath } from '@/features/deep-links/redirect-system-path';
