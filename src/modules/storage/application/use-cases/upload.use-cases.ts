import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { appConfig, storageConfig } from '@/config';

import {
  FILE_STORAGE,
  type FileStoragePort,
  type StoredFileStream,
} from '../../domain/file-storage.port';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  UPLOAD_EXTENSIONS,
  UPLOAD_OBJECT_NAME_PATTERN,
  UploadFolder,
} from '../../domain/upload.constants';
import type { UploadedFileDto } from '../dto/upload.dto';

/** What multer hands over, narrowed to the fields this module uses. */
export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Takes a file off a multipart request and puts it in the bucket.
 *
 * The stored name is a fresh UUID, never the client's: an original name is
 * attacker-controlled, may collide, and — since the download route serves from
 * our own origin — would be a path traversal waiting to happen. The real name
 * is kept as object metadata so a download can still offer it back.
 */
@Injectable()
export class UploadFileUseCase {
  constructor(
    @Inject(FILE_STORAGE)
    private readonly storage: FileStoragePort,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async execute(input: { folder: UploadFolder; file: IncomingFile }): Promise<UploadedFileDto> {
    const { folder, file } = input;

    if (file.size === 0) {
      throw new BadRequestException('That file is empty.');
    }

    if (file.size > this.config.maxFileSizeBytes) {
      throw new PayloadTooLargeException(
        `That file is larger than the ${Math.round(this.config.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
      );
    }

    // A browser may send `image/jpeg; charset=…`; only the type itself matters.
    const mimeType = (file.mimetype.split(';')[0] ?? '').trim().toLowerCase();

    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `${mimeType || 'That file type'} cannot be uploaded. Send a JPG, PNG, WebP, HEIC or PDF.`,
      );
    }

    const key = `${folder}/${randomUUID()}.${UPLOAD_EXTENSIONS[mimeType] ?? 'bin'}`;

    const stored = await this.storage.put({
      key,
      body: file.buffer,
      mimeType,
      fileName: file.originalname,
    });

    return {
      url: this.publicUrl(key),
      key: stored.key,
      folder,
      fileName: file.originalname === '' ? null : file.originalname,
      mimeType: stored.mimeType,
      size: stored.size,
    };
  }

  /**
   * The URL is absolute and stable, because it is stored on the record the file
   * belongs to — a rider document's `fileUrl` outlives any signed link, so
   * presigned storage URLs are not usable here.
   */
  private publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${this.app.apiPrefix}/v${this.app.apiVersion}/uploads/${key}`;
  }
}

/**
 * Reads a stored file back out.
 *
 * The key is rebuilt from the two path segments rather than taken whole, and
 * both are checked against the shapes this module mints, so no request can
 * address an object outside the known folders.
 */
@Injectable()
export class DownloadFileUseCase {
  constructor(
    @Inject(FILE_STORAGE)
    private readonly storage: FileStoragePort,
  ) {}

  async execute(input: { folder: string; name: string }): Promise<StoredFileStream> {
    const folders: readonly string[] = Object.values(UploadFolder);

    if (!folders.includes(input.folder) || !UPLOAD_OBJECT_NAME_PATTERN.test(input.name)) {
      throw new NotFoundException('That file does not exist.');
    }

    return this.storage.get(`${input.folder}/${input.name}`);
  }
}
