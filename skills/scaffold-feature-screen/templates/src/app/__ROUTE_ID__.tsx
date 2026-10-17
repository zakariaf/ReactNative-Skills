// src/app/__ROUTE_ID__.tsx
// A route file is thin: it calls the feature's model hook, hands the translated title to the Stack
// header and the model to the pure view. Nothing else lives here (Expo Router bundles every file in
// src/app as a route). Its route test is src/features/__FEATURE__/__FEATURE__-navigation.test.tsx.
import { Stack } from 'expo-router';

import { __FEATURE_PASCAL__Screen } from '@/features/__FEATURE__/__FEATURE__-screen';
import { use__FEATURE_PASCAL__Model } from '@/features/__FEATURE__/use-__FEATURE__-model';

export default function __FEATURE_PASCAL__Route(): React.JSX.Element {
  const model = use__FEATURE_PASCAL__Model();
  return (
    <>
      <Stack.Screen options={{ title: model.title }} />
      <__FEATURE_PASCAL__Screen model={model} />
    </>
  );
}
