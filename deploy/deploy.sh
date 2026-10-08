#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -ne 1 || ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Usage: bash deploy/deploy.sh <full-tested-commit-sha>" >&2
    exit 1
fi
DEPLOY_SHA="$1"

if [[ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ]]; then
    echo "ERROR: Check out the tested commit $DEPLOY_SHA before deploying." >&2
    exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: The deployment checkout has local changes. Resolve them before deploying." >&2
    exit 1
fi

echo "Deploying commit $DEPLOY_SHA"

if [ ! -f .env ]; then
    echo "❌ ERROR: .env file is missing in $(pwd)"
    exit 1
fi

CURRENT_UID=$(id -u)
if [ -S "/var/run/user/${CURRENT_UID}/docker.sock" ]; then
    export DOCKER_SOCK="/var/run/user/${CURRENT_UID}/docker.sock"
else
    export DOCKER_SOCK="/var/run/docker.sock"
fi

echo "🔨 Building and launching containers..."
docker compose up -d --build --remove-orphans
docker compose restart nginx


echo "🧹 Pruning dangling images..."
docker image prune -f
sleep 5

echo "=========================================="
echo " Container Status:"
echo "=========================================="
docker compose ps
