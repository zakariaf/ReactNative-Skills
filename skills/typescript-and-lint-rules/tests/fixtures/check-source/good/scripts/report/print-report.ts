// scripts/report/print-report.ts: Node code may log and may use "../" (Node reads no aliases).
import { formatLine } from '../format/format-line.ts';

/** Prints one line per finding. */
export function printReport(findings: readonly (readonly [string, string])[]): void {
  for (const [file, message] of findings) {
    console.log(formatLine(file, message));
  }
}
