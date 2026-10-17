// A planted finding inside an installed skill's templates: the scan must stay silent here.
import { Pressable } from 'react-native';

export function BadButton() {
  return <Pressable onPress={() => {}} hitSlop={10} />;
}
