#!/bin/bash
# Run with: bash infra/docker-exporter/test.sh
set -eu
source "$(dirname "$0")/script.sh"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
WEB_ROOT="$TEST_DIR/www"
DATA_FILE="$WEB_ROOT/metrics.prom"
mkdir -p "$WEB_ROOT"
MODE=healthy

docker_get() {
    if [[ "$MODE" == discovery_failure ]]; then return 1; fi
    case "$1" in
        /containers/json)
            if [[ "$MODE" == empty ]]; then echo '[]'; return; fi
            jq -nc '[range(1; 7) | {Id: tostring, Names: ["/test-\(.)"], Image: "test-image"}]'
            ;;
        */stats\?*)
            if [[ "$MODE" == partial_failure && "$1" == /containers/2/* ]]; then return 1; fi
            if [[ "$MODE" == invalid_json ]]; then echo 'invalid'; return; fi
            if [[ "$MODE" == missing_fields ]]; then echo '{}'; return; fi
            printf 'start\n' >> "$TEST_DIR/workers"
            sleep 0.1
            echo '{"memory_stats":{"usage":128,"limit":1024},"cpu_stats":{"cpu_usage":{"total_usage":100},"system_cpu_usage":400}}'
            ;;
        */json)
            printf 'end\n' >> "$TEST_DIR/workers"
            echo '{"RestartCount":2}'
            ;;
        *) return 1 ;;
    esac
}

collect_once
grep -qx 'docker_exporter_collection_success 1' "$DATA_FILE"
[[ $(grep -c '^container_memory_usage_bytes{' "$DATA_FILE") == 6 ]]
[[ "$LAST_SUCCESS" -gt 0 ]]
# The fixture crosses the batch boundary; workers must overlap but never exceed four.
awk '/start/ {active++; if(active>peak) peak=active} /end/ {active--}
     END {exit !(peak>1 && peak<=4 && active==0)}' "$TEST_DIR/workers"
previous_success=$LAST_SUCCESS

for MODE in discovery_failure partial_failure invalid_json missing_fields; do
    collect_once 2> "$TEST_DIR/expected-error"
    grep -qx 'docker_exporter_collection_success 0' "$DATA_FILE"
    [[ "$LAST_SUCCESS" == "$previous_success" ]]
    if grep -q '^container_' "$DATA_FILE"; then
        echo 'Failed collection published container data' >&2
        exit 1
    fi
done

MODE=healthy
collect_once
grep -qx 'docker_exporter_collection_success 1' "$DATA_FILE"
[[ $(grep -c '^container_memory_usage_bytes{' "$DATA_FILE") == 6 ]]
MODE=empty
collect_once
grep -qx 'docker_exporter_collection_success 1' "$DATA_FILE"
if grep -q '^container_' "$DATA_FILE"; then exit 1; fi
printf 'Exporter tests passed: collection, concurrency, failures, recovery, empty host.\n'
