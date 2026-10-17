// src/services/file-transfer/file-transfer-port.ts: the app's second network transport, for file bodies only (uploads and downloads), next to the JSON ApiClient.
import type { Result } from '@/core/result';

export type TransferFailure =
  /** The device is not on a network (the ConnectivityPort says so): "Check your connection". */
  | { readonly kind: 'offline' }
  /** The server answered with a non-2xx status; `status` for the caller's mapping. */
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'cancelled' }
  /** The file to upload is gone (a stale ref, a removed photo): not a network problem. */
  | { readonly kind: 'source-missing' }
  /** On a network, yet the request did not complete (DNS, TLS, a bad URL, a dropped connection). */
  | { readonly kind: 'transfer-failed' };

export type UploadRequest = {
  /** Built by src/api (buildUrl over the EXPO_PUBLIC_API_URL base): never a literal here. */
  readonly url: string;
  /** MediaStorePort.uriOf(ref) of the stored, downscaled, metadata-free file. */
  readonly fileUri: string;
  readonly mimeType: string;
  /** The multipart field the server expects. */
  readonly fieldName: string;
  /** From the session (auth-and-secure-storage's sessionHeaders); never a token in the URL. */
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
};

export type UploadResponse = { readonly status: number; readonly body: string };

export type DownloadRequest = {
  /** Built by src/api, like an upload URL. */
  readonly url: string;
  /** A new name for the temporary (a fresh id, as for a MediaRef); never the server's file name. */
  readonly fileName: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
};

/**
 * Adapter: expo-file-system-file-transfer-adapter.ts. It is the only file that calls
 * expo-file-system's network API (check-media: transfer-outside-port). An upload's response body is
 * JSON text the caller validates with its valibot schema in src/api, as the ApiClient does. A
 * download lands in the cache as a temporary: the caller keeps it with MediaStorePort.importFile
 * under a new MediaRef (after the resizer, for an image) and then discards it.
 */
export type FileTransferPort = {
  readonly upload: (request: UploadRequest) => Promise<Result<UploadResponse, TransferFailure>>;
  /** Resolves with the temporary's file:// URI in the cache. */
  readonly download: (request: DownloadRequest) => Promise<Result<string, TransferFailure>>;
};
