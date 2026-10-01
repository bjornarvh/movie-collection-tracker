import type { APIRoute } from 'astro';
import { startRunSchema } from '../../../../lib/encode-progress';
import { recentRuns, startRun } from '../../../../lib/encodes';
import { json, parseBody } from '../_json';

/** media-pipeline starts a batch: registers the run and its queue, returns job ids in queue order. */
export const POST: APIRoute = async ({ request }) => {
  const body = await parseBody(request, startRunSchema);
  if (body.error) return body.error;
  return json(startRun(body.data), 201);
};

/** Recent batches with their jobs, newest first. */
export const GET: APIRoute = ({ url }) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  return json(recentRuns(limit));
};
