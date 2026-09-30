#!/bin/sh
# Start as root only long enough to make /data writable for PUID:PGID
# (Unraid's nobody:users by default), then run the app as that user.
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"
umask "${UMASK:-002}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # A bind-mounted folder Docker created for us is root-owned; fix it once.
  if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ]; then
    echo "[entrypoint] chown $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
