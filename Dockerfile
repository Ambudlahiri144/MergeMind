# Backend images (Deploy.md). One build, three targets:
#   docker build .                   the default: api + worker + Redis in one container (Render free, ADR-038)
#   docker build --target api .      the api alone (VM with Docker Compose, ADR-037)
#   docker build --target worker .   the worker alone (VM with Docker Compose)
# Production loads each package's dist/ (ADR-015): no --conditions flag at runtime.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=true NODE_ENV=development
COPY . .
# --ignore-scripts: the worker only loads tree-sitter's .wasm grammars, so the native bindings'
# install scripts (node-gyp) are skipped, and no third-party install script runs in the build.
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build -w @mergemind/shared \
 && npm run build -w @mergemind/db \
 && npm run build -w @mergemind/llm \
 && npm run build -w @mergemind/github \
 && npm run build -w @mergemind/api \
 && npm run build -w @mergemind/worker
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
# Whole app folders: npm nests a dependency in a workspace's own node_modules when its version
# conflicts with the hoisted one (the worker's p-limit), and dist/ resolves it from there.
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/worker ./apps/worker
USER node

FROM runtime AS api
EXPOSE 4000
# Readiness: Mongo and Redis reachable (GET /api/v1/ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

# Last stage, so a plain `docker build .` (what Render runs) builds it. tini is PID 1 and passes
# SIGTERM to start.sh, which supervises redis-server, the api and the worker (ADR-038).
FROM runtime AS render
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends redis-server tini \
 && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node deploy/render/start.sh ./deploy/render/start.sh
RUN chmod +x ./deploy/render/start.sh
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./deploy/render/start.sh"]
