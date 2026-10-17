// src/app/__DETAIL_ROUTE_ID__.tsx
// A dynamic route, thin like every route file: it never reads the URL params itself. The model hook
// reads and parses them (any link can open this route with any text), and the view shows the
// invalid-link state when they do not parse. Its route test is
// src/features/__DETAIL__/__DETAIL__-navigation.test.tsx.
import { Stack } from 'expo-router';

import { __DETAIL_PASCAL__Screen } from '@/features/__DETAIL__/__DETAIL__-screen';
import { use__DETAIL_PASCAL__Model } from '@/features/__DETAIL__/use-__DETAIL__-model';

export default function __DETAIL_PASCAL__Route(): React.JSX.Element {
  const model = use__DETAIL_PASCAL__Model();
  return (
    <>
      <Stack.Screen options={{ title: model.title }} />
      <__DETAIL_PASCAL__Screen model={model} />
    </>
  );
}
