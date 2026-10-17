// src/features/root-navigator/react-navigation.d.ts (React Navigation static API): types
// useNavigation(), navigate(), popTo() and <Link> everywhere from the static config. `interface` is
// needed for declaration merging (the lint config allows it in *.d.ts only).
import type { rootStack } from './root-stack';
import type { StaticParamList } from '@react-navigation/native';

type RootStackParamList = StaticParamList<typeof rootStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
