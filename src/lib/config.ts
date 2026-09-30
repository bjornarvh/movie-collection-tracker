import { existsSync } from 'node:fs';
import path from 'node:path';

// Runtime configuration comes from process.env (compose `env_file` in production).
// In development, load .env ourselves: Vite only exposes it via import.meta.env,
// which is inlined at build time and therefore unsuitable for secrets.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // ignore malformed .env; missing values fall back to defaults below
  }
}

const env = (name: string, fallback = '') => (process.env[name] ?? fallback).trim();
const list = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const dataDir = path.resolve(env('DATA_DIR', './data'));

export const config = {
  dataDir,
  databasePath: env('DATABASE_PATH') || path.join(dataDir, 'tracker.db'),
  migrationsDir: path.resolve(env('MIGRATIONS_DIR', './drizzle')),

  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD'),

  tmdbApiKey: env('TMDB_API_KEY'),
  tmdbLanguage: env('TMDB_LANGUAGE', 'en-US'),

  plexUrl: env('PLEX_URL', 'http://host.docker.internal:32400').replace(/\/+$/, ''),
  plexToken: env('PLEX_TOKEN'),
  /** Plex library section titles or keys to scan; empty = every movie section. */
  plexSections: list(env('PLEX_SECTIONS')),

  /** Where the media share is mounted inside this container (for reading .nfo files). Empty disables. */
  mediaRoot: env('MEDIA_ROOT', '/media'),
  /**
   * Prefixes stripped from absolute paths to get a library-relative path, so the
   * same file reported by Plex (/media/Movies/...) and by media-pipeline
   * (M:\Movies\...) ends up with the same `rel_path`.
   */
  pathPrefixes: list(env('PATH_PREFIXES', '/media/,/mnt/user/media/,/data/,M:/')),

  /** Cron expression for the Plex rescan; empty disables scheduling. */
  scanCron: env('SCAN_CRON', '30 4 * * *'),
};
