import cron from 'node-cron';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { createUser, purgeExpiredSessions } from './auth';
import { refreshStaleMovies } from './collection';
import { config } from './config';
import { plexConfigured } from './plex/client';
import { startScan } from './plex/scan';

let initialized: Promise<void> | null = null;

/** One-time startup work, triggered from the first request (migrations run on DB import). */
export const ensureInit = () => (initialized ??= init());

async function init() {
  const adminCount = db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0;
  if (adminCount === 0) {
    if (!config.adminPassword) {
      console.warn('[init] No admin user exists and ADMIN_PASSWORD is not set; nobody can log in.');
    } else {
      await createUser(config.adminUsername, config.adminPassword, 'admin');
      console.log(`[init] Created admin user "${config.adminUsername}"`);
    }
  }

  if (config.scanCron && !process.env.VITEST) {
    if (!cron.validate(config.scanCron)) {
      console.warn(`[init] SCAN_CRON "${config.scanCron}" is invalid; scheduled scans disabled`);
    } else {
      cron.schedule(config.scanCron, async () => {
        purgeExpiredSessions();
        if (plexConfigured()) await startScan('schedule');
        await refreshStaleMovies();
      });
      console.log(`[init] Plex rescan scheduled: ${config.scanCron}`);
    }
  }
}
