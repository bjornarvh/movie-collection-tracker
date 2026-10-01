import type { APIRoute } from 'astro';
import { runState } from '../../../../lib/encode-progress';
import { latestRun } from '../../../../lib/encodes';
import { json } from '../_json';

/** The newest batch and its jobs, with `state` telling a live run from a stalled one. */
export const GET: APIRoute = () => {
  const run = latestRun();
  return json(run ? { ...run, state: runState(run) } : null);
};
