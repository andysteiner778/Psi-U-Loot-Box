import { adminOrError } from '@/app/admin/_lib/guard';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { scanItem, visionStatus, NoVisionProviderError, VisionInputError } from '@/lib/vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/vision/scan-item -> VisionStatus
 * POST /api/vision/scan-item   { image: string (base64/data-url), mediaType?: string } -> ScanResult
 *
 * Security: Guarded strictly by requireAdmin().
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  return jsonOk(visionStatus());
}

export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<{ image?: string; mediaType?: string }>(req);
  if (!body?.image) {
    return jsonErr(400, 'Missing image payload (base64 string or data URL expected)');
  }

  const mediaType = body.mediaType || (body.image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg');

  try {
    const result = await scanItem(body.image, mediaType);
    return jsonOk(result);
  } catch (err: any) {
    if (err instanceof NoVisionProviderError) {
      return jsonErr(
        503,
        'No AI Vision API key configured (neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is available). You can still add items manually.',
        'NO_VISION_KEY'
      );
    }
    if (err instanceof VisionInputError) {
      return jsonErr(400, err.message, 'BAD_INPUT');
    }
    return jsonErr(500, err?.message || 'Vision scanning failed', 'VISION_ERROR');
  }
}
