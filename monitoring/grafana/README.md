# Grafana Visualization Stack

This directory contains Grafana provisioning and dashboards for `ft_transcendence`.
Compose uses `grafana/grafana:13.0.3-slim` directly with its default non-root user.
The previous pruning build copied files over an intact base image, so it did not
remove plugins from the final image. There is no custom Grafana build now.

## Datasource Auto-Provisioning (`datasources/prometheus.yml`)

Grafana is preconfigured to automatically link with the internal Prometheus service without manual UI setup:
- **Datasource Name:** `Prometheus`
- **Type:** `prometheus`
- **URL:** `http://prometheus:9090`
- **Access Mode:** `proxy` (internal server-to-server communication)
- **Editable:** `false` (enforces immutable infrastructure)

---

## Provisioned Dashboards (`dashboards/`)

The dashboard provider automatically loads and continuously syncs dashboards from JSON definitions in this directory:

| Dashboard | File | Metrics & Visualizations |
| :--- | :--- | :--- |
| **Microservices Overview** | `microservices-dashboard.json` | Service health status, HTTP request rates, 2xx/4xx/5xx status breakdowns, JVM heap memory, garbage collection pause times |
| **Docker & Host Metrics** | `docker-metrics.json` | System uptime, container CPU and memory utilization, block I/O, network traffic, and container restarts |

Access Grafana at:
```
https://guild-chat.tech/grafana/
```
*(Default credentials managed via `.env`: `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`)*
