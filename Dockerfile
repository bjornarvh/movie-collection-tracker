# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache tini sqlite su-exec
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/drizzle \
    MEDIA_ROOT=/media
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
# The entrypoint fixes /data ownership as root, then runs the app as PUID:PGID
# (Unraid's nobody:users by default, like the linuxserver images).
ENV PUID=99 PGID=100 UMASK=002
EXPOSE 4321
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4321/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "./dist/server/entry.mjs"]
