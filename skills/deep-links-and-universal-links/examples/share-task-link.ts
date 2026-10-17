// src/config/share-links.ts (example: building the links the app shares)
// Shared links are https links of the verified host: people without the app get the web page, people
// with it get the app, and no other app can answer them. Remote URLs live in src/config (the lint
// config bans them elsewhere). The path is one the allow-list lists and contracts/deep-links.json
// webPaths covers, so the shared link opens the same screen it came from.
import { currentAppVariant } from './current-app-variant';

import type { AppVariant } from './app-variant';

/** The verified host each variant shares (contracts/deep-links.json hosts, first entry). */
const SHARE_HOST: Readonly<Record<AppVariant, string>> = {
  development: 'preview.tasks.example.com',
  preview: 'preview.tasks.example.com',
  production: 'tasks.example.com',
};

/** https://tasks.example.com/tasks/task-12, the id encoded once. */
export function shareTaskUrl(taskId: string): string {
  return `https://${SHARE_HOST[currentAppVariant()]}/tasks/${encodeURIComponent(taskId)}`;
}
