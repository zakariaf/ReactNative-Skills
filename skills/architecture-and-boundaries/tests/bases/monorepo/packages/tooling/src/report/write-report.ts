import { writeFileSync } from 'node:fs';

import { formatPrice } from '@acme/core/money/format-price';

export function writeReport(path: string, minorUnits: number): void {
  writeFileSync(path, formatPrice(minorUnits));
}
