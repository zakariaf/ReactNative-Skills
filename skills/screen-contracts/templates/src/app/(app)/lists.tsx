// src/app/(app)/lists.tsx
// device-only: covered by opening the Lists route on a device (it only joins the tested model hook and view)
// The Lists route: thin, as every route file. It calls the screen's model hook, hands the title to the
// Stack header and the model to the pure view (contracts/screens.json, screen "lists").
import { Stack } from 'expo-router';

import { ListsScreen } from '@/features/lists/lists-screen';
import { useListsModel } from '@/features/lists/use-lists-model';

export default function ListsRoute(): React.JSX.Element {
  const model = useListsModel();
  return (
    <>
      <Stack.Screen options={{ title: model.title }} />
      <ListsScreen model={model} />
    </>
  );
}
