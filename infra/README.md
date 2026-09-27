# Infrastructure & Observability Suite

This directory contains the operational infrastructure, metrics monitoring, alerting pipelines, automated backup daemons, and database provisioning modules for `ft_transcendence`.

---

## Directory Architecture

```
infra/
├── backup/           # Automated background database backup daemon
├── docker-exporter/  # Custom lightweight hardware & container metrics exporter
├── grafana/          # Visual dashboards and auto-provisioned datasources
├── postgres/         # Initial database schemas and init scripts
├── prometheus/       # Metric scrapers, alert evaluation rules, and Alertmanager
├── status/           # Gatus real-time system status page
└── vault/            # Secrets management configuration
```

---

## Component Summaries

### 1. [Backup Daemon (`infra/backup/`)](file:///home/seraph/dev/ft_transcendence/infra/backup/README.md)
Autonomous Alpine container that continuously snapshots PostgreSQL and MongoDB databases on a configurable schedule (default every 12 hours) and prunes snapshots older than 7 days.

### 2. [Docker Exporter (`infra/docker-exporter/`)](file:///home/seraph/dev/ft_transcendence/infra/docker-exporter/README.md)
Bash-based native metrics exporter running on port `8090`. It queries `/proc` and `/sys` for host hardware metrics (CPU RAPL power, core temps, RAM, disk I/O), inspects the Docker UNIX socket for container CPU/RAM/restart statistics, and queries PostgreSQL for connection pools and transaction performance.

### 3. [Prometheus & Alertmanager (`infra/prometheus/`)](file:///home/seraph/dev/ft_transcendence/infra/prometheus/README.md)
Collects operational telemetry across all microservices and exporters. Contains rules for automatic detection of down services, OOM kills, container restarts, and high 5xx error rates, dispatching live webhook notifications to Discord.

### 4. [Grafana (`infra/grafana/`)](file:///home/seraph/dev/ft_transcendence/infra/grafana/README.md)
Multi-stage slim container preloaded with Prometheus datasources and interactive dashboards:
- **Microservices Overview**: HTTP request rates, response latency, JVM heap memory, and GC activity.
- **Docker Metrics**: Host system load, core temperatures, memory footprint, container CPU/RAM utilization.

### 5. [Status Page (`infra/status/`)](file:///home/seraph/dev/ft_transcendence/infra/status/README.md)
Real-time service health board powered by Gatus, testing HTTP endpoints and TCP ports every 10 seconds. Protected with HTTP Basic Auth.

### 6. Database Provisioning (`infra/postgres/`)
Contains startup SQL scripts (`01-create-org-service-db.sql`) mounted into PostgreSQL `/docker-entrypoint-initdb.d/` to initialize secondary databases on container initialization.
