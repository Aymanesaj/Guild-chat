# Infrastructure

Monitoring, alerting, database initialization, and automated backups for
`ft_transcendence`. Services are configured in
[`docker-compose.yml`](../docker-compose.yml).

| Directory | Purpose |
| --- | --- |
| [backup/](backup/README.md) | Scheduled PostgreSQL and MongoDB backups with retention cleanup. |
| [docker-exporter/](docker-exporter/README.md) | Container CPU, memory, network, disk I/O, restart, and uptime metrics at `/metrics.prom`, plus collection-health metrics. Reads Docker through the socket proxy. |
| [grafana/](grafana/README.md) | Provisioned Prometheus datasource and dashboards for microservices and containers, using the standard Grafana image. |
| [postgres/](postgres/init/) | SQL initialization scripts for the PostgreSQL databases. |
| [prometheus/](prometheus/README.md) | Scraping for Spring services and exporters, alert rules, and Discord notifications through Alertmanager. |
| [status/](status/README.md) | Gatus HTTP and TCP health checks, served at `https://status.${DOMAIN}/` with Basic Authentication. |

Use [`.env.example`](../.env.example) as the configuration reference. Each
component's README explains its setup and operation.
