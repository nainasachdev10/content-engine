# Content Engine — dashboard + scheduler in one container.
# Build:  docker build -t content-engine .
# Run:    docker compose up -d   (see docker-compose.yml)
FROM node:22-bookworm-slim

# ffmpeg (Debian's build has drawtext/subtitles), fonts for captions, Chromium for the HyperFrames renderer.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/pipeline/package.json packages/pipeline/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci

# HyperFrames CLI pre-installed (a normal node_modules layout — a global install breaks its
# runtime-manifest path) so renders never depend on `npx` downloads at runtime.
RUN mkdir -p /opt/hyperframes && cd /opt/hyperframes && npm init -y >/dev/null && npm install hyperframes@0.7.87

COPY . .
RUN cd apps/dashboard && npx next build

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_BIN=/opt/hyperframes/node_modules/.bin/hyperframes \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PRODUCER_BROWSER_GPU_MODE=software \
    PRODUCER_LOW_MEMORY_MODE=1 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    PORT=3777
EXPOSE 3777

# projects/ and data/ are mounted by docker-compose, or redirected into one volume via STORAGE_DIR (see scripts/entrypoint.sh).
CMD ["sh", "scripts/entrypoint.sh"]
