#!/usr/bin/env bash
# Starts a disposable WordPress in Docker, installs it, creates an Application
# Password, runs the end-to-end tests against it, and always tears it down.
set -euo pipefail

cd "$(dirname "$0")/.."
export WP_PORT="${WP_PORT:-8089}"
COMPOSE=(docker compose -f e2e/docker-compose.yml)
SITE="http://localhost:${WP_PORT}"

DATA_DIR="$(pwd)/e2e/.data"

cleanup() {
  if [[ "${KEEP_WORDPRESS:-0}" != "1" ]]; then
    "${COMPOSE[@]}" --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
    # Files are owned by container users on Linux; delete them from a container.
    if [[ -d "${DATA_DIR}" ]]; then
      docker run --rm --user 0 --entrypoint sh -v "${DATA_DIR}:/data" wordpress:cli -c 'rm -rf /data/db /data/html' >/dev/null 2>&1 || true
      rm -rf "${DATA_DIR}"
    fi
  fi
}
trap cleanup EXIT

wp() { "${COMPOSE[@]}" run --rm -T cli wp "$@" 2> >(grep -v -E "Container|^ *$" >&2); }

cleanup
mkdir -p "${DATA_DIR}/db" "${DATA_DIR}/html"
echo "Starting WordPress on ${SITE}"
"${COMPOSE[@]}" up -d wordpress

echo "Waiting for WordPress files"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T wordpress test -f /var/www/html/wp-config.php 2>/dev/null; then break; fi
  sleep 2
done

for _ in $(seq 1 30); do
  if wp core version >/dev/null 2>&1; then break; fi
  sleep 2
done

wp core install --url="${SITE}" --title="EdgeEver E2E" --admin_user=admin \
  --admin_password="admin-$(date +%s)" --admin_email=admin@example.com --skip-email
wp option update timezone_string "UTC" >/dev/null
APP_PASSWORD="$(wp user application-password create admin edgeever --porcelain | tr -d '\r\n')"
echo "WordPress $(wp core version | tr -d '\r') installed; Application Password created."

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "${SITE}/?rest_route=/"; then break; fi
  sleep 1
done

export WP_E2E_SITE="${SITE}" WP_E2E_USER=admin WP_E2E_PASSWORD="${APP_PASSWORD}"

echo "Phase 1: plain permalinks (REST via ?rest_route=)"
WP_E2E_PHASE=plain bun test ./e2e/wordpress.e2e.ts --timeout 60000

echo "Phase 2: pretty permalinks (REST via /wp-json/)"
wp rewrite structure '/%postname%/' --hard >/dev/null
WP_E2E_PHASE=pretty bun test ./e2e/wordpress.e2e.ts --timeout 60000
