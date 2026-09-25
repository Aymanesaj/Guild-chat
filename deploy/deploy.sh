#!/usr/bin/env bash
set -eo pipefail

cd "$(dirname "$0")/.."

if [ "$1" = "--pull" ]; then
    echo "📥 Pulling latest changes from Git..."
    git fetch origin main
    git reset --hard origin/main
fi

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

echo "🧹 Pruning dangling images..."
docker image prune -f
sleep 5

echo "=========================================="
echo " Container Status:"
echo "=========================================="
docker compose ps