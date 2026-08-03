# Node/TypeScript CLI layer only (extract/ingest/ingest-phases/
# ingest-pose3d-frames/process-upload-queue/reconcile-uploads/analyze/
# provision-coach - see package.json's "scripts"). Does NOT contain the
# separate Python pose3d pipeline (scripts/pose3d/, GPU-dependent YOLO11-pose
# + VideoPose3D) - that stays a local/CPU-or-GPU tool run directly on the
# host, not containerized here. A real Cloud Run deployment of the pipeline
# itself needs its own, separate container - this image alone does not
# replace "processing requires your local machine" (see NEXT_STEPS.md).
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
#
# No meaningful default command - every real invocation passes an explicit
# script (see README.md's GCP deployment section: `gcloud run jobs execute
# ... --args="analyze,--team,..."`). The previous default, src/cli/generate.ts,
# was deleted along with the legacy static-HTML report system it served -
# defaulting to --help on a real, still-existing CLI instead of silently
# pointing at a file that no longer exists.
ENTRYPOINT ["npx", "tsx"]
CMD ["src/cli/analyze.ts", "--help"]
