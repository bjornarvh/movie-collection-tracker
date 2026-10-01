import type { APIRoute } from 'astro';
import { jobUpdateSchema } from '../../../../../../lib/encode-progress';
import { updateJob } from '../../../../../../lib/encodes';
import { json, parseBody } from '../../../_json';

/** Status or progress of one job: only the fields sent are changed. */
export const PATCH: APIRoute = async ({ params, request }) => {
  const body = await parseBody(request, jobUpdateSchema);
  if (body.error) return body.error;
  const job = updateJob(Number(params.runId), Number(params.jobId), body.data);
  return job ? json(job) : json({ error: 'no such job in this run' }, 404);
};
