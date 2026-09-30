import type { APIRoute } from 'astro';
import { plexConfigured } from '../../../lib/plex/client';
import { scanInProgress, startScan } from '../../../lib/plex/scan';
import { json } from './_json';

/** Trigger a Plex rescan, e.g. after media-pipeline has moved files into the library. */
export const POST: APIRoute = () => {
  if (!plexConfigured()) return json({ error: 'Plex is not configured' }, 409);
  if (scanInProgress()) return json({ started: false, reason: 'already running' }, 202);
  void startScan('manual');
  return json({ started: true }, 202);
};
