// src/ui/icon-path.tsx: a .tsx module whose main export is a JSX helper keeps the camelCase name.
import { Path } from 'react-native-svg';

export function iconPath(d: string): React.JSX.Element {
  return <Path d={d} />;
}
