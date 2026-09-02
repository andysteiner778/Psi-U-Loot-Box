import 'server-only';

import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from './prompt';
import { ScanResultSchema, VisionError, type ImageMediaType, type ScanResult } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

/**
 * Claude vision backend.
 *
 * Uses `messages.parse()` with `zodOutputFormat()` so the response is
 * schema-guaranteed JSON, parsed by the SDK. There is deliberately no prose
 * scraping or hand-rolled `JSON.parse(match[1])` here — that is the failure
 * mode this API exists to remove.
 *
 * The SDK is imported dynamically so that a house running Gemini-only never
 * pays the cold-start cost of loading it.
 */
export async function scanWithClaude(
  imageBase64: string,
  mediaType: ImageMediaType,
  model: string = process.env.VISION_MODEL ?? DEFAULT_CLAUDE_MODEL
): Promise<ScanResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new VisionError('ANTHROPIC_API_KEY is not set', 'claude');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  let message;
  try {
    message = await client.messages.parse({
      model,
      max_tokens: 1024,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: VISION_USER_PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ScanResultSchema) },
    });
  } catch (err) {
    throw new VisionError('Claude vision call failed: ' + errText(err), 'claude');
  }

  if (!message.parsed_output) {
    throw new VisionError('Claude returned no parsed output for the scan schema', 'claude');
  }
  return message.parsed_output;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
