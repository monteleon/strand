# Strand — Bun + Next.js + SQLite, single image, single SQLite file.
#
#   docker build -t strand .
#   docker run -p 3000:3000 -v "$(pwd)/data:/app/data" strand
#
# The data/ volume holds your SQLite database. Bind-mount it so your
# network survives container restarts and stays on your filesystem
# (the whole privacy posture depends on this).

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

# Install deps first so changes to source don't bust this layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the Next.js app. Source is copied AFTER deps so layer caching
# is effective during iteration.
COPY . .
RUN bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# next start binds to localhost by default — bind to all interfaces so
# the container is reachable from the host port-forward.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV STRAND_DB_PATH=/app/data/strand.db

# Copy only the artefacts the runtime needs.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# The data/ volume gets bind-mounted; the directory has to exist for
# migrate to write the SQLite file on first boot. Owned by the non-root
# `bun` user (provided by the base image) so migrate can write to it.
RUN mkdir -p /app/data && chown -R bun:bun /app
VOLUME ["/app/data"]

# Drop privileges before runtime — defence-in-depth for a local-first
# app that shouldn't need root for anything.
USER bun

EXPOSE 3000

# Migrate on every start — Drizzle's migrate() is idempotent (applies
# anything new, no-ops on already-applied migrations). Then start
# Next in production mode.
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
