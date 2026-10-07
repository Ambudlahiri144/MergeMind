#!/usr/bin/env bash
# Build and (re)start the MergeMind backend on the VM (Deploy.md).
#   bash deploy/deploy.sh            # deploy the latest main
#   bash deploy/deploy.sh <git-ref>  # deploy (or roll back to) a specific commit or tag
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.production"
COMPOSE=(docker compose -f deploy/compose.prod.yml --env-file "$ENV_FILE")
MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from deploy/env.production.example first." >&2
  exit 1
fi
if [ "$(stat -c %a "$ENV_FILE")" != "600" ]; then
  echo "Refusing to deploy: $ENV_FILE must be chmod 600 (it holds secrets)." >&2
  exit 1
fi

echo "==> Source"
git fetch --quiet origin
if [ "${1:-}" != "" ]; then
  git checkout --quiet "$1"
else
  git checkout --quiet main
  git pull --ff-only --quiet
fi
echo "    at $(git rev-parse --short HEAD): $(git log -1 --format=%s)"

echo "==> Build and start"
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "==> Embedding model ($MODEL)"
if ! "${COMPOSE[@]}" exec -T ollama ollama list | grep -q "^$MODEL"; then
  "${COMPOSE[@]}" exec -T ollama ollama pull "$MODEL"
fi

echo "==> Waiting for the api to be ready"
for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T api node -e \
    "fetch('http://127.0.0.1:4000/api/v1/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    echo "    ready (attempt $attempt)"
    break
  fi
  if [ "$attempt" = 30 ]; then
    echo "The api did not become ready. Recent logs:" >&2
    "${COMPOSE[@]}" logs --tail 50 api >&2
    exit 1
  fi
  sleep 2
done

API_DOMAIN="$(grep -E '^API_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
echo "==> Public check: https://$API_DOMAIN/api/v1/health"
curl -fsS --max-time 20 "https://$API_DOMAIN/api/v1/health" && echo

"${COMPOSE[@]}" ps
docker image prune -f >/dev/null
echo "Deployed."
