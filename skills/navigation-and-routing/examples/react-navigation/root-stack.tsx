// src/features/root-navigator/root-stack.tsx (React Navigation 7 static API; an Expo Router app has
// none of this: its routes are files). The one static config: flows are groups whose `if` hook reads a
// store selector, so a dispatch changes the flow and the first group that renders gives the first
// screen. The variable is camelCase (a value, not a component).
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ComposeScreen } from '@/features/compose/compose-screen';
import { HomeScreen } from '@/features/home/home-screen';
import { TaskDetailScreen } from '@/features/task-detail/task-detail-screen';
import { TaskEditorScreen } from '@/features/task-editor/task-editor-screen';
import { WelcomeScreen } from '@/features/welcome/welcome-screen';

import { DebugRoute } from './debug-route';
import { useIsOnboarded, useIsOnboarding, useIsTestBuild } from './route-guards';

export const rootStack = createNativeStackNavigator({
  groups: {
    Onboarding: {
      if: useIsOnboarding,
      screens: { Welcome: WelcomeScreen },
    },
    Main: {
      if: useIsOnboarded,
      screens: {
        Home: HomeScreen,
        TaskDetail: TaskDetailScreen,
        // The editor keeps the iOS swipe: its model's usePreventRemove makes the swipe ask first.
        // gestureEnabled: false (with "gesture": "off" in the contract) is only for a screen where a
        // half-started swipe already harms, such as a canvas that reads horizontal pans.
        TaskEditor: TaskEditorScreen,
        Compose: { screen: ComposeScreen, options: { presentation: 'modal' } },
      },
    },
    Debug: {
      if: useIsTestBuild,
      screens: { Debug: DebugRoute },
    },
  },
});
