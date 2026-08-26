import { registerAs } from '@nestjs/config';

export const STORAGE_CONFIG_KEY = 'storage';

/**
 * Object storage for user-supplied files — rider documents, logos, photos.
 *
 * The backend is MinIO, which speaks the S3 API, so the same settings point at
 * a managed S3 bucket in production by changing the endpoint alone. Files are
 * never written to the container filesystem: an API instance is disposable and
 * anything on its disk is lost on the next deploy.
 *
 * The bucket stays private. Objects are read back through `GET /uploads/:folder/:name`
 * rather than from the storage host directly, so the bucket never needs a
 * public policy and the storage credentials never leave the server.
 */
export const storageConfig = registerAs(STORAGE_CONFIG_KEY, () => {
  const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
  const accessKey = process.env.MINIO_ACCESS_KEY ?? '';
  const secretKey = process.env.MINIO_SECRET_KEY ?? '';
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  return {
    /** Origin the download URLs handed back to clients are built on. */
    publicBaseUrl,
    endpoint,
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? 'false').toLowerCase() === 'true',
    accessKey,
    secretKey,
    bucket: process.env.MINIO_BUCKET ?? 'zassdelivery',
    region: process.env.MINIO_REGION ?? 'us-east-1',

    /**
     * Uploads are rejected with a clear message when this is false, rather than
     * failing at the point of upload — the same treatment unconfigured payment
     * gateways get, so a developer without MinIO running still gets a working API.
     */
    configured: accessKey !== '' && secretKey !== '',

    /** Ceiling on a single file, in bytes. Multer rejects anything larger. */
    maxFileSizeBytes: Number(process.env.UPLOAD_MAX_FILE_SIZE_MB ?? 10) * 1024 * 1024,
  };
});
