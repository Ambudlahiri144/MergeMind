# Backend image for the api and the worker (Deploy.md, ADR-037). Builds natively on the VM's CPU
# (the Oracle VM is arm64; CI builds amd64). One build, two targets:
#   docker build --target api .      docker build --target worker .
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
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
USER node

FROM runtime AS api
EXPOSE 4000
# Readiness: Mongo and Redis reachable (GET /api/v1/ready).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]
