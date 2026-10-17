// src/services/file-transfer/expo-file-system-file-transfer-adapter.ts: FileTransferPort over expo-file-system's File.upload and File.downloadFileAsync (devices only).
// device-only: covered by an upload and a download against the development server in the media drill; read in expo-file-system 57.0.7 types (type-checked on 2026-10-14).
// An example: networking-and-server-state lists it as the app's second transport, and privacy-and-store-declarations
// declares what it sends (Photos or Videos, App Functionality) before it ships.
import { Directory, File, Paths, UploadType } from 'expo-file-system';

import { attempt, attemptAsync, err, ok } from '@/core/result';

import type { ConnectivityPort } from '@/services/connectivity/connectivity-port';
import type {
  DownloadRequest,
  FileTransferPort,
  TransferFailure,
  UploadRequest,
} from '@/services/file-transfer/file-transfer-port';

export type FileTransferAdapterOptions = {
  /** networking-and-server-state's ConnectivityPort: only a device off the network is 'offline'. */
  readonly connectivity: Pick<ConnectivityPort, 'isOnline'>;
};

/** Downloads land here (the cache: purgeable, never backed up), then get imported or discarded. */
const DOWNLOAD_FOLDER = 'downloads';

type FailureContext = FileTransferAdapterOptions & { readonly signal: AbortSignal | undefined };

/**
 * A rejection says only that the request did not complete. Aborted is a cancel; off the network is
 * 'offline'; anything else (DNS, TLS, a bad URL, a server that closed the connection, a non-2xx
 * download) is 'transfer-failed', so the person is never told to check a connection that works.
 */
function toFailure({ signal, connectivity }: FailureContext): TransferFailure {
  if (signal?.aborted === true) return { kind: 'cancelled' };
  return connectivity.isOnline() ? { kind: 'transfer-failed' } : { kind: 'offline' };
}

async function upload(
  request: UploadRequest,
  options: FileTransferAdapterOptions,
): ReturnType<FileTransferPort['upload']> {
  const source = new File(request.fileUri);
  if (!source.exists) return err({ kind: 'source-missing' });
  const sent = await attemptAsync(
    () =>
      source.upload(request.url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: request.fieldName,
        mimeType: request.mimeType,
        headers: { ...request.headers },
        // A foreground session: the upload belongs to the screen that started it.
        sessionType: 'foreground',
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }),
    () => toFailure({ ...options, signal: request.signal }),
  );
  if (!sent.ok) return sent;
  const { status, body } = sent.value;
  return status >= 200 && status < 300 ? ok({ status, body }) : err({ kind: 'http', status });
}

/** Android streams into the destination and can leave a partial file when a download fails. */
function discard(target: File): void {
  attempt(
    () => {
      if (target.exists) target.delete();
    },
    () => undefined,
  );
}

async function download(
  request: DownloadRequest,
  options: FileTransferAdapterOptions,
): ReturnType<FileTransferPort['download']> {
  const prepared = attempt(
    () => {
      const folder = new Directory(Paths.cache, DOWNLOAD_FOLDER);
      if (!folder.exists) folder.create({ intermediates: true });
      return new File(folder, request.fileName);
    },
    (): TransferFailure => ({ kind: 'transfer-failed' }),
  );
  if (!prepared.ok) return prepared;
  const target = prepared.value;
  discard(target);
  const received = await attemptAsync(
    () =>
      File.downloadFileAsync(request.url, target, {
        headers: { ...request.headers },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }),
    () => toFailure({ ...options, signal: request.signal }),
  );
  if (received.ok) return ok(received.value.uri);
  discard(target);
  return received;
}

export function createExpoFileSystemFileTransferAdapter(
  options: FileTransferAdapterOptions,
): FileTransferPort {
  return {
    upload: (request) => upload(request, options),
    download: (request) => download(request, options),
  };
}
