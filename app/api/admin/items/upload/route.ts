import { adminOrError } from '@/app/admin/_lib/guard';
import { jsonErr, jsonOk } from '@/app/admin/_lib/http';
import { UploadError, uploadItemImage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/items/upload   (multipart: file, name?) -> { url }
 *
 * Admin-gated: unguarded this is free image hosting on the house's Supabase
 * quota. The returned URL goes straight into `items.image_url`.
 */
export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonErr(400, 'Expected multipart/form-data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonErr(400, 'Missing file field');

  const slug = String(form.get('name') ?? 'item');

  try {
    const url = await uploadItemImage(await file.arrayBuffer(), file.type, slug);
    return jsonOk({ url });
  } catch (err) {
    if (err instanceof UploadError) return jsonErr(err.status, err.message);
    return jsonErr(500, err instanceof Error ? err.message : 'Upload failed');
  }
}
