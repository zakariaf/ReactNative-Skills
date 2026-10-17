// src/i18n/use-t.ts
export function useT(): (key: string) => string {
  return (key) => key;
}
