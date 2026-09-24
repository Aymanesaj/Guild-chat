#!/usr/bin/env bash
set -eo pipefail

echo "=========================================="
echo " Starting ft_transcendence OCI Deployment"
echo " Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================="

# Resolve repository root directory (parent of deploy folder)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

echo "📂 Project directory: ${PROJECT_DIR}"

# 1. Check for .env file
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file is missing in ${PROJECT_DIR}!"
    echo "Please create a production .env file (e.g., from .env.example) before running deployment."
    exit 1
fi

# 2. Check Docker availability
if ! command -v docker &> /dev/null; then
    echo "❌ ERROR: docker command not found! Please run setup-vm.sh first."
    exit 1
fi

# 3. Pull latest changes from git
echo "📥 Fetching latest changes from Git..."
git fetch origin main
git reset --hard origin/main

# 4. Export DOCKER_SOCK for docker-compose compatibility
CURRENT_UID=$(id -u)
if [ -S "/var/run/user/${CURRENT_UID}/docker.sock" ]; then
    export DOCKER_SOCK="/var/run/user/${CURRENT_UID}/docker.sock"
else
    export DOCKER_SOCK="/var/run/docker.sock"
fi

# 5. Build and launch services
echo "🔨 Building and launching containers..."
docker compose up -d --build --remove-orphans

# 6. Clean up dangling images to conserve disk space on OCI Free Tier
echo "🧹 Pruning old/dangling Docker images..."
docker image prune -f

# 7. Check container status
echo "⏳ Waiting for services to initialize..."
sleep 10

echo "=========================================="
echo " Container Status:"
echo "=========================================="
docker compose ps

echo "=========================================="
echo "✅ Deployment finished successfully!"
echo "=========================================="

