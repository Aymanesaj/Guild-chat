#!/usr/bin/env bash
set -Eeuo pipefail

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
if [[ ! -f .env ]]; then
    echo "ERROR: .env file is missing in $(pwd)" >&2
    exit 1
fi

for required_command in docker jq curl; do
    command -v "$required_command" >/dev/null || {
        echo "ERROR: $required_command is required; see deploy/setup-vm.sh." >&2
        exit 1
    }
done

DEPLOY_WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-300}"
DEPLOY_HTTP_TIMEOUT="${DEPLOY_HTTP_TIMEOUT:-30}"
DEPLOY_LOG_TAIL="${DEPLOY_LOG_TAIL:-80}"
for setting in DEPLOY_WAIT_TIMEOUT DEPLOY_HTTP_TIMEOUT DEPLOY_LOG_TAIL; do
    if [[ ! "${!setting}" =~ ^[1-9][0-9]*$ ]]; then
        echo "ERROR: $setting must be a positive integer." >&2
        exit 1
    fi
done
if [[ -n "${DEPLOY_CA_CERT:-}" && ! -r "$DEPLOY_CA_CERT" ]]; then
    echo "ERROR: DEPLOY_CA_CERT must point to a readable CA certificate." >&2
    exit 1
fi

CURRENT_UID=$(id -u)
if [[ -S "/var/run/user/${CURRENT_UID}/docker.sock" ]]; then
    export DOCKER_SOCK="/var/run/user/${CURRENT_UID}/docker.sock"
else
    export DOCKER_SOCK="/var/run/docker.sock"
fi

stage="configuration"
service_model='{}'
completed_jobs='[]'
probe_services=()
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

snapshot() {
    # Compose versions emit either an array or one JSON object per line.
    docker compose ps --all --format json | jq -s 'flatten'
}

