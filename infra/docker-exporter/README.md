# Docker dashboard exporter

This exporter collects only the nine metrics used by the provisioned Grafana
Docker Metrics and Microservices Overview dashboards. It reads running containers
through the Docker socket and uptime from `/proc/uptime`, refreshing the metrics
file every five seconds. Prometheus scrapes `http://docker-exporter:8090/metrics.prom`.

## Run

From the repository root:

```bash
docker compose up -d --build docker-exporter
```

Compose mounts `${DOCKER_SOCK:-/var/run/docker.sock}` at `/var/run/docker.sock`.
Set `DOCKER_SOCK` to your daemon socket path when using rootless Docker.
The exporter needs no database credentials or application environment file.

## Exported metrics

| Metric | Dashboard use |
| --- | --- |
| `node_uptime_seconds_total` | System uptime |
| `container_memory_usage_bytes` | Memory usage, total memory, container count and selector |
| `container_memory_limit_bytes` | Memory utilization ratio |
| `container_cpu_usage_total_nanoseconds` | Container CPU utilization |
| `container_cpu_system_usage_nanoseconds` | System-normalized container CPU utilization |
| `container_network_receive_bytes_total` | Incoming traffic on eth0 |
| `container_network_transmit_bytes_total` | Outgoing traffic on eth0 |
| `container_blkio_io_service_bytes_total` | Block I/O throughput |
| `container_restart_count` | Restart totals and per-container restart counts |

Container stats retain the `container`, `id`, and `image` labels. Restart counts
retain `container` and `image`. Uptime has no labels. Metrics are published with
an atomic file replacement so scrapes do not read partially written data.

Host CPU, temperature, power, memory, disk and network collectors, PostgreSQL
queries, and duplicate Nginx collection are removed. Nginx has its own exporter.
The container-down and OOM alert rules are also removed because their metrics
are outside the dashboard scope. Service availability, CPU and memory alerts
continue using retained metrics or Prometheus's `up` metric.

## Troubleshooting

```bash
docker compose logs docker-exporter
docker compose exec docker-exporter curl -fsS http://localhost:8090/metrics.prom
```

Errors go to stderr (`docker compose logs`); there is no separate log file.
If Docker container discovery fails, the metrics file is removed until a
successful collection so Prometheus does not keep scraping stale data. Check
that the socket is mounted and accessible. A container disappearing during
collection is skipped for the failed request and retried on the next cycle.
