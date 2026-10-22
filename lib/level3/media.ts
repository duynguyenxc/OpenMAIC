/**
 * Level 3D — handwriting and audio, as processing services.
 *
 * *"Do NOT implement every modality inside the OpenMAIC core. Use processing
 * services."* So each modality is a `ResponseProcessor`: bytes in, normalized
 * text out, with the metadata that says how it got there. Nothing in the
 * classroom renderer changes, and a modality that fails degrades to a response
 * whose text is empty and whose original is still on disk.
 *
 * The rule that governs all of it:
 *
 *   *"Always preserve: original response, processed/transcribed response,
 *    processing metadata. Do not discard original student input."*
 *
 * A transcription is a derived artefact. Throw the recording away and a
 * disputed transcription cannot be checked, and a research claim about what a
 * student said rests on nothing. So `response_media` keeps the bytes, the
 * response keeps the text, and `processing_metadata` keeps the provenance of
 * the conversion — which model, which provider, when, and whether it worked.
 */
import { callLLM } from '@/lib/ai/llm';

export type MediaKind = 'HANDWRITTEN_IMAGE' | 'AUDIO_RESPONSE';

export interface ProcessingResult {
  /** What the assessment pipeline will see. Empty when extraction failed. */
  text: string;
  ok: boolean;
  metadata: Record<string, unknown>;
}

export interface ResponseProcessor {
  readonly kind: MediaKind;
  process(input: {
    bytes: Buffer;
    contentType: string;
    model?: unknown;
    modelString?: string;
    serverManaged?: boolean;
  }): Promise<ProcessingResult>;
}

export const HANDWRITING_PROMPT_VERSION = 'handwriting-v1';

/**
 * Handwriting and scanned pages, through a vision model.
 *
 * Deliberately **not** OCR-with-cleanup: the model is told to transcribe what
 * is on the page and to mark what it cannot read rather than to guess. A
 * guessed word in a student's answer becomes evidence in a dataset, and an
 * illegible one marked `[illegible]` is worth more than a confident
 * invention.
 */
export const HandwritingProcessor: ResponseProcessor = {
  kind: 'HANDWRITTEN_IMAGE',
  async process(input) {
    const started = Date.now();
    const dataUri = `data:${input.contentType};base64,${input.bytes.toString('base64')}`;
    try {
      const result = await callLLM(
        {
          model: input.model as never,
          messages: [
            {
              role: 'system',
              content:
                'You transcribe handwritten or scanned student work. Reproduce exactly what is ' +
                'written, including mistakes. Do not correct, summarise or complete anything. ' +
                'Where a word is genuinely unreadable write [illegible]. Reply with the ' +
                'transcription alone and nothing else.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Transcribe this page.' },
                { type: 'image', image: dataUri },
              ],
            },
          ],
        } as never,
        'level3-handwriting',
        undefined,
        undefined,
        { serverManaged: input.serverManaged },
      );
      const text = String(result.text ?? '').trim();
      return {
        text,
        ok: Boolean(text),
        metadata: {
          source: 'handwriting',
          provider: 'vision-model',
          model: input.modelString ?? null,
          promptVersion: HANDWRITING_PROMPT_VERSION,
          contentType: input.contentType,
          byteSize: input.bytes.length,
          illegibleMarkers: (text.match(/\[illegible\]/gi) ?? []).length,
          durationMs: Date.now() - started,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      // A failed extraction is recorded, not thrown away: the original is kept
      // and the job can be retried without the student resubmitting.
      return {
        text: '',
        ok: false,
        metadata: {
          source: 'handwriting',
          model: input.modelString ?? null,
          contentType: input.contentType,
          byteSize: input.bytes.length,
          error: error instanceof Error ? error.message : String(error),
          processedAt: new Date().toISOString(),
        },
      };
    }
  },
};

/**
 * Audio, through **OpenMAIC's own ASR layer**.
 *
 * *"Reuse OpenMAIC provider abstractions where possible."* `transcribeAudio`
 * and `getCurrentASRConfig` already exist, already handle several providers,
 * and are already how this deployment is configured. Writing a second
 * transcription path would mean a second thing to configure and a second thing
 * to be wrong.
 */
export const AudioProcessor: ResponseProcessor = {
  kind: 'AUDIO_RESPONSE',
  async process(input) {
    const started = Date.now();
    try {
      const { getCurrentASRConfig } = await import('@/lib/audio/asr-providers');
      const { transcribeAudio } = await import('@/lib/audio/asr-providers');
      const config = await getCurrentASRConfig();
      const result = await transcribeAudio(config, input.bytes);
      const text = String(result?.text ?? '').trim();
      return {
        text,
        ok: Boolean(text),
        metadata: {
          source: 'transcription',
          provider: config.providerId ?? null,
          model: config.modelId ?? null,
          contentType: input.contentType,
          byteSize: input.bytes.length,
          durationMs: Date.now() - started,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        text: '',
        ok: false,
        metadata: {
          source: 'transcription',
          contentType: input.contentType,
          byteSize: input.bytes.length,
          error: error instanceof Error ? error.message : String(error),
          processedAt: new Date().toISOString(),
        },
      };
    }
  },
};

export function processorFor(kind: MediaKind): ResponseProcessor {
  return kind === 'AUDIO_RESPONSE' ? AudioProcessor : HandwritingProcessor;
}

/** What the platform will accept, and what it will not pretend to read. */
export const ACCEPTED: Record<MediaKind, string[]> = {
  HANDWRITTEN_IMAGE: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
  AUDIO_RESPONSE: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/m4a'],
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
