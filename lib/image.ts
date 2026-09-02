'use client';

/**
 * Client-side image downscaling.
 *
 * A modern phone camera produces 3-12MB JPEGs. Thirty people are sharing one
 * house wifi connection, and the admin is scanning items one-handed while
 * walking around — uploading full-resolution originals would be slow enough to
 * make the scanner feel broken. Downscaling to ~1024px costs a few milliseconds
 * on-device and typically cuts the payload by 90%+.
 *
 * Also strips EXIF as a side effect of the canvas round-trip, which removes GPS
 * coordinates from photos taken inside someone's house.
 */

export interface DownscaleOptions {
  /** Longest edge, in pixels. */
  maxEdge?: number;
  /** JPEG/WebP quality, 0-1. */
  quality?: number;
  type?: 'image/jpeg' | 'image/webp';
}

export async function downscaleImage(
  file: File,
  { maxEdge = 1024, quality = 0.82, type = 'image/jpeg' }: DownscaleOptions = {}
): Promise<File> {
  // Not an image, or a format canvas cannot decode — hand it back untouched and
  // let the server's type check reject it with a real message.
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    // Already small enough: re-encoding would only lose quality.
    if (scale >= 1 && file.size < 1_000_000) return file;

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
    if (!blob || blob.size >= file.size) return file; // no win, keep the original

    const ext = type === 'image/webp' ? 'webp' : 'jpg';
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], base + '.' + ext, { type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

/** Upload a photo and get back the public URL to store in `items.image_url`. */
export async function uploadItemPhoto(file: File, itemName?: string): Promise<string> {
  const small = await downscaleImage(file);
  const body = new FormData();
  body.append('file', small);
  if (itemName) body.append('name', itemName);

  const res = await fetch('/api/admin/items/upload', { method: 'POST', body });

  // The route replies in the app's standard envelope, `{ ok, data: { url } }`.
  // Reading `json.url` off the top level found `undefined` on a perfectly
  // successful upload and threw "Upload failed (200)" -- a 200 with an error
  // message, which is exactly the sort of contradiction that sends you looking
  // at storage permissions instead of at the client. Accept either shape.
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string; url?: string; data?: { url?: string } }
    | null;

  const url = json?.data?.url ?? json?.url;

  if (!res.ok || json?.ok === false || !url) {
    throw new Error(json?.error ?? 'Upload failed (HTTP ' + res.status + ')');
  }
  return url;
}
