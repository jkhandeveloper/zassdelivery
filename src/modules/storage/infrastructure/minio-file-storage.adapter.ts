import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  type LoggerService,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Client as MinioClient, S3Error } from 'minio';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { storageConfig } from '@/config';

import {
  type FileStoragePort,
  type StoredFile,
  type StoredFileStream,
} from '../domain/file-storage.port';

/** Object metadata key holding the name the file had on the uploader's device. */
const FILE_NAME_META = 'filename';

/**
 * MinIO — and, unchanged, any S3-compatible store.
 *
 * The bucket is created on boot if it is missing, so a fresh environment needs
 * nothing but credentials. It is left private: nothing here ever sets a public
 * read policy, because rider CNICs and licences live in it.
 */
@Injectable()
export class MinioFileStorageAdapter implements FileStoragePort, OnModuleInit {
  private readonly context = MinioFileStorageAdapter.name;
  private readonly client: MinioClient | null;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    this.client = config.configured
      ? new MinioClient({
          endPoint: config.endpoint,
          port: config.port,
          useSSL: config.useSSL,
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          region: config.region,
        })
      : null;
  }

  /**
   * Reaching the store is checked at boot, not on the first upload — but a
   * store that is down must not stop the API serving orders, so a failure here
   * is logged and the process continues.
   */
  async onModuleInit(): Promise<void> {
    if (this.client === null) {
      this.logger.warn?.(
        'MINIO_ACCESS_KEY/MINIO_SECRET_KEY are not set — file uploads are disabled.',
        this.context,
      );
      return;
    }

    try {
      const exists = await this.client.bucketExists(this.config.bucket);

      if (!exists) {
        await this.client.makeBucket(this.config.bucket, this.config.region);
        this.logger.log?.(`Created bucket "${this.config.bucket}"`, this.context);
      }

      this.logger.log?.(
        `Object storage ready at ${this.config.endpoint}:${this.config.port}/${this.config.bucket}`,
        this.context,
      );
    } catch (error) {
      this.logger.error?.(
        `Object storage unreachable at ${this.config.endpoint}:${this.config.port} — ` +
          `uploads will fail until it is back: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async put(input: {
    key: string;
    body: Buffer;
    mimeType: string;
    fileName?: string;
  }): Promise<StoredFile> {
    const client = this.require();

    try {
      await client.putObject(this.config.bucket, input.key, input.body, input.body.length, {
        'Content-Type': input.mimeType,
        // Metadata travels as an HTTP header, which is latin-1 only; the
        // download route decodes it back.
        ...(input.fileName !== undefined && {
          [FILE_NAME_META]: encodeURIComponent(input.fileName),
        }),
      });
    } catch (error) {
      this.logger.error?.(
        `Failed to store "${input.key}": ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
      throw new InternalServerErrorException('The file could not be stored. Please try again.');
    }

    return { key: input.key, size: input.body.length, mimeType: input.mimeType };
  }

  async get(key: string): Promise<StoredFileStream> {
    const client = this.require();

    try {
      const stat = await client.statObject(this.config.bucket, key);
      const stream = await client.getObject(this.config.bucket, key);
      const metadata = stat.metaData as Record<string, string | undefined>;
      const storedName = metadata[FILE_NAME_META];

      return {
        stream,
        size: stat.size,
        mimeType: metadata['content-type'] ?? 'application/octet-stream',
        fileName: storedName === undefined ? null : safeDecode(storedName),
      };
    } catch (error) {
      if (isNotFound(error)) {
        throw new NotFoundException('That file does not exist.');
      }

      this.logger.error?.(
        `Failed to read "${key}": ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
      throw new InternalServerErrorException('The file could not be read. Please try again.');
    }
  }

  async remove(key: string): Promise<void> {
    const client = this.require();

    try {
      await client.removeObject(this.config.bucket, key);
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }

      this.logger.error?.(
        `Failed to delete "${key}": ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );
      throw new InternalServerErrorException('The file could not be deleted. Please try again.');
    }
  }

  private require(): MinioClient {
    if (this.client === null) {
      throw new ServiceUnavailableException(
        'File storage is not configured on this environment. Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY.',
      );
    }

    return this.client;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3Error && ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error.code ?? '')
  );
}

/** A name stored before this encoding existed would throw on decode. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
