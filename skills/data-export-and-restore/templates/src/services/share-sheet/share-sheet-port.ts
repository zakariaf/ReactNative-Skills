// src/services/share-sheet/share-sheet-port.ts: handing one local file to the system share sheet, and nothing else.
import type { Result } from '@/core/result';

/** The pressed control's frame in window coordinates: the iPad popover points at it. */
export type ShareAnchor = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ShareRequest = {
  /** A file:// URI of a published export (ExportFilesPort.write). */
  readonly uri: string;
  /** Android: the intent's MIME type ('application/json', 'text/csv'). */
  readonly mimeType: string;
  /** iOS: the Uniform Type Identifier ('public.json', 'public.comma-separated-values-text'). */
  readonly uti: string;
  /** Android: the chooser's title (a translated string, never a literal). */
  readonly dialogTitle: string;
  /** iPad: where the popover points; null for a phone layout. */
  readonly anchor: ShareAnchor | null;
};

export type ShareFailure =
  /** The platform has no share sheet (web without the Web Share API). */
  { readonly kind: 'unavailable' } | { readonly kind: 'share-failed' };

/**
 * Adapter: expo-sharing-share-sheet-adapter.ts. Fake: fake-share-sheet.ts. Called only from a
 * user's press. The value is 'sheet-closed': the sheet was shown and closed. expo-sharing does not
 * say whether the user sent the file anywhere, so the screen never says "Backup saved" on it.
 */
export type ShareSheetPort = {
  readonly shareFile: (request: ShareRequest) => Promise<Result<'sheet-closed', ShareFailure>>;
};
