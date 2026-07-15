/**
 * lib/ingest/embed.ts
 *
 * OpenAI text-embedding-3-large (3072 dimensions — matches vector(3072) in
 * the chunks table). Batches of 96 inputs per request, exponential backoff
 * with jitter on 429/5xx. Implemented against the raw REST endpoint so the
 * retry policy is fully ours.
 */

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIMENSIONS = 3072;
export const EMBED_BATCH_SIZE = 96;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MAX_RETRIES = 6;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

interface OpenAiEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

function requireKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Embedding cannot run without it — " +
        "refusing to continue (chunks must never be stored with missing " +
        "embeddings silently).",
    );
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(
  inputs: string[],
  apiKey: string,
): Promise<number[][]> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
    });

    if (res.ok) {
      const body = (await res.json()) as OpenAiEmbeddingResponse;
      // The API may return out of order; index is authoritative.
      const ordered: number[][] = new Array(inputs.length);
      for (const item of body.data) {
        ordered[item.index] = item.embedding;
      }
      for (let i = 0; i < ordered.length; i++) {
        const vec = ordered[i];
        if (!vec || vec.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding response missing/malformed vector at index ${i} ` +
              `(expected ${EMBEDDING_DIMENSIONS} dims).`,
          );
        }
      }
      return ordered;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(
        `OpenAI embeddings request failed (${res.status}) after ` +
          `${attempt} retries: ${await res.text()}`,
      );
    }

    // Exponential backoff with full jitter; honor Retry-After when present.
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : NaN;
    const expDelay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    const delay = Number.isFinite(retryAfterMs)
      ? Math.min(retryAfterMs, MAX_DELAY_MS)
      : Math.random() * expDelay;
    attempt += 1;
    await sleep(delay);
  }
}

/**
 * Embed texts in order. Returns one 3072-dim vector per input, same order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = requireKey();

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(batch, apiKey);
    out.push(...vectors);
  }
  return out;
}

/** Embed a single query string (retrieval path). */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error("Embedding API returned no vector for query.");
  return vec;
}

/** pgvector literal serialization: '[0.1,0.2,...]'. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
