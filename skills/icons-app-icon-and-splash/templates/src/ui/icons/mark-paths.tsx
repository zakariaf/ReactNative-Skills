// src/ui/icons/mark-paths.tsx
// Paint operations of the brand mark or a picture as Skia elements: plain functions used inside a
// <Canvas> (never components, so a list of operations stays one canvas).
import { Group, Path } from '@shopify/react-native-skia';

import type { MarkOp } from './brand-mark-art';
import type { ReactNode } from 'react';

function markPath(op: MarkOp): ReactNode {
  const { key } = op;
  const path = (
    <Path
      key={key}
      path={op.d}
      color={op.color}
      style={op.style}
      strokeWidth={op.width}
      strokeCap={op.cap}
      strokeJoin="round"
    />
  );
  if (op.rotate === undefined) return path;
  return (
    <Group
      key={key}
      transform={[{ rotate: (op.rotate.deg * Math.PI) / 180 }]}
      origin={{ x: op.rotate.cx, y: op.rotate.cy }}
    >
      {path}
    </Group>
  );
}

/** Every operation in draw order, keyed by its stable MarkOp key. */
export function markPaths(ops: readonly MarkOp[]): ReactNode[] {
  return ops.map((op) => markPath(op));
}