problem_containers() {
    jq --argjson services "$service_model" --argjson jobs "$completed_jobs" '
        . as $containers |
        [ $services | keys[] as $service |
          [$containers[] | select(.Service == $service)] as $matches |
          (if ($matches | length) == 0 then
              {Service: $service, State: "missing", Health: "", ExitCode: null}
           else $matches[] end) |
          . as $container |
          select(if ($jobs | index($container.Service)) != null then
              .State != "exited" or .ExitCode != 0
          else
              .State != "running" or ((.Health // "") != "" and .Health != "healthy")
          end)
        ]'
}

deployment_failed() {
    local status="$1" line="$2" current problems service container_id
    # Let the parent report command-substitution failures once, outside captured output.
    if (( BASH_SUBSHELL > 0 )); then
        exit "$status"
    fi
    trap - ERR
    set +e
    echo "ERROR: Deployment failed during $stage (exit $status, line $line)." >&2
    docker compose ps --all

    local -a affected=("${probe_services[@]}")
    current=$(snapshot)
    if [[ -n "$current" ]]; then
        problems=$(problem_containers <<< "$current")
        while IFS= read -r service; do
            [[ -n "$service" ]] && affected+=("$service")
        done < <(jq -r '.[].Service' <<< "$problems")
        while IFS= read -r container_id; do
            [[ -z "$container_id" ]] && continue
            # Print state and health-check output, never the container environment.
            docker inspect --format '{{.Name}} {{json .State}}' "$container_id"
        done < <(jq -r '.[] | .ID // empty' <<< "$problems")
    fi

    if (( ${#affected[@]} )); then
        local -a log_services=()
        while IFS= read -r service; do
            [[ -n "$service" ]] && log_services+=("$service")
        done < <(printf '%s\n' "${affected[@]}" | jq -Rsc --argjson services "$service_model" '
            split("\n") | map(select(length > 0)) |
            [ .[] as $name | $name, (($services[$name].depends_on // {}) | keys[]) ] |
            unique[]' -r)
        echo "Recent logs for affected services and their dependencies:"
        docker compose logs --no-color --since "$deployment_started" --tail="$DEPLOY_LOG_TAIL" "${log_services[@]}"
    else
        echo "No failing container identified; showing recent logs from all services:"
        docker compose logs --no-color --since "$deployment_started" --tail="$DEPLOY_LOG_TAIL"
    fi
    exit "$status"
}

deployment_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
trap 'deployment_failed "$?" "$LINENO"' ERR

echo "Deploying commit $DEPLOY_SHA"
docker compose config --quiet
# Keep the resolved configuration out of logs: it contains credentials.
compose_config=$(docker compose config --format json)
service_model=$(jq '.services | map_values({depends_on: (.depends_on // {})})' <<< "$compose_config")
completed_jobs=$(jq '[.[] | .depends_on | to_entries[] |
    select(.value.condition == "service_completed_successfully") | .key] | unique' <<< "$service_model")
probe_domain=$(jq -er '.services.nginx.environment.DOMAIN | select(type == "string" and length > 0)' <<< "$compose_config")
unset compose_config
if [[ ! "$probe_domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]; then
    echo "ERROR: DOMAIN must be a hostname without a scheme, port or path." >&2
    exit 1
fi

stage="image build"
echo "Building images before updating running containers..."
docker compose build

stage="container startup"
docker compose up -d --no-build --remove-orphans --wait --wait-timeout "$DEPLOY_WAIT_TIMEOUT"

# Refresh static upstream DNS and copy any updated mounted certificates.
stage="gateway restart"
probe_services=(nginx)
docker compose restart nginx
probe_services=()

stage="container health"
deadline=$((SECONDS + DEPLOY_WAIT_TIMEOUT))
while true; do
    current=$(snapshot)
    problems=$(problem_containers <<< "$current")
    if [[ "$(jq 'length' <<< "$problems")" == 0 ]]; then
        break
    fi
    if jq -e 'any(.[]; .State == "exited" or .State == "dead" or .State == "restarting" or .Health == "unhealthy")' \
        <<< "$problems" >/dev/null; then
        echo "ERROR: A service exited, restarted or became unhealthy during startup." >&2
        false
    fi
    if (( SECONDS >= deadline )); then
        echo "ERROR: Services did not become ready within ${DEPLOY_WAIT_TIMEOUT}s." >&2
        false
    fi
    sleep 2
done

check_http() {
    local path="$1" service="$2" body_filter="$3" status
    local -a tls_options=()
    [[ -n "${DEPLOY_CA_CERT:-}" ]] && tls_options+=(--cacert "$DEPLOY_CA_CERT")
    probe_services=(nginx "$service")
    stage="HTTPS check: $path"
    # Use this VM's published port, with the configured hostname for SNI/TLS.
    # This tests ingress locally without relying on public DNS or a CDN.
    status=$(curl --silent --show-error --fail --noproxy '*' \
        --resolve "$probe_domain:443:127.0.0.1" \
        --connect-timeout 5 --max-time "$DEPLOY_HTTP_TIMEOUT" \
        "${tls_options[@]}" --output "$work_dir/response" --write-out '%{http_code}' \
        "https://$probe_domain$path")
    if [[ "$status" != 200 ]]; then
        echo "ERROR: $path returned HTTP $status; expected 200." >&2
        return 1
    fi
    if [[ -n "$body_filter" ]] && ! jq -e "$body_filter" "$work_dir/response" >/dev/null 2>&1; then
        echo "ERROR: $path returned an unexpected health response." >&2
        return 1
    fi
    echo "PASS: HTTPS $path"
    probe_services=()
}

check_http / frontend ''
check_http /api/users/health identity-service '.status == "ok" and .service == "identity-service"'
check_http /api/orgs/actuator/health org-service '.status == "UP"'
check_http /api/chat/actuator/health chat-service '.status == "UP"'

stage="final container status"
current=$(snapshot)
problems=$(problem_containers <<< "$current")
if [[ "$(jq 'length' <<< "$problems")" != 0 ]]; then
    echo "ERROR: A service stopped or became unhealthy during HTTP verification." >&2
    false
fi
docker compose ps --all

echo "Deployment verified. Pruning dangling images..."
stage="image cleanup"
docker image prune -f
echo "Deployment $DEPLOY_SHA completed successfully."
