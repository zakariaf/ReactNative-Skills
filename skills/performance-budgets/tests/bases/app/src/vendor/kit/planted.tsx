// src/vendor/kit/planted.tsx: a vendored skill folder; its planted findings stay silent.
import { Canvas } from '@shopify/react-native-skia';
export const run = () => eval('1');
export const Row = ({ items }: { items: string[] }) => items.map((item) => <Canvas key={item} />);
