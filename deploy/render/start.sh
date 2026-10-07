#!/usr/bin/env bash
# One container, three processes (Render free web service, ADR-038): redis-server, the api and
# the worker. tini (PID 1) forwards SIGTERM here; if any process exits, the others are stopped
# and the container exits non-zero, so Render restarts it. Redis keeps nothing on disk: the
# boot recovery passes (webhook redelivery, review reconciliation) rebuild what a restart lost.
set -uo pipefail

PORT="${PORT:-10000}"
REDIS_PORT=6379
REDIS_MAX_MEMORY="${REDIS_MAX_MEMORY:-48mb}"
# Heap caps keep the three processes inside Render free's 512 MB.
API_HEAP_MB="${API_HEAP_MB:-128}"
WORKER_HEAP_MB="${WORKER_HEAP_MB:-224}"

app_pids=()
redis_pid=''
# Node first, Redis last: the worker finishes in-flight jobs and the api closes its queues
# while Redis is still there (graceful shutdown, packages/shared/src/shutdown.ts).
stop_all() {
  for pid in "${app_pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "${app_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  if [ -n "$redis_pid" ]; then
    kill -TERM "$redis_pid" 2>/dev/null || true
    wait "$redis_pid" 2>/dev/null || true
  fi
}
trap 'stop_all; exit 0' TERM INT

redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save '' --appendonly no \
  --maxmemory "$REDIS_MAX_MEMORY" --maxmemory-policy noeviction --loglevel warning &
redis_pid=$!
for _ in $(seq 1 50); do
  redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break
  sleep 0.1
done
if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  echo '{"level":"fatal","msg":"render.redisDidNotStart"}' >&2
  stop_all
  exit 1
fi

export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"

API_PORT="$PORT" NODE_OPTIONS="--max-old-space-size=${API_HEAP_MB}" \
  node apps/api/dist/server.js &
app_pids+=($!)
NODE_OPTIONS="--max-old-space-size=${WORKER_HEAP_MB}" \
  node apps/worker/dist/main.js &
app_pids+=($!)

# The first process to exit takes the container down with it.
wait -n
status=$?
# None of the three should ever stop on its own, so even a clean exit restarts the container.
if [ "$status" -eq 0 ]; then
  status=1
fi
echo "{\"level\":\"fatal\",\"msg\":\"render.processExited\",\"status\":${status}}" >&2
stop_all
exit "$status"
