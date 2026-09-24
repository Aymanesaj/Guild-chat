#!/bin/bash
SOCKET="/var/run/docker.sock"
PORT=8090
WEB_ROOT="/tmp/metrics_www"
DATA_FILE="$WEB_ROOT/metrics.prom"
NGINX_STATUS_URL="${NGINX_STATUS_URL:-http://nginx/nginx_status}"

# =====================================================================
# LOGGING
# =====================================================================
LOG_LEVEL="${LOG_LEVEL:-INFO}"
LOG_FILE="$WEB_ROOT/exporter.log"
LOG_MAX_BYTES=$((5 * 1024 * 1024))  # rotate at 5MB

declare -A LOG_LEVELS=( [DEBUG]=0 [INFO]=1 [WARN]=2 [ERROR]=3 )

log() {
    local level="$1"; shift
    local msg="$*"
    local level_num="${LOG_LEVELS[$level]:-1}"
    local threshold="${LOG_LEVELS[$LOG_LEVEL]:-1}"
    [[ $level_num -lt $threshold ]] && return 0

    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    local line="[$ts] [$level] $msg"

    echo "$line" >&2

    mkdir -p "$WEB_ROOT" 2>/dev/null
    echo "$line" >> "$LOG_FILE" 2>/dev/null

    # simple size-based rotation, keep one previous file
    if [[ -f "$LOG_FILE" ]]; then
        local size
        size=$(stat -c%s "$LOG_FILE" 2>/dev/null || wc -c < "$LOG_FILE" 2>/dev/null)
        if [[ -n "$size" && "$size" -gt "$LOG_MAX_BYTES" ]]; then
            mv "$LOG_FILE" "${LOG_FILE}.1" 2>/dev/null
        fi
    fi
}

# time a command, logging start/end/duration/status at DEBUG,
# and an ERROR line if it failed. Usage: time_stage "label" cmd args...
time_stage() {
    local label="$1"; shift
    local start end dur status
    start=$(date +%s.%N)
    "$@"
    status=$?
    end=$(date +%s.%N)
    dur=$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}')
    if [[ $status -ne 0 ]]; then
        log ERROR "$label failed (exit=$status, took ${dur}s)"
    else
        log DEBUG "$label ok (took ${dur}s)"
    fi
    return $status
}

log INFO "Exporter starting (PID $$, LOG_LEVEL=$LOG_LEVEL, PORT=$PORT)"

# Postgres connection: PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD are all
# standard libpq env vars — psql reads them automatically, so just set them
# in the container's env_file (docker-compose) and nothing else is needed here.

mkdir -p "$WEB_ROOT"

