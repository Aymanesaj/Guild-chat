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

# Ensure required environment variables exist in .env (safely append defaults if missing)
ensure_env() {
    local key="$1"
    local val="$2"
    if ! grep -q "^${key}=" .env; then
        echo "Appending missing configuration: ${key}=${val}"
        echo "${key}=${val}" >> .env
    fi
}

ensure_env "POSTGRES_USER" "admin"
ensure_env "POSTGRES_PASSWORD" "admin"
ensure_env "POSTGRES_DB" "transdb"
ensure_env "ORG_DATASOURCE_URL" "jdbc:postgresql://postgres:5432/org_service_db"
ensure_env "ORG_DATASOURCE_USERNAME" "admin"
ensure_env "ORG_DATASOURCE_PASSWORD" "admin"
ensure_env "MONGO_INITDB_ROOT_USERNAME" "rooted"
ensure_env "MONGO_INITDB_ROOT_PASSWORD" "rooted123"
ensure_env "CHAT_MONGO_DB" "chatdb"
ensure_env "CHAT_MONGO_USER" "rooted"
ensure_env "CHAT_MONGO_PASSWORD" "rooted123"
ensure_env "CHAT_MONGO_AUTH_DB" "admin"

# 2. Check Docker availability
if ! command -v docker &> /dev/null; then
    echo "❌ ERROR: docker command not found! Please run setup-vm.sh first."
    exit 1
fi

# 3. Export DOCKER_SOCK for docker-compose compatibility
CURRENT_UID=$(id -u)
if [ -S "/var/run/user/${CURRENT_UID}/docker.sock" ]; then
    export DOCKER_SOCK="/var/run/user/${CURRENT_UID}/docker.sock"
else
    export DOCKER_SOCK="/var/run/docker.sock"
fi

# 4. Initialize core databases and ensure schemas/users exist
echo "🗄️ Initializing and checking databases..."
docker compose up -d postgres mongodb

echo "⏳ Waiting for databases to become ready..."
for i in {1..30}; do
    if docker compose ps postgres | grep -q "(healthy)" && docker compose ps mongodb | grep -q "(healthy)"; then
        echo "✅ Databases are healthy."
        break
    fi
    sleep 2
done

# Ensure org_service_db exists in PostgreSQL
PG_USER=$(grep -E '^POSTGRES_USER=' .env | cut -d'=' -f2- | tr -d '\r"' || echo "admin")
PG_USER=${PG_USER:-admin}
if ! docker compose exec -T postgres psql -U "$PG_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'org_service_db'" 2>/dev/null | grep -q 1; then
    echo "Creating missing PostgreSQL database: org_service_db"
    docker compose exec -T postgres psql -U "$PG_USER" -d postgres -c "CREATE DATABASE org_service_db;" || true
fi

# Ensure Mongo root user exists
M_USER=$(grep -E '^MONGO_INITDB_ROOT_USERNAME=' .env | cut -d'=' -f2- | tr -d '\r"' || echo "rooted")
M_PASS=$(grep -E '^MONGO_INITDB_ROOT_PASSWORD=' .env | cut -d'=' -f2- | tr -d '\r"' || echo "rooted123")
M_USER=${M_USER:-rooted}
M_PASS=${M_PASS:-rooted123}

docker compose exec -T mongodb mongosh admin --eval "
try {
    db.createUser({ user: '${M_USER}', pwd: '${M_PASS}', roles: [{ role: 'root', db: 'admin' }] });
} catch (e) {
    // Ignore if already exists
}
" > /dev/null 2>&1 || true

# 5. Build and launch all services
echo "🔨 Building and launching containers..."
if ! docker compose up -d --build --remove-orphans; then
    echo "❌ Deployment failed during docker compose up!"
    echo "=========================================="
    echo " Docker Compose PS:"
    echo "=========================================="
    docker compose ps -a || true
    echo "=========================================="
    echo " Failure Logs (chat-service):"
    echo "=========================================="
    docker compose logs --tail=100 chat-service || true
    echo "=========================================="
    echo " Failure Logs (org-service):"
    echo "=========================================="
    docker compose logs --tail=100 org-service || true
    echo "=========================================="
    echo " Failure Logs (identity-service):"
    echo "=========================================="
    docker compose logs --tail=100 identity-service || true
    echo "=========================================="
    echo " Failure Logs (mongodb):"
    echo "=========================================="
    docker compose logs --tail=100 mongodb || true
    echo "=========================================="
    echo " Failure Logs (postgres):"
    echo "=========================================="
    docker compose logs --tail=100 postgres || true
    exit 1
fi

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
