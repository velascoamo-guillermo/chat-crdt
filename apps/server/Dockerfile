# @chat-crdt/server — multi-stage build.
#
# Build context MUST be the monorepo root, because bun workspace resolution
# needs the root package.json + bun.lock and every workspace's package.json:
#
#   docker build -f apps/server/Dockerfile -t chat-crdt-server:local .
#   kind load docker-image chat-crdt-server:local --name chat-crdt
#
# Runtime uses plain `node`, matching package.json's `"start": "node dist/main"`
# — bun is a build-time tool only here, not a runtime dependency.

FROM oven/bun:1.2.20-alpine AS builder
WORKDIR /repo

# Manifests first for layer caching — installing deps doesn't need source.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sync-engine/package.json packages/sync-engine/package.json

RUN bun install --frozen-lockfile

# Only the source this build actually needs — apps/mobile source is
# intentionally not copied, its package.json above is enough for bun to
# resolve the workspace graph.
COPY packages/shared packages/shared
COPY packages/sync-engine packages/sync-engine
COPY apps/server apps/server

RUN bunx prisma generate --schema apps/server/prisma/schema.prisma
# `...@chat-crdt/server` = the server package plus everything it depends on
# (packages/shared) — turbo's dependency graph builds shared first.
RUN bunx turbo run build --filter=...@chat-crdt/server

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node:20-alpine ships no OpenSSL at all, so Prisma's runtime detection falls
# back to guessing "openssl-1.1.x" and then can't find libssl.so.1.1 either
# (this Alpine base doesn't carry it). Installing openssl gives it libssl.so.3
# to detect, matching the linux-musl-arm64-openssl-3.0.x engine generated in
# prisma/schema.prisma's binaryTargets.
RUN apk add --no-cache openssl

# Known tradeoff (dev-grade / kind-validation image, not the eventual GKE
# production build): this copies the full hoisted workspace node_modules,
# including apps/mobile's (Expo/RN) dependency tree, because bun install
# always resolves the whole workspace lockfile — there's no per-workspace
# --filter for install itself, only for scripts. A leaner production image
# would prune this (e.g. `bun install --production` in a workspace-focused
# copy, or a pnpm/npm workspace with `--prod --filter`). Out of scope here
# per the ticket (actual GKE deploy is out of scope).
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /repo/apps/server/dist ./apps/server/dist
COPY --from=builder /repo/apps/server/package.json ./apps/server/package.json
COPY --from=builder /repo/apps/server/prisma ./apps/server/prisma

WORKDIR /app/apps/server
EXPOSE 3001
CMD ["node", "dist/main"]
