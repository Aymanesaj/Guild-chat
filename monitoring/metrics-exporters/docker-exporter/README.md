# Docker dashboard exporter

The exporter serves Docker metrics at `http://docker-exporter:8090/metrics.prom`.
Prometheus scrapes every 15 seconds. The collector waits five seconds between
collections and uses four workers, with a three-second timeout per Docker request.
It requests one-shot stats and publishes complete snapshots using atomic file replacement.

## Docker access

The exporter runs as "user" and has no Docker socket mount. It queries
`docker-socket-proxy:2375` over the internal `docker-metrics` network. Only these
two services join that network; the proxy publishes no host port.

The proxy permits container reads and blocks writes and unrelated API sections.
It still has privileged access to the Docker socket; a read-only socket mount
alone does not make the Docker API read-only. Container inspection can include
sensitive environment values, so the proxy must remain isolated.

Compose mounts `${DOCKER_SOCK:-/var/run/docker.sock}` into the proxy. Set
`DOCKER_SOCK` for rootless Docker, or use `make`, which detects the socket.

```bash
docker compose up -d --build docker-exporter
```

## Metrics

| Metric | Meaning |
| --- | --- |
| `node_uptime_seconds_total` | System uptime |
| `container_memory_usage_bytes` | Memory usage |
| `container_memory_limit_bytes` | Memory limit reported by Docker |
| `container_cpu_usage_total_nanoseconds` | Container CPU counter |
| `container_cpu_system_usage_nanoseconds` | Host CPU counter used for normalization |
| `container_network_receive_bytes_total` | Bytes received on eth0 |
| `container_network_transmit_bytes_total` | Bytes sent on eth0 |
| `container_blkio_io_service_bytes_total` | Block I/O bytes |
| `container_restart_count` | Restart count |
| `docker_exporter_collection_success` | 1 for a complete collection, otherwise 0 |
| `docker_exporter_last_success_timestamp_seconds` | Last complete collection time; 0 before first success |

Container stats retain `container`, `id`, and `image` labels. Restart counts
retain `container` and `image`. The exporter reports all running containers visible
to Docker; Compose memory budgets apply only to this project's services.

## Failures and checks

On startup and collection failure, the endpoint serves health metrics with HTTP
200. It drops container measurements after any failed request or malformed stats,
including partial collection failures, rather than presenting old values as fresh.
A container disappearing during collection can cause one failed cycle. An empty
Docker host is a successful collection with no container measurements.

`DockerExporterUnhealthy` alerts when collection fails, the last success becomes
stale, or Prometheus cannot scrape the exporter. HTTP health checks indicate server
availability; the collection-health metrics indicate whether Docker data is usable.

```bash
docker compose logs docker-exporter docker-socket-proxy
docker compose exec docker-exporter curl -fsS http://localhost:8090/metrics.prom
bash monitoring/scripts/test-monitoring.sh
```

Tests exercise successful collection, the four-worker bound, Docker discovery and
partial failures, malformed responses, recovery, and an empty Docker host.