collect_data() {
    local cycle=0
    while true; do
        cycle=$((cycle + 1))
        local cycle_start
        cycle_start=$(date +%s.%N)
        log DEBUG "=== Collection cycle $cycle starting ==="

        TMP_FILE="/tmp/stats_new.prom"
        > "$TMP_FILE"

        # =====================================================================
        # 1. HOST HARDWARE METRICS (NATIVE BASH)
        # =====================================================================
        log DEBUG "Collecting host hardware metrics"

        # 1a. System Uptime
        if [[ -f /proc/uptime ]]; then
            uptime_seconds=$(awk '{print $1}' /proc/uptime)
            echo "# HELP node_uptime_seconds_total System uptime." >> "$TMP_FILE"
            echo "# TYPE node_uptime_seconds_total counter" >> "$TMP_FILE"
            echo "node_uptime_seconds_total $uptime_seconds" >> "$TMP_FILE"
        fi

        # 1b. CPU Package Power (Intel/AMD RAPL)
        for rapl in /sys/class/powercap/intel-rapl/intel-rapl:*; do
            if [[ -d "$rapl" ]] && grep -qi "package" "$rapl/name" 2>/dev/null; then
                e1=$(cat "$rapl/energy_uj" 2>/dev/null)
                sleep 0.1
                e2=$(cat "$rapl/energy_uj" 2>/dev/null)
                if [[ -n "$e1" && -n "$e2" ]]; then
                    power_watts=$(awk -v e1="$e1" -v e2="$e2" 'BEGIN {print ((e2 - e1) / 1000000.0) / 0.1}')
                    echo "# HELP node_cpu_power_watts CPU power draw." >> "$TMP_FILE"
                    echo "# TYPE node_cpu_power_watts gauge" >> "$TMP_FILE"
                    echo "node_cpu_power_watts $power_watts" >> "$TMP_FILE"
                fi
                break
            fi
        done

        # 1c. CPU Core Temperatures
        has_temp_header=0
        for hwmon in /sys/class/hwmon/hwmon*; do
            if [[ -f "$hwmon/name" ]] && grep -q "coretemp" "$hwmon/name"; then
                for label_path in "$hwmon"/temp*_label; do
                    [[ -e "$label_path" ]] || continue
                    label=$(cat "$label_path" 2>/dev/null)
                    if [[ "$label" == Core* ]]; then
                        core_id="${label##* }"
                        input_path="${label_path%_label}_input"
                        if [[ -f "$input_path" ]]; then
                            temp_raw=$(cat "$input_path" 2>/dev/null)
                            temp_celsius=$(awk -v r="$temp_raw" 'BEGIN {printf "%.1f", r/1000}')
                            if [[ $has_temp_header -eq 0 ]]; then
                                echo "# HELP node_cpu_core_temperature_celsius Core temperature." >> "$TMP_FILE"
                                echo "# TYPE node_cpu_core_temperature_celsius gauge" >> "$TMP_FILE"
                                has_temp_header=1
                            fi
                            echo "node_cpu_core_temperature_celsius{core=\"$core_id\"} $temp_celsius" >> "$TMP_FILE"
                        fi
                    fi
                done
            fi
        done

        # 1d. CPU Core Usages (Reads /proc/stat twice over 0.2 seconds)
        declare -A idle1 total1
        while read -r line; do
            if [[ "$line" =~ ^cpu[0-9]+ ]]; then
                read -r cpu_name user nice sys idle iowait irq softirq steal guest guest_nice <<< "$line"
                core_id="${cpu_name#cpu}"
                idle1[$core_id]=$((idle + iowait))
                total1[$core_id]=$((user + nice + sys + idle + iowait + irq + softirq + steal))
            fi
        done < /proc/stat

        sleep 0.2

        has_usage_header=0
        while read -r line; do
            if [[ "$line" =~ ^cpu[0-9]+ ]]; then
                read -r cpu_name user nice sys idle iowait irq softirq steal guest guest_nice <<< "$line"
                core_id="${cpu_name#cpu}"
                id2=$((idle + iowait))
                tot2=$((user + nice + sys + idle + iowait + irq + softirq + steal))
                id_delta=$((id2 - idle1[$core_id]))
                tot_delta=$((tot2 - total1[$core_id]))
                if [[ $tot_delta -gt 0 ]]; then
                    usage_pct=$(awk -v id="$id_delta" -v tot="$tot_delta" 'BEGIN {printf "%.1f", (1.0 - (id / tot)) * 100}')
                    if [[ $has_usage_header -eq 0 ]]; then
                        echo "# HELP node_cpu_core_usage_percent Core usage percentage." >> "$TMP_FILE"
                        echo "# TYPE node_cpu_core_usage_percent gauge" >> "$TMP_FILE"
                        has_usage_header=1
                    fi
                    echo "node_cpu_core_usage_percent{core=\"$core_id\"} $usage_pct" >> "$TMP_FILE"
                fi
            fi
        done < /proc/stat

        # 1e. CPU Total Usage (aggregate cpu line)
        read -r cpu_name user nice sys idle iowait irq softirq steal guest guest_nice < <(grep '^cpu ' /proc/stat)
        cpu_total_idle=$((idle + iowait))
        cpu_total_all=$((user + nice + sys + idle + iowait + irq + softirq + steal))
        sleep 0.2
        read -r cpu_name user nice sys idle iowait irq softirq steal guest guest_nice < <(grep '^cpu ' /proc/stat)
        cpu_total_idle2=$((idle + iowait))
        cpu_total_all2=$((user + nice + sys + idle + iowait + irq + softirq + steal))
        id_d=$((cpu_total_idle2 - cpu_total_idle))
        tot_d=$((cpu_total_all2  - cpu_total_all))
        if [[ $tot_d -gt 0 ]]; then
            cpu_total_pct=$(awk -v id="$id_d" -v tot="$tot_d" 'BEGIN {printf "%.1f", (1.0 - (id/tot)) * 100}')
            echo "# HELP node_cpu_total_usage_percent Total CPU usage across all cores." >> "$TMP_FILE"
            echo "# TYPE node_cpu_total_usage_percent gauge" >> "$TMP_FILE"
            echo "node_cpu_total_usage_percent $cpu_total_pct" >> "$TMP_FILE"
        fi

        # 1f. Load Average
        if [[ -f /proc/loadavg ]]; then
            read -r load1 load5 load15 _ < /proc/loadavg
            echo "# HELP node_load_average System load average." >> "$TMP_FILE"
            echo "# TYPE node_load_average gauge" >> "$TMP_FILE"
            echo "node_load_average{interval=\"1m\"}  $load1"  >> "$TMP_FILE"
            echo "node_load_average{interval=\"5m\"}  $load5"  >> "$TMP_FILE"
            echo "node_load_average{interval=\"15m\"} $load15" >> "$TMP_FILE"
        fi

        # 1g. Host Memory
        if [[ -f /proc/meminfo ]]; then
            mem_total=$(awk '/^MemTotal:/     {print $2 * 1024}' /proc/meminfo)
            mem_avail=$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)
            mem_buffers=$(awk '/^Buffers:/    {print $2 * 1024}' /proc/meminfo)
            mem_cached=$(awk '/^Cached:/      {print $2 * 1024}' /proc/meminfo)
            echo "# HELP node_memory_total_bytes Total system RAM." >> "$TMP_FILE"
            echo "# TYPE node_memory_total_bytes gauge" >> "$TMP_FILE"
            echo "node_memory_total_bytes $mem_total" >> "$TMP_FILE"
            echo "# HELP node_memory_available_bytes Available system RAM." >> "$TMP_FILE"
            echo "# TYPE node_memory_available_bytes gauge" >> "$TMP_FILE"
            echo "node_memory_available_bytes $mem_avail" >> "$TMP_FILE"
            echo "# HELP node_memory_buffers_bytes Memory used by kernel buffers." >> "$TMP_FILE"
            echo "# TYPE node_memory_buffers_bytes gauge" >> "$TMP_FILE"
            echo "node_memory_buffers_bytes $mem_buffers" >> "$TMP_FILE"
            echo "# HELP node_memory_cached_bytes Memory used by page cache." >> "$TMP_FILE"
            echo "# TYPE node_memory_cached_bytes gauge" >> "$TMP_FILE"
            echo "node_memory_cached_bytes $mem_cached" >> "$TMP_FILE"
        fi

        # 1h. Host Network (per interface from /proc/net/dev)
        has_net_header=0
        while read -r line; do
            # skip header lines
            [[ "$line" == *"|"* ]] && continue
            iface=$(echo "$line" | awk -F: '{print $1}' | tr -d ' ')
            [[ -z "$iface" ]] && continue
            rx_bytes=$(echo "$line" | awk '{print $2}')
            tx_bytes=$(echo "$line" | awk '{print $10}')
            if [[ $has_net_header -eq 0 ]]; then
                echo "# HELP node_network_receive_bytes_total Host interface received bytes." >> "$TMP_FILE"
                echo "# TYPE node_network_receive_bytes_total counter" >> "$TMP_FILE"
                echo "# HELP node_network_transmit_bytes_total Host interface transmitted bytes." >> "$TMP_FILE"
                echo "# TYPE node_network_transmit_bytes_total counter" >> "$TMP_FILE"
                has_net_header=1
            fi
            echo "node_network_receive_bytes_total{interface=\"$iface\"}  $rx_bytes" >> "$TMP_FILE"
            echo "node_network_transmit_bytes_total{interface=\"$iface\"} $tx_bytes" >> "$TMP_FILE"
        done < /proc/net/dev

        # 1i. Disk Space (per mount point)
        has_disk_header=0
        while IFS= read -r line; do
            mountpoint=$(echo "$line" | awk '{print $6}')
            # only real filesystems — skip pseudo mounts
            fstype=$(echo "$line" | awk '{print $1}')
            [[ "$fstype" == tmpfs || "$fstype" == devtmpfs || "$fstype" == sysfs || \
               "$fstype" == proc  || "$fstype" == cgroup*  || "$fstype" == overlay ]] && continue
            [[ -z "$mountpoint" ]] && continue

            read -r size_kb used_kb avail_kb _ < <(df -k --output=size,used,avail "$mountpoint" 2>/dev/null | tail -1)
            [[ -z "$size_kb" ]] && continue

            size_bytes=$((size_kb  * 1024))
            used_bytes=$((used_kb  * 1024))
            avail_bytes=$((avail_kb * 1024))
            mp_label="${mountpoint//\"/\\\"}"

            if [[ $has_disk_header -eq 0 ]]; then
                echo "# HELP node_disk_total_bytes Disk total size." >> "$TMP_FILE"
                echo "# TYPE node_disk_total_bytes gauge" >> "$TMP_FILE"
                echo "# HELP node_disk_used_bytes Disk used space." >> "$TMP_FILE"
                echo "# TYPE node_disk_used_bytes gauge" >> "$TMP_FILE"
                echo "# HELP node_disk_available_bytes Disk available space." >> "$TMP_FILE"
                echo "# TYPE node_disk_available_bytes gauge" >> "$TMP_FILE"
                has_disk_header=1
            fi
            echo "node_disk_total_bytes{mountpoint=\"$mp_label\"}     $size_bytes"  >> "$TMP_FILE"
            echo "node_disk_used_bytes{mountpoint=\"$mp_label\"}      $used_bytes"  >> "$TMP_FILE"
            echo "node_disk_available_bytes{mountpoint=\"$mp_label\"} $avail_bytes" >> "$TMP_FILE"
        done < /proc/mounts

        # 1j. Disk I/O (from /proc/diskstats — physical devices only)
        has_diskio_header=0
        while read -r _ _ dev reads _ sectors_read _ writes _ sectors_written _; do
            # skip loop, ram, dm devices; keep sd*, nvme*, vd*, xvd*
            [[ "$dev" =~ ^(loop|ram|dm) ]] && continue
            [[ "$dev" =~ ^(sd|nvme|vd|xvd) ]] || continue
            read_bytes=$((sectors_read    * 512))
            write_bytes=$((sectors_written * 512))
            if [[ $has_diskio_header -eq 0 ]]; then
                echo "# HELP node_disk_read_bytes_total Disk bytes read." >> "$TMP_FILE"
                echo "# TYPE node_disk_read_bytes_total counter" >> "$TMP_FILE"
                echo "# HELP node_disk_written_bytes_total Disk bytes written." >> "$TMP_FILE"
                echo "# TYPE node_disk_written_bytes_total counter" >> "$TMP_FILE"
                has_diskio_header=1
            fi
            echo "node_disk_read_bytes_total{device=\"$dev\"}    $read_bytes"  >> "$TMP_FILE"
            echo "node_disk_written_bytes_total{device=\"$dev\"} $write_bytes" >> "$TMP_FILE"
        done < /proc/diskstats

        # =====================================================================
        # 2. NGINX STUB_STATUS METRICS
        # =====================================================================
        log DEBUG "Fetching nginx stub_status from $NGINX_STATUS_URL"
        nginx_body=$(curl -sf --max-time 2 "$NGINX_STATUS_URL" 2>/dev/null)
        if [[ -z "$nginx_body" ]]; then
            log WARN "nginx stub_status unreachable at $NGINX_STATUS_URL (skipping nginx metrics this cycle)"
        fi
        if [[ -n "$nginx_body" ]]; then
            nginx_active=$(echo "$nginx_body"  | awk '/^Active connections:/ {print $3}')
            nginx_accepts=$(echo "$nginx_body" | awk 'NR==3 {print $1}')
            nginx_handled=$(echo "$nginx_body" | awk 'NR==3 {print $2}')
            nginx_requests=$(echo "$nginx_body"| awk 'NR==3 {print $3}')
            nginx_reading=$(echo "$nginx_body" | awk '/Reading:/ {print $2}')
            nginx_writing=$(echo "$nginx_body" | awk '/Reading:/ {print $4}')
            nginx_waiting=$(echo "$nginx_body" | awk '/Reading:/ {print $6}')

            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_active Number of active client connections including waiting.
