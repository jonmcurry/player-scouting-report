# Node/TypeScript CLI layer only (extract/generate/ingest/migrate/analyze).
# Does NOT contain the separate Python pose3d pipeline (scripts/pose3d/) - that
# stays a local/CPU-or-GPU tool run directly on the host, not containerized here.
FROM node:22-bookworm-slim

# ffmpeg for src/cli/extract.ts (fluent-ffmpeg shells out to the system ffmpeg binary,
# same as the existing extract_frames.ps1 assumes ffmpeg is already on PATH).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

# Runs via tsx directly (no separate build step needed for a CLI image) - keeps the
# Dockerfile simple; `npm run build` + running compiled dist/ is available for anyone
# who wants a smaller production image later, but isn't required for local/Cloud Run use.
ENTRYPOINT ["npx", "tsx"]
CMD ["src/cli/generate.ts", "--help"]
