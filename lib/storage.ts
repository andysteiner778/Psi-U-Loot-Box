import 'server-only';
import { db } from './supabase/server';

/**
 * Item photo storage.
 *
 * Uploads run server-side with the service role, so the browser never holds a
 * storage credential and no anon write policy exists. Reads are public — these
 * are photos of a desk, and a signed URL per card would add a round trip to
 * every frame of the reel.
 */

export const ITEM_BUCKET = 'item-images';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Store one photo and return its public URL, ready to drop into
 * `items.image_url`.
 *
 * `slug` only shapes the filename for human browsability of the bucket; a
 * random suffix keeps two items called "Monitor" from colliding, and means an
 * admin re-scanning an item never overwrites the old photo mid-reel.
 */
export async function uploadItemImage(
  bytes: ArrayBuffer,
  contentType: string,
  slug = 'item'
): Promise<string> {
  if (!ALLOWED.has(contentType)) {
    throw new UploadError('Unsupported image type: ' + contentType);
  }
  if (bytes.byteLength === 0) throw new UploadError('Empty file');
  if (bytes.byteLength > MAX_BYTES) {
    throw new UploadError(
      'Image is ' + (bytes.byteLength / 1048576).toFixed(1) + 'MB; the limit is 5MB. ' +
        'Downscale it in the browser before uploading.',
      413
    );
  }

  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  const path = safe + '-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 8) + '.' + (EXT[contentType] ?? 'jpg');

  const { error } = await db.storage
    .from(ITEM_BUCKET)
    .upload(path, bytes, { contentType, cacheControl: '31536000', upsert: false });

  if (error) {
    // The most common cause by far is migration 0005 never having been applied.
    if (/bucket/i.test(error.message)) {
      throw new UploadError(
        'The "' + ITEM_BUCKET + '" bucket does not exist. Apply migration 0005_storage.sql.',
        503
      );
    }
    throw new UploadError('Upload failed: ' + error.message, 502);
  }

  const { data } = db.storage.from(ITEM_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Best-effort cleanup. Never throws: a stale image is not worth failing a request over. */
export async function deleteItemImage(publicUrl: string | null): Promise<void> {
  if (!publicUrl) return;
  const marker = '/' + ITEM_BUCKET + '/';
  const i = publicUrl.indexOf(marker);
  if (i === -1) return;
  const path = publicUrl.slice(i + marker.length).split('?')[0];
  if (path) await db.storage.from(ITEM_BUCKET).remove([path]).catch(() => {});
}
