import type { APIRoute } from 'astro';
import { ingest, IngestError, ingestSchema } from '../../../lib/ingest';
import { json } from './_json';

/** Register a rip/encode from media-pipeline. Idempotent per file path. */
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid request', issues: parsed.error.issues }, 400);
  try {
    return json(await ingest(parsed.data));
  } catch (e) {
    const status = e instanceof IngestError ? 400 : 502;
    return json({ error: (e as Error).message }, status);
  }
};
