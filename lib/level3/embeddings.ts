/**
 * Level 3C — embeddings, behind a function rather than an import.
 *
 * `makeVectorRetriever` takes an embedder as an argument precisely so that the
 * retriever does not know which vendor produced its numbers. This is the
 * default implementation, and swapping it is a one-line change at the call
 * site rather than a change to retrieval.
 *
 * It fails **soft**: a missing key or a provider error returns `null`, the
 * vector retriever returns nothing, and the other sources still answer.
 * *"The student classroom must continue functioning even if ... KG service is
 * unavailable"* — the same reasoning applies to every optional service here.
 */

/** Matches the `vector(1536)` column in `knowledge_chunks`. */
export const EMBEDDING_DIMENSIONS = 1536;
/**
 * `??` is the wrong operator for environment variables, and this cost a
 * debugging round: `OPENAI_BASE_URL=""` in `.env.local` is an empty string,
 * not undefined, so `?? 'https://api.openai.com/v1'` kept the empty string and
 * the request went to the relative URL `/embeddings`, which is not a URL at
 * all. An empty variable means "not configured" and is treated as absent.
 */
function fromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export const EMBEDDING_MODEL = fromEnv('EMBEDDING_MODEL', 'text-embedding-3-small');

export async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text.trim()) return null;
  const base = fromEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) }),
    });
    if (!res.ok) {
      console.error('[level3c] embedding failed', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = data.data?.[0]?.embedding;
    return Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS ? vector : null;
  } catch (error) {
    console.error('[level3c] embedding threw', error);
    return null;
  }
}

/** Embed many, in order, skipping what fails. Used when ingesting a resource. */
export async function embedMany(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}
