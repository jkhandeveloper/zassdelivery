import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';

import type { appConfig, storageConfig } from '@/config';

import type { FileStoragePort } from '../../domain/file-storage.port';
import { UploadFolder } from '../../domain/upload.constants';
import { DownloadFileUseCase, UploadFileUseCase, type IncomingFile } from './upload.use-cases';

const STORAGE = {
  publicBaseUrl: 'https://api.zassdelivery.pk',
  endpoint: 'minio',
  port: 9000,
  useSSL: false,
  accessKey: 'key',
  secretKey: 'secret',
  bucket: 'zassdelivery',
  region: 'us-east-1',
  configured: true,
  maxFileSizeBytes: 10 * 1024 * 1024,
} as ConfigType<typeof storageConfig>;

const APP = { apiPrefix: 'api', apiVersion: '1' } as ConfigType<typeof appConfig>;

function file(overrides: Partial<IncomingFile> = {}): IncomingFile {
  const buffer = Buffer.from('a photo of a CNIC');

  return {
    originalname: 'cnic-front.jpg',
    mimetype: 'image/jpeg',
    size: buffer.length,
    buffer,
    ...overrides,
  };
}

function storage(): jest.Mocked<FileStoragePort> {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    put: jest
      .fn()
      .mockImplementation(
        ({ key, body, mimeType }: { key: string; body: Buffer; mimeType: string }) =>
          Promise.resolve({ key, size: body.length, mimeType }),
      ),
    get: jest.fn(),
    remove: jest.fn(),
  };
}

describe('UploadFileUseCase', () => {
  let store: jest.Mocked<FileStoragePort>;
  let useCase: UploadFileUseCase;

  beforeEach(() => {
    store = storage();
    useCase = new UploadFileUseCase(store, STORAGE, APP);
  });

  it('files the object under the folder with a fresh random name', async () => {
    const result = await useCase.execute({ folder: UploadFolder.RiderDocuments, file: file() });

    expect(result.key).toMatch(
      /^rider-documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    );
    expect(result.url).toBe(`https://api.zassdelivery.pk/api/v1/uploads/${result.key}`);
  });

  it("never stores under the client's own filename", async () => {
    await useCase.execute({
      folder: UploadFolder.RiderDocuments,
      file: file({ originalname: '../../etc/passwd' }),
    });

    const [{ key, fileName }] = store.put.mock.calls[0] as [{ key: string; fileName: string }];

    expect(key).not.toContain('..');
    // Kept as metadata, so a download can still offer the original name back.
    expect(fileName).toBe('../../etc/passwd');
  });

  it('accepts a media type that carries parameters', async () => {
    const result = await useCase.execute({
      folder: UploadFolder.Avatars,
      file: file({ mimetype: 'image/jpeg; charset=binary' }),
    });

    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects a type that is not on the allow-list', async () => {
    await expect(
      useCase.execute({
        folder: UploadFolder.RiderDocuments,
        // An SVG is a script-bearing document served from our own origin.
        file: file({ mimetype: 'image/svg+xml', originalname: 'x.svg' }),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(store.put).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit', async () => {
    await expect(
      useCase.execute({
        folder: UploadFolder.RiderDocuments,
        file: file({ size: STORAGE.maxFileSizeBytes + 1 }),
      }),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('rejects an empty file', async () => {
    await expect(
      useCase.execute({
        folder: UploadFolder.RiderDocuments,
        file: file({ size: 0, buffer: Buffer.alloc(0) }),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('DownloadFileUseCase', () => {
  let store: jest.Mocked<FileStoragePort>;
  let useCase: DownloadFileUseCase;

  beforeEach(() => {
    store = storage();
    store.get.mockResolvedValue({
      stream: Readable.from(['x']),
      size: 1,
      mimeType: 'image/jpeg',
      fileName: 'cnic-front.jpg',
    });
    useCase = new DownloadFileUseCase(store);
  });

  const NAME = '9f1c2b4e-7a10-4d9c-bb31-5c0e3f0a12a3.jpg';

  it('reads the object back from a known folder', async () => {
    await useCase.execute({ folder: 'rider-documents', name: NAME });

    expect(store.get).toHaveBeenCalledWith(`rider-documents/${NAME}`);
  });

  it.each([
    ['an unknown folder', { folder: 'secrets', name: NAME }],
    ['a traversal in the folder', { folder: '..', name: NAME }],
    ['a traversal in the name', { folder: 'rider-documents', name: '../../etc/passwd' }],
    ['a name this module never minted', { folder: 'rider-documents', name: 'invoice.pdf' }],
  ])('refuses %s', async (_case, input) => {
    await expect(useCase.execute(input)).rejects.toThrow(NotFoundException);
    expect(store.get).not.toHaveBeenCalled();
  });
});
