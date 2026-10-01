import type { APIRoute } from 'astro';
import { runUpdateSchema } from '../../../../../lib/encode-progress';
import { updateRun } from '../../../../../lib/encodes';
import { json, parseBody } from '../../_json';

/** Finish a batch (`status`, counts), or with `{}` just record a heartbeat. */
export const PATCH: APIRoute = async ({ params, request }) => {
  const body = await parseBody(request, runUpdateSchema);
  if (body.error) return body.error;
  const run = updateRun(Number(params.runId), body.data);
  return run ? json(run) : json({ error: 'no such run' }, 404);
};
