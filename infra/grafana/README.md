# Grafana Visualization Stack

This directory contains the Grafana provisioning configuration, pre-loaded dashboards, and custom minimal container definition for `ft_transcendence`.

---

## Minimal Container Architecture (`Dockerfile`)

To optimize container image size and reduce unnecessary dependencies in restricted environments (e.g. 42 Network), Grafana is built using a multi-stage Docker build:
- Prunes all non-essential datasource plugins except for Prometheus.
- Runs under rootless user `472` (standard Grafana UID).

---

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
| **Docker & Host Metrics** | `docker-metrics.json` | Host CPU package power (RAPL), core temperatures, memory utilization, disk I/O, network traffic, per-container CPU/RAM limits, and container restarts |

Access Grafana at:
```
https://guild-chat.tech/grafana/
```
*(Default credentials managed via `.env`: `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`)*
