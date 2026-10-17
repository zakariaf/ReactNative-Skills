// Pure: integer minor units in, text out.
export function formatPrice(minorUnits: number): string {
  return `${String(Math.floor(minorUnits / 100))}.${String(minorUnits % 100).padStart(2, '0')}`;
}
