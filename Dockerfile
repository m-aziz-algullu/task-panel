# Production image for Dokploy (or any Docker host).
#
# Two runtime targets, both built from the same Next.js "standalone" output:
#   agent (default)  Task Panel plus the bundled OpenClaw Gateway in one container.
#                    Mount a volume at /data so the agent's memory, sessions,
#                    provider keys and skills survive redeploys.
#   plain            Task Panel alone, no agent:  docker build --target plain .
#
# Either way DATABASE_URL (PostgreSQL) must be provided at runtime; the server
# refuses to start without it.

# Keep in sync with @openclaw/gateway-client in package.json (tests check it).
ARG OPENCLAW_VERSION=2026.10.4

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Git doesn't track empty folders, so public/ may be missing from a fresh clone;
# the runner stages copy it either way.
RUN mkdir -p public && npm run build

FROM node:24-bookworm-slim AS plain
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nextjs && useradd -u 1001 -g nextjs -M -s /usr/sbin/nologin nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server.js"]

# OpenClaw's official image (with Chromium for the agent's browser) as the base:
# its Node runtime, system packages and /app/docker-entrypoint.mjs are reused as-is.
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}-browser AS agent
USER root
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nextjs && useradd -u 1001 -g nextjs -M -s /usr/sbin/nologin nextjs && \
    mkdir -p /data

WORKDIR /srv/task-panel
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY docker/openclaw-bootstrap.mjs docker/supervisor.mjs docker/agent-shell.sh /srv/docker/
RUN chmod 755 /srv/docker/agent-shell.sh

# No VOLUME instruction on purpose: an anonymous volume would look persistent but
# be replaced on every redeploy. The supervisor warns when /data isn't mounted.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Runs as root only to start the Gateway as `node` and Task Panel as `nextjs`.
ENTRYPOINT ["tini", "-s", "--", "node", "/srv/docker/supervisor.mjs"]
CMD []