# TYPE nginx_connections_active gauge
EOF
            echo "nginx_connections_active $nginx_active"   >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_accepted_total Total accepted connections.
# TYPE nginx_connections_accepted_total counter
EOF
            echo "nginx_connections_accepted_total $nginx_accepts"  >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_handled_total Total handled connections.
# TYPE nginx_connections_handled_total counter
EOF
            echo "nginx_connections_handled_total $nginx_handled"   >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_http_requests_total Total client requests.
# TYPE nginx_http_requests_total counter
EOF
            echo "nginx_http_requests_total $nginx_requests"        >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_reading Connections where nginx is reading the request header.
# TYPE nginx_connections_reading gauge
EOF
            echo "nginx_connections_reading $nginx_reading"         >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_writing Connections where nginx is writing a response.
# TYPE nginx_connections_writing gauge
EOF
            echo "nginx_connections_writing $nginx_writing"         >> "$TMP_FILE"
            cat >> "$TMP_FILE" <<'EOF'
# HELP nginx_connections_waiting Idle keepalive connections.
# TYPE nginx_connections_waiting gauge
EOF
            echo "nginx_connections_waiting $nginx_waiting"         >> "$TMP_FILE"
        fi

        # =====================================================================
        # 3. POSTGRESQL METRICS
        # =====================================================================

        TAB=$'\t'
        PSQL=(psql -tAX -F "$TAB" -v ON_ERROR_STOP=1)

        log DEBUG "Querying Postgres at ${PGHOST:-unset}:${PGPORT:-unset}/${PGDATABASE:-unset} as ${PGUSER:-unset}"

        # 3a. Connections in use vs max_connections (the #1 "why did prod fall over" metric)
        pg_conn_out=$("${PSQL[@]}" -c "
            SELECT
                (SELECT count(*) FROM pg_stat_activity),
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
                (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
                (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction')
        " 2>/tmp/pg_err.log)
        pg_status=$?
        if [[ $pg_status -ne 0 ]]; then
            log ERROR "Postgres connection/query failed (exit=$pg_status): $(tr '\n' ' ' < /tmp/pg_err.log)"
        fi
        if [[ $pg_status -eq 0 && -n "$pg_conn_out" ]]; then
            log DEBUG "Postgres reachable, collecting database metrics"
            IFS=$'\t' read -r pg_conns pg_max_conns pg_active pg_idle_in_txn <<< "$pg_conn_out"
            echo "# HELP pg_connections_used Current number of connections to the database." >> "$TMP_FILE"
            echo "# TYPE pg_connections_used gauge" >> "$TMP_FILE"
            echo "pg_connections_used $pg_conns" >> "$TMP_FILE"
            echo "# HELP pg_connections_max Configured max_connections." >> "$TMP_FILE"
            echo "# TYPE pg_connections_max gauge" >> "$TMP_FILE"
            echo "pg_connections_max $pg_max_conns" >> "$TMP_FILE"
            echo "# HELP pg_connections_active Connections currently executing a query." >> "$TMP_FILE"
            echo "# TYPE pg_connections_active gauge" >> "$TMP_FILE"
            echo "pg_connections_active $pg_active" >> "$TMP_FILE"
            echo "# HELP pg_connections_idle_in_transaction Connections idle inside an open transaction (leak indicator)." >> "$TMP_FILE"
            echo "# TYPE pg_connections_idle_in_transaction gauge" >> "$TMP_FILE"
            echo "pg_connections_idle_in_transaction $pg_idle_in_txn" >> "$TMP_FILE"

            if [[ "$pg_max_conns" -gt 0 ]]; then
                conn_pct=$(awk -v u="$pg_conns" -v m="$pg_max_conns" 'BEGIN{printf "%.0f", (u/m)*100}')
                if [[ "$conn_pct" -ge 80 ]]; then
                    log WARN "Postgres connections at ${conn_pct}% of max_connections ($pg_conns/$pg_max_conns)"
                fi
            fi
            if [[ "$pg_idle_in_txn" -ge 5 ]]; then
                log WARN "Postgres has $pg_idle_in_txn connections idle-in-transaction (possible leak)"
            fi

            # 3b. Per-database size, transactions, cache hit ratio, deadlocks, temp files
            echo "# HELP pg_database_size_bytes Size of each database on disk." >> "$TMP_FILE"
            echo "# TYPE pg_database_size_bytes gauge" >> "$TMP_FILE"
            echo "# HELP pg_xact_commit_total Committed transactions per database." >> "$TMP_FILE"
            echo "# TYPE pg_xact_commit_total counter" >> "$TMP_FILE"
            echo "# HELP pg_xact_rollback_total Rolled-back transactions per database." >> "$TMP_FILE"
            echo "# TYPE pg_xact_rollback_total counter" >> "$TMP_FILE"
            echo "# HELP pg_cache_hit_ratio Fraction of reads served from shared_buffers (0-1). Low values mean shared_buffers is too small." >> "$TMP_FILE"
            echo "# TYPE pg_cache_hit_ratio gauge" >> "$TMP_FILE"
            echo "# HELP pg_deadlocks_total Deadlocks detected per database." >> "$TMP_FILE"
            echo "# TYPE pg_deadlocks_total counter" >> "$TMP_FILE"
            echo "# HELP pg_temp_files_total Temp files created per database (query spilling to disk)." >> "$TMP_FILE"
            echo "# TYPE pg_temp_files_total counter" >> "$TMP_FILE"
            echo "# HELP pg_temp_bytes_total Temp file bytes written per database." >> "$TMP_FILE"
            echo "# TYPE pg_temp_bytes_total counter" >> "$TMP_FILE"

            "${PSQL[@]}" -c "
                SELECT
                    datname,
                    pg_database_size(datname),
                    xact_commit,
                    xact_rollback,
                    CASE WHEN (blks_hit + blks_read) = 0 THEN 1
                         ELSE round(blks_hit::numeric / (blks_hit + blks_read), 4)
                    END,
                    deadlocks,
                    temp_files,
                    temp_bytes
                FROM pg_stat_database
                WHERE datname NOT IN ('template0', 'template1')
            " 2>/dev/null | while IFS=$'\t' read -r dbname dbsize commits rollbacks hitratio deadlocks tempfiles tempbytes; do
                [[ -z "$dbname" ]] && continue
                dbname_label="${dbname//\"/\\\"}"
                echo "pg_database_size_bytes{database=\"$dbname_label\"} $dbsize"     >> "$TMP_FILE"
                echo "pg_xact_commit_total{database=\"$dbname_label\"} $commits"      >> "$TMP_FILE"
                echo "pg_xact_rollback_total{database=\"$dbname_label\"} $rollbacks"  >> "$TMP_FILE"
                echo "pg_cache_hit_ratio{database=\"$dbname_label\"} $hitratio"       >> "$TMP_FILE"
                echo "pg_deadlocks_total{database=\"$dbname_label\"} $deadlocks"      >> "$TMP_FILE"
                echo "pg_temp_files_total{database=\"$dbname_label\"} $tempfiles"     >> "$TMP_FILE"
                echo "pg_temp_bytes_total{database=\"$dbname_label\"} $tempbytes"     >> "$TMP_FILE"
            done

            # 3c. Table bloat indicator: dead tuples per table (top offenders only, capped at 20)
            echo "# HELP pg_table_dead_tuples Estimated dead (unvacuumed) tuples per table." >> "$TMP_FILE"
            echo "# TYPE pg_table_dead_tuples gauge" >> "$TMP_FILE"
            echo "# HELP pg_table_seconds_since_vacuum Seconds since last autovacuum ran on the table." >> "$TMP_FILE"
            echo "# TYPE pg_table_seconds_since_vacuum gauge" >> "$TMP_FILE"

            "${PSQL[@]}" -c "
                SELECT
                    schemaname || '.' || relname,
                    n_dead_tup,
                    COALESCE(EXTRACT(EPOCH FROM (now() - GREATEST(last_vacuum, last_autovacuum)))::bigint, -1)
                FROM pg_stat_user_tables
                ORDER BY n_dead_tup DESC
                LIMIT 20
            " 2>/dev/null | while IFS=$'\t' read -r tablename deadtup vacuumage; do
                [[ -z "$tablename" ]] && continue
                table_label="${tablename//\"/\\\"}"
                echo "pg_table_dead_tuples{table=\"$table_label\"} $deadtup"              >> "$TMP_FILE"
                echo "pg_table_seconds_since_vacuum{table=\"$table_label\"} $vacuumage"    >> "$TMP_FILE"
            done

            # 3d. Replication lag (only emits rows if this instance has replicas/standbys)
            pg_repl_out=$("${PSQL[@]}" -c "
                SELECT application_name,
                       COALESCE(EXTRACT(EPOCH FROM replay_lag)::numeric, 0)
                FROM pg_stat_replication
            " 2>/dev/null)
            if [[ $? -eq 0 && -n "$pg_repl_out" ]]; then
                echo "# HELP pg_replication_lag_seconds Replication lag to each connected standby." >> "$TMP_FILE"
                echo "# TYPE pg_replication_lag_seconds gauge" >> "$TMP_FILE"
                echo "$pg_repl_out" | while IFS=$'\t' read -r appname lagsec; do
                    [[ -z "$appname" ]] && continue
                    app_label="${appname//\"/\\\"}"
                    echo "pg_replication_lag_seconds{standby=\"$app_label\"} $lagsec" >> "$TMP_FILE"
                done
            fi

            # 3e. Locks currently held/waited on (blocking query indicator)
            pg_locks_out=$("${PSQL[@]}" -c "
                SELECT count(*) FILTER (WHERE granted),
                       count(*) FILTER (WHERE NOT granted)
                FROM pg_locks
            " 2>/dev/null)
            if [[ $? -eq 0 && -n "$pg_locks_out" ]]; then
                IFS=$'\t' read -r pg_locks_granted pg_locks_waiting <<< "$pg_locks_out"
                echo "# HELP pg_locks_granted Locks currently granted." >> "$TMP_FILE"
                echo "# TYPE pg_locks_granted gauge" >> "$TMP_FILE"
                echo "pg_locks_granted $pg_locks_granted" >> "$TMP_FILE"
                echo "# HELP pg_locks_waiting Locks currently waiting to be granted (contention indicator)." >> "$TMP_FILE"
                echo "# TYPE pg_locks_waiting gauge" >> "$TMP_FILE"
                echo "pg_locks_waiting $pg_locks_waiting" >> "$TMP_FILE"
            fi
        fi

        # =====================================================================
        # 4. DOCKER CONTAINER METRICS
        # =====================================================================
        curl -s --unix-socket "$SOCKET" http://localhost/containers/json | \
            jq -r '.[] | [.Id, (.Names[0] | ltrimstr("/")), .Image, (.Id[:12])] | @tsv' \
            > /tmp/ids.tmp 2>/dev/null

        container_count=$(wc -l < /tmp/ids.tmp 2>/dev/null || echo 0)
        if [[ "$container_count" -eq 0 ]]; then
            log WARN "No containers found via Docker socket at $SOCKET (is it mounted/reachable?)"
        else
            log DEBUG "Found $container_count containers to scrape"
        fi

        while IFS=$'\t' read -r clean_id name image short_id || [[ -n "$clean_id" ]]; do
            [[ -z "$clean_id" ]] && continue
            stats_json=$(curl -s --unix-socket "$SOCKET" \
                "http://localhost/containers/${clean_id}/stats?stream=false")
            if [[ -z "$stats_json" ]]; then
                log WARN "No stats returned for container $name ($short_id)"
            fi
            echo "$stats_json" | jq -r --arg id "$clean_id" --arg name "$name" --arg image "$image" --arg short_id "$short_id" '
                def labels: "{container=\"" + $name + "\",id=\"" + $id + "\",image=\"" + $image + "\"}";
                "container_memory_usage_bytes"              + labels + " " + (.memory_stats.usage // 0 | tostring),
                "container_memory_limit_bytes"             + labels + " " + (.memory_stats.limit // 0 | tostring),
                "container_cpu_usage_total_nanoseconds"    + labels + " " + (.cpu_stats.cpu_usage.total_usage // 0 | tostring),
                "container_cpu_system_usage_nanoseconds"   + labels + " " + (.cpu_stats.system_cpu_usage // 0 | tostring),
                "container_network_receive_bytes_total"    + labels + " " + (.networks.eth0.rx_bytes // 0 | tostring),
                "container_network_transmit_bytes_total"   + labels + " " + (.networks.eth0.tx_bytes // 0 | tostring),
                "container_blkio_io_service_bytes_total"   + labels + " " + (
                    [.blkio_stats.io_service_bytes_recursive[]?.value] | add // 0 | tostring
                )
            ' >> "$TMP_FILE" 2>/dev/null

            # 4a. Container restart count + OOM killed flag
            curl -s --unix-socket "$SOCKET" \
                "http://localhost/containers/${clean_id}/json" | \
            jq -r --arg name "$name" --arg image "$image" --arg id "$clean_id" '
                "container_restart_count{container=\"" + $name + "\",image=\"" + $image + "\"} " + (.RestartCount // 0 | tostring),
                "container_oom_killed{container=\""    + $name + "\",image=\"" + $image + "\"} " + (if .State.OOMKilled then "1" else "0" end),
                "container_running{container=\""       + $name + "\",image=\"" + $image + "\"} " + (if .State.Running  then "1" else "0" end),
                "container_started_at_seconds{container=\"" + $name + "\",image=\"" + $image + "\"} " + (.State.StartedAt | if . then (gsub("\\.[0-9]+Z$";"Z") | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime | tostring) else "0" end)
            ' >> "$TMP_FILE" 2>/dev/null
        done < /tmp/ids.tmp

        cat >> "$TMP_FILE" <<'EOF'
# HELP container_restart_count Number of times the container has restarted.
# TYPE container_restart_count gauge
# HELP container_oom_killed 1 if container was OOM killed.
# TYPE container_oom_killed gauge
# HELP container_running 1 if container is currently running.
# TYPE container_running gauge
# HELP container_started_at_seconds Unix timestamp when container last started.
# TYPE container_started_at_seconds gauge
EOF

        # Atomic swap: write to a temp file inside the web root, then rename.
        # rename() is atomic on the same filesystem, so httpd never serves a
        # half-written file, and there's no listen/accept race like with `nc`.
        cp "$TMP_FILE" "$WEB_ROOT/.metrics.tmp"
        mv "$WEB_ROOT/.metrics.tmp" "$DATA_FILE"

        cycle_end=$(date +%s.%N)
        cycle_dur=$(awk -v a="$cycle_start" -v b="$cycle_end" 'BEGIN{printf "%.2f", b-a}')
        metric_lines=$(grep -vc '^#' "$DATA_FILE" 2>/dev/null || echo 0)
        log INFO "Cycle $cycle complete: ${metric_lines} metric lines written in ${cycle_dur}s"

        sleep 5
    done
}

serve() {
    cat > "$WEB_ROOT/httpd.conf" <<'EOF'
.prom:text/plain
EOF
    log INFO "Starting busybox httpd on port $PORT, serving $WEB_ROOT (target: $DATA_FILE)"
    exec httpd -f -p "$PORT" -h "$WEB_ROOT" -c "$WEB_ROOT/httpd.conf"
}

collect_data &
COLLECTOR_PID=$!
trap "log INFO 'Received shutdown signal, stopping collector (PID $COLLECTOR_PID)'; kill $COLLECTOR_PID 2>/dev/null; exit" SIGINT SIGTERM

log INFO "Waiting for initial data collection..."
sleep 6
log INFO "Metrics server running on port $PORT (busybox httpd, serving $DATA_FILE)"
log INFO "Scrape target should be configured as: http://<host>:$PORT/metrics.prom"
log INFO "Logs: stderr (docker logs) and $LOG_FILE"
serve