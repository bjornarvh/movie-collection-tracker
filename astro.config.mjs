// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // CSRF is enforced in src/middleware.ts: Astro's built-in origin check compares
  // against the internal http:// URL, which doesn't match behind Caddy's TLS.
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['better-sqlite3', '@node-rs/argon2'] },
  },
});
