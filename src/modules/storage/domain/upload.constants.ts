/**
 * The folders an upload may be filed under.
 *
 * A closed set rather than a free-text prefix: the folder arrives from the
 * client and becomes part of both the object key and the download URL, so an
 * open one would let a caller write anywhere in the bucket.
 */
export enum UploadFolder {
  RiderDocuments = 'rider-documents',
  RestaurantLogos = 'restaurant-logos',
  MenuItems = 'menu-items',
  Avatars = 'avatars',
  SupportAttachments = 'support-attachments',
}

/**
 * What may be uploaded, by media type.
 *
 * Scans and photos of documents, and PDFs for anything issued electronically.
 * SVG is deliberately absent — it is a script-bearing document, and the
 * download route serves objects from our own origin.
 */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  // iPhones hand over HEIC/HEIF unless the camera is set to "most compatible".
  'image/heic',
  'image/heif',
  'application/pdf',
];

/** The extension an object key gets, per media type. */
export const UPLOAD_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

/** Matches the `<uuid>.<ext>` object names this module mints, and nothing else. */
export const UPLOAD_OBJECT_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;
