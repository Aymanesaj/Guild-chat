# Metrics Exporter

A lightweight Prometheus exporter that collects system metrics from:
- **Host hardware** (CPU, memory, disk, uptime)
- **Docker containers** (via Docker socket)
- **PostgreSQL database** (connection stats, query performance)
- **Nginx** (HTTP request metrics, optional)

Optimized for rootless environments and restricted environments like the **42 Network**.

## 🚀 Quick Start

### With Docker Compose (Recommended)

Use the included Dockerfile with your `docker-compose.yml`:

```yaml
services:
  exporter:
    build: ./infra/exporter
    container_name: metrics-exporter
    ports:
      - "8090:8090"
    volumes:
      # Docker socket (adjust for 42 cluster rootless Docker)
      - /var/run/user/${UID}/docker.sock:/var/run/docker.sock
    environment:
      # PostgreSQL connection (libpq standard variables)
      PGHOST: postgres
      PGPORT: 5432
      PGUSER: postgres
      PGPASSWORD: postgres
      PGDATABASE: transdb
      # Exporter settings
      PORT: 8090
      LOG_LEVEL: INFO
      NGINX_STATUS_URL: http://nginx/nginx_status
    restart: always
```

### Direct Docker Run

```bash
docker run -d \
  --name metrics-exporter \
  -p 8090:8090 \
  -v /var/run/user/${UID}/docker.sock:/var/run/docker.sock \
  --network ft_transcendence_default \
  -e PGHOST=postgres \
  -e PGUSER=postgres \
  -e PGPASSWORD=postgres \
  -e PGDATABASE=transdb \
  -e NGINX_STATUS_URL=http://nginx/nginx_status \
  <local-exporter-image>
```

---

## ⚙️ Configuration

### Environment Variables

**PostgreSQL Connection** (libpq standard variables):
- `PGHOST` – PostgreSQL hostname (default: `postgres`)
- `PGPORT` – PostgreSQL port (default: `5432`)
- `PGUSER` – PostgreSQL username (default: `postgres`)
- `PGPASSWORD` – PostgreSQL password
- `PGDATABASE` – PostgreSQL database name (default: `transdb`)

**Exporter Settings**:
- `PORT` – HTTP port for metrics endpoint (default: `8090`)
- `LOG_LEVEL` – Logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`)
- `NGINX_STATUS_URL` – Nginx metrics endpoint (optional, default: `http://nginx/nginx_status`)

Copy `.env.example` to `.env` and customize for your environment.

---

## 📊 Metrics Reference

All metrics are exposed in Prometheus text format at `http://<exporter>:8090/metrics`.

### Host Hardware Metrics
| Metric Name | Description |
| --- | --- |
| `node_uptime_seconds_total` | System uptime in seconds. |
| `node_memory_memtotal_bytes` | Total available memory. |
| `node_memory_memfree_bytes` | Free memory. |
| `node_cpu_seconds_total` | CPU time in seconds. |
| `node_disk_reads_completed_total` | Total disk read operations. |
| `node_disk_writes_completed_total` | Total disk write operations. |
| `node_network_receive_bytes_total` | Total network bytes received. |
| `node_network_transmit_bytes_total` | Total network bytes transmitted. |

### Docker Container Metrics
| Metric Name | Description |
| --- | --- |
| `container_memory_usage_bytes` | Current memory usage of the container. |
| `container_memory_limit_bytes` | Memory limit assigned to the container. |
| `container_cpu_usage_total_nanoseconds` | Total CPU time consumed. |
| `container_cpu_system_usage_nanoseconds` | System CPU usage. |
| `container_network_receive_bytes_total` | Incoming network traffic (eth0). |
| `container_network_transmit_bytes_total` | Outgoing network traffic (eth0). |
| `container_blkio_io_service_bytes_total` | Total Block I/O (Sum of all service bytes). |

### PostgreSQL Metrics
| Metric Name | Description |
| --- | --- |
| `pg_up` | PostgreSQL connection status (1=up, 0=down). |
| `pg_connections_current` | Current active connections. |
| `pg_connections_max` | Maximum allowed connections. |
| `pg_database_size_bytes` | Database size in bytes. |
| `pg_blocks_read_total` | Total disk blocks read. |
| `pg_sequential_scans_total` | Total sequential table scans. |
| `pg_index_scans_total` | Total index scans. |

### Nginx Metrics (if enabled)
| Metric Name | Description |
| --- | --- |
| `nginx_requests_total` | Total HTTP requests. |
| `nginx_connections_active` | Active connections. |
| `nginx_connections_reading` | Connections reading requests. |
| `nginx_connections_writing` | Connections writing responses. |

---
## 📝 Usage with Prometheus

Add to your `prometheus.yml` scrape config:

```yaml
scrape_configs:
  - job_name: 'exporter'
    static_configs:
      - targets: ['exporter:8090']
    scrape_interval: 15s
    scrape_timeout: 10s
```

Then query metrics in Prometheus:
- CPU usage: `container_cpu_usage_total_nanoseconds`
- Memory: `container_memory_usage_bytes`
- Network: `container_network_receive_bytes_total`
- DB connections: `pg_connections_current`

---

## ⚙️ Requirements

* **Docker Engine** (Rootless or Standard)
* **PostgreSQL** (optional, for DB metrics)
* **Nginx** (optional, for HTTP metrics)
* **42 Cluster:** Ensure your session is active (`docker ps` should work without sudo).

---

## 🔧 Troubleshooting

- **Cannot connect to Docker socket:** Verify the socket path is correctly mounted (use `docker ps` to test access)
- **PostgreSQL connection fails:** Check `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` in `.env`
- **No metrics appear:** Check logs with `docker compose logs exporter` or set `LOG_LEVEL=DEBUG`
- **Nginx metrics missing:** Verify nginx `/nginx_status` endpoint is accessible and `NGINX_STATUS_URL` is correct
