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
RUN apk add --no-cache tini sqlite
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
# Unraid's nobody:users, so files in appdata are owned like the other containers'.
RUN mkdir -p /data && chown 99:100 /data
USER 99:100
EXPOSE 4321
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4321/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "umask 002 && exec node ./dist/server/entry.mjs"]
