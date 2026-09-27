#!/bin/bash

SOCKET="/var/run/docker.sock"
PORT=8090
WEB_ROOT="/tmp/metrics_www"
DATA_FILE="$WEB_ROOT/metrics.prom"

docker_get() {
    curl -fsS --max-time 10 --unix-socket "$SOCKET" "http://localhost$1"
}

collect_data() {
    local containers id name image stats inspect
    containers=$(docker_get /containers/json) || return 1
    containers=$(jq -r '.[] | [.Id, (.Names[0] | ltrimstr("/")), .Image] | @tsv' <<< "$containers") || return 1

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

    while IFS=$'\t' read -r id name image; do
        [[ -n "$id" ]] || continue
        if stats=$(docker_get "/containers/$id/stats?stream=false"); then
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
        else
            echo "Could not collect stats for $name" >&2
        fi

        if inspect=$(docker_get "/containers/$id/json"); then
            jq -r --arg name "$name" --arg image "$image" '
                "container_restart_count{container=" + ($name | tojson) + ",image=" + ($image | tojson) + "} " + (.RestartCount // 0 | tostring)
            ' <<< "$inspect" || return 1
        else
            echo "Could not collect restart count for $name" >&2
        fi
    done <<< "$containers"
}

collect_loop() {
    while true; do
        if collect_data > "$WEB_ROOT/.metrics.tmp"; then
            mv "$WEB_ROOT/.metrics.tmp" "$DATA_FILE"
        else
            echo "Docker metric collection failed" >&2
            rm -f "$DATA_FILE" "$WEB_ROOT/.metrics.tmp"
        fi
        sleep 5
    done
}

main() {
    mkdir -p "$WEB_ROOT"
    printf '.prom:text/plain\n' > "$WEB_ROOT/httpd.conf"
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
