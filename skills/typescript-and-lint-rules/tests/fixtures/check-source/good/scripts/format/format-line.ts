// scripts/format/format-line.ts
/** One report line: the file, then the message. */
export function formatLine(file: string, message: string): string {
  return `${file}: ${message}`;
}
