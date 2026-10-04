#!/bin/bash

DOCKER_API_URL="${DOCKER_API_URL:-http://docker-socket-proxy:2375}"
PORT=8090
WEB_ROOT="${WEB_ROOT:-/tmp/metrics_www}"
DATA_FILE="$WEB_ROOT/metrics.prom"
LAST_SUCCESS=0

# Four workers, each with bounded requests; the HTTP server never waits on Docker.
docker_get() {
    curl -fsS --connect-timeout 1 --max-time 3 "$DOCKER_API_URL$1"
}

collect_container() {
    local id="$1" name="$2" image="$3" stats inspect
    stats=$(docker_get "/containers/$id/stats?stream=false&one-shot=true") || return 1
    inspect=$(docker_get "/containers/$id/json") || return 1
    # Missing CPU/memory fields must not become plausible zero measurements.
    jq -e '.memory_stats.usage != null and .memory_stats.limit != null and
           .cpu_stats.cpu_usage.total_usage != null and .cpu_stats.system_cpu_usage != null' \
        <<< "$stats" > /dev/null || return 1
    jq -e '.RestartCount != null' <<< "$inspect" > /dev/null || return 1
    jq -r --arg id "$id" --arg name "$name" --arg image "$image" '
        def labels: "{container=" + ($name | tojson) + ",id=" + ($id | tojson) + ",image=" + ($image | tojson) + "}";
        "container_memory_usage_bytes"            + labels + " " + (.memory_stats.usage // 0 | tostring),
        "container_memory_limit_bytes"           + labels + " " + (.memory_stats.limit // 0 | tostring),
        "container_cpu_usage_total_nanoseconds"  + labels + " " + (.cpu_stats.cpu_usage.total_usage // 0 | tostring),
        "container_cpu_system_usage_nanoseconds" + labels + " " + (.cpu_stats.system_cpu_usage // 0 | tostring),
        "container_network_receive_bytes_total"  + labels + " " + (.networks.eth0.rx_bytes // 0 | tostring),
        "container_network_transmit_bytes_total" + labels + " " + (.networks.eth0.tx_bytes // 0 | tostring),
        "container_blkio_io_service_bytes_total" + labels + " " + (
            [.blkio_stats.io_service_bytes_recursive[]?.value] | add // 0 | tostring
        )
    ' <<< "$stats" || return 1
    jq -r --arg name "$name" --arg image "$image" '
        "container_restart_count{container=" + ($name | tojson) + ",image=" + ($image | tojson) + "} " + (.RestartCount // 0 | tostring)
    ' <<< "$inspect" || return 1
}

collect_data() {
    local containers id name image work_dir pid metrics failed=0
    local -a pids=()
    containers=$(docker_get /containers/json) || return 1
    containers=$(jq -r '.[] | [.Id, (.Names[0] | ltrimstr("/")), .Image] | @tsv' <<< "$containers") || return 1
    work_dir=$(mktemp -d) || return 1

    while IFS=$'\t' read -r id name image; do
        [[ -n "$id" ]] || continue
        collect_container "$id" "$name" "$image" > "$work_dir/$id.prom" &
        pids+=("$!")
        if (( ${#pids[@]} == 4 )); then
            for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
            pids=()
        fi
    done <<< "$containers"
    for pid in "${pids[@]}"; do wait "$pid" || failed=1; done

    if (( failed )); then
        rm -rf "$work_dir"
        return 1
    fi
    cat <<'METRICS'
# HELP node_uptime_seconds_total System uptime in seconds.
# TYPE node_uptime_seconds_total counter
# HELP container_memory_usage_bytes Current container memory usage.
# TYPE container_memory_usage_bytes gauge
# HELP container_memory_limit_bytes Container memory limit.
# TYPE container_memory_limit_bytes gauge
# HELP container_cpu_usage_total_nanoseconds Total container CPU time.
# TYPE container_cpu_usage_total_nanoseconds counter
# HELP container_cpu_system_usage_nanoseconds Total system CPU time reported by Docker.
# TYPE container_cpu_system_usage_nanoseconds counter
# HELP container_network_receive_bytes_total Bytes received on eth0.
# TYPE container_network_receive_bytes_total counter
# HELP container_network_transmit_bytes_total Bytes transmitted on eth0.
# TYPE container_network_transmit_bytes_total counter
# HELP container_blkio_io_service_bytes_total Total container block I/O service bytes.
# TYPE container_blkio_io_service_bytes_total counter
# HELP container_restart_count Number of times the container has restarted.
# TYPE container_restart_count gauge
METRICS
    awk '{print "node_uptime_seconds_total " $1}' /proc/uptime

    # An empty Docker host is a valid collection.
    for metrics in "$work_dir"/*.prom; do
        [[ -f "$metrics" ]] && cat "$metrics"
    done
    rm -rf "$work_dir"
}

health_metrics() {
    cat <<METRICS
# HELP docker_exporter_collection_success Whether the last collection completed successfully.
# TYPE docker_exporter_collection_success gauge
docker_exporter_collection_success $1
# HELP docker_exporter_last_success_timestamp_seconds Unix time of the last complete collection.
# TYPE docker_exporter_last_success_timestamp_seconds gauge
docker_exporter_last_success_timestamp_seconds $LAST_SUCCESS
METRICS
}

collect_once() {
    local success=0
    if collect_data > "$WEB_ROOT/.metrics.tmp"; then
        success=1
        LAST_SUCCESS=$(date +%s)
    else
        echo "Docker metric collection failed" >&2
        # Publish health only. Old container samples must not look fresh.
        : > "$WEB_ROOT/.metrics.tmp"
    fi
    health_metrics "$success" >> "$WEB_ROOT/.metrics.tmp"
    mv "$WEB_ROOT/.metrics.tmp" "$DATA_FILE"
}

collect_loop() {
    while true; do
        collect_once || return 1
        sleep 5
    done
}

main() {
    mkdir -p "$WEB_ROOT"
    printf '.prom:text/plain\n' > "$WEB_ROOT/httpd.conf"
    health_metrics 0 > "$DATA_FILE"
    collect_loop &
    local collector_pid=$!
    httpd -f -p "$PORT" -h "$WEB_ROOT" -c "$WEB_ROOT/httpd.conf" &
    local server_pid=$!
    trap 'kill "$collector_pid" "$server_pid" 2>/dev/null; wait' EXIT
    trap 'exit 0' INT TERM
    echo "Serving Docker dashboard metrics on port $PORT at /metrics.prom" >&2
    wait -n "$collector_pid" "$server_pid"
    exit $?
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main
fi
