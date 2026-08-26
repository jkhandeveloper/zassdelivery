import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { storageConfig } from '@/config';

import { DownloadFileUseCase, UploadFileUseCase } from './application/use-cases/upload.use-cases';
import { FILE_STORAGE } from './domain/file-storage.port';
import { MinioFileStorageAdapter } from './infrastructure/minio-file-storage.adapter';
import { UploadsController } from './uploads.controller';

/**
 * Storage of user-supplied files, and the two routes that put files in and take
 * them out again.
 *
 * The port is exported so other feature modules can store files without
 * touching the storage SDK or the HTTP layer.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) => ({
        // Files go straight to the bucket, so they never need to touch the
        // container's disk — which is ephemeral, and shared with nothing.
        storage: memoryStorage(),
        limits: { fileSize: config.maxFileSizeBytes, files: 1, fields: 4 },
      }),
    }),
  ],
  controllers: [UploadsController],
  providers: [
    { provide: FILE_STORAGE, useClass: MinioFileStorageAdapter },
    UploadFileUseCase,
    DownloadFileUseCase,
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
