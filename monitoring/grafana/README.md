# Grafana Visualization Stack

This directory contains Grafana provisioning and dashboards for `ft_transcendence`.
Compose uses `grafana/grafana:13.0.3-slim` directly with its default non-root user.
The previous pruning build copied files over an intact base image, so it did not
remove plugins from the final image. There is no custom Grafana build now.

## Datasource Auto-Provisioning (`datasources/prometheus.yml`)

Grafana connects to both services automatically:

| Data source | URL | Purpose |
| --- | --- | --- |
| **Prometheus** (default) | `http://prometheus:9090` | Metrics, dashboards, and alert state history |
| **Alertmanager** | `http://alertmanager:9093` | Notification policies, contact points, and silences |

Both connections use server access (`proxy`) over the private Docker network.
Their settings are managed in `datasources/prometheus.yml`.

After updating this file on a running installation, reload it by restarting Grafana:

```bash
docker compose restart grafana
```

In Grafana's **Alerting** section, open **Silences**, **Contact points**, or
**Notification policies** and select **Alertmanager** in the **Choose Alertmanager**
menu. Silences temporarily mute notifications, for example during maintenance.
Contact points and notification policies are read-only for Prometheus Alertmanager;
edit `monitoring/prometheus/alertmanager.yml` to change them.

Prometheus continues evaluating the rules in `monitoring/prometheus/alert_rules.yml`.
Receiving Grafana-managed alerts is disabled for this data source. For dashboard
panels showing firing alerts, query `ALERTS{alertstate="firing"}` through Prometheus.
See the [Grafana Alertmanager documentation](https://grafana.com/docs/grafana/latest/datasources/alertmanager/).

---

## Provisioned Dashboards (`dashboards/`)

The dashboard provider automatically loads and continuously syncs dashboards from JSON definitions in this directory:

| Dashboard | File | Metrics & Visualizations |
| :--- | :--- | :--- |
| **Microservices Overview** | `microservices-dashboard.json` | Service health, firing-alert count, active alerts, HTTP request and error rates, JVM and Node.js heap memory, and container CPU usage |
| **Docker & Host Metrics** | `docker-metrics.json` | System uptime, container CPU and memory utilization, block I/O, network traffic, and container restarts |

Below the service health panel, **Firing Alerts** shows the current count and
**Active Alerts** lists pending and firing alerts with their severity and affected
container or service. Both panels query Prometheus. A pending alert is waiting for
its rule's duration before firing. With no active alerts, the count is `0` and the
table displays **No data**. Silenced alerts still appear; silences mute notifications.

Identity appears in the health, HTTP request rate, HTTP 5xx error rate, and heap
memory panels. Its Fastify metrics use `http_request_duration_seconds_count`
and the `status_code` label. HTTP charts need requests to instrumented routes
and at least two Prometheus scrapes before rates appear.

After changing the Prometheus scrape configuration, validate and reload it:

```bash
docker compose exec -T prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose kill -s SIGHUP prometheus
```

Grafana automatically reloads the dashboard JSON within 10 seconds.

Access Grafana at:
```
https://guild-chat.tech/grafana/
```
*(Default credentials managed via `.env`: `GF_SECURITY_ADMIN_USER`, `GF_SECURITY_ADMIN_PASSWORD`)*
