#!/bin/sh
# Container entrypoint. Hosted platforms (Railway, Render, Fly) allow ONE persistent volume per
# service; set STORAGE_DIR to its mount point and both projects/ and data/ live inside it.
set -e
if [ -n "$STORAGE_DIR" ]; then
  mkdir -p "$STORAGE_DIR/projects" "$STORAGE_DIR/data"
  for d in projects data; do
    # First boot with an empty volume: carry over whatever the image shipped with.
    if [ -d "/app/$d" ] && [ ! -L "/app/$d" ]; then
      cp -Rn "/app/$d/." "$STORAGE_DIR/$d/" 2>/dev/null || true
      rm -rf "/app/$d"
    fi
    ln -sfn "$STORAGE_DIR/$d" "/app/$d"
  done
  echo "[entrypoint] projects/ and data/ → $STORAGE_DIR"
fi
exec node scripts/start.mjs
