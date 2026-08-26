import type { Readable } from 'node:stream';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** What a caller knows about an object once it is stored. */
export interface StoredFile {
  /** Object key inside the bucket, e.g. `rider-documents/<uuid>.jpg`. */
  key: string;
  size: number;
  mimeType: string;
}

export interface StoredFileStream {
  stream: Readable;
  size: number;
  mimeType: string;
  /** The original client-side filename, when the object carries one. */
  fileName: string | null;
}

/**
 * The port every file store implements.
 *
 * Keeps the S3/MinIO SDK behind one boundary: use cases talk in keys and
 * streams, so moving to a different provider is a new adapter, not a change to
 * any feature that stores files.
 */
export interface FileStoragePort {
  /** Whether credentials are present. False means every call below will throw. */
  isConfigured(): boolean;

  put(input: {
    key: string;
    body: Buffer;
    mimeType: string;
    /** Kept as object metadata so a download can restore the original name. */
    fileName?: string;
  }): Promise<StoredFile>;

  get(key: string): Promise<StoredFileStream>;

  remove(key: string): Promise<void>;
}
