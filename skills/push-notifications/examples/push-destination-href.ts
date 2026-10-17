// src/services/push/push-destination-href.ts
// The app's route for each push destination: the only place where a notification meets a route
// name. Typed routes (experiments.typedRoutes) make a renamed screen a type error here instead of a
// tap that opens the not-found screen.
import type { PushDestination } from '@/core/push/push-destination';
import type { Href } from 'expo-router';

export function hrefForPushDestination(destination: PushDestination): Href {
  switch (destination.screen) {
    case 'task':
      return { pathname: '/(app)/tasks/[taskId]', params: { taskId: destination.taskId } };
    case 'list':
      return { pathname: '/(app)/lists/[listId]', params: { listId: destination.listId } };
    case 'inbox':
      return '/(app)/inbox';
  }
}
