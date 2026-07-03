# DevOps Work Done So Far

This repository is currently set up as a Docker Compose-based microservices stack with a reverse proxy, monitoring, logging, and a PostgreSQL database.

## What I set up

- A single `docker compose` stack to start the full environment.
- An `nginx` reverse proxy that exposes the application on one public entry point.
- Three application services split by domain:
  - `frontend`
  - `chat-service`
  - `org-service`
  - `identity-service`
- A PostgreSQL database backed by a named volume.
- Monitoring and observability services:
  - `prometheus`
  - `grafana`
  - `alertmanager`
  - `loki`
  - `promtail`
  - `docker-exporter`
- Health checks for the proxy, database, and exporter.
- Persistent named volumes for database and observability data.

## Current architecture

- `nginx` is the public entry point on port `8000`.
- The frontend and microservices run as separate containers on the private Docker network.
- Nginx routes requests to the correct service based on the path.
- Logs and metrics are being prepared for observability with Prometheus, Grafana, Loki, and Promtail.

## Public endpoints

### Application endpoints through Nginx

- `http://localhost:8000/` - frontend
- `http://localhost:8000/api/users/` - identity service
- `http://localhost:8000/api/orgs/` - org service
- `http://localhost:8000/api/chat/` - chat service
- `http://localhost:8000/ws/chat/` - chat websocket route
- `http://localhost:8000/metrics` - docker exporter metrics
- `http://localhost:8000/nginx_status` - Nginx stub status

### Direct service ports exposed by Compose

- `http://localhost:3000` - Grafana
- `http://localhost:3100` - Loki
- `http://localhost:9090` - Prometheus
- `http://localhost:9093` - Alertmanager
- `http://localhost:5432` - PostgreSQL

## Internal service ports

These services are reachable inside the private Docker network:

- `frontend:8080`
- `chat-service:8081`
- `org-service:8082`
- `identity-service:8083`
- `docker-exporter:8090`

## Operational commands

- `make up` - start the stack in detached mode
- `make build` - rebuild and start the stack
- `make down` - stop the stack
- `make clean` - stop the stack and remove volumes
- `make restart` - restart the stack
- `make logs` - follow container logs
- `make ps` - list running containers

## Notes

- The project currently uses static HTML pages for the frontend and the service placeholders.
- PostgreSQL credentials and Grafana settings are read from `.env`.
- The stack expects `UID` to match the local user so Docker socket access works for the exporter and Promtail setup.

## Container Size Metrics Breakdown

| Service / Container Name | Actual Size (Writable Layer) | Virtual Size (Base Image included) |
| :--- | :--- | :--- |
| `nginx` | **0 B** | 300 MB |
| `org-service` | **0 B** | 47.6 MB |
| `chat-service` | **0 B** | 47.6 MB |
| `identity-service` | **0 B** | 47.6 MB |
| `frontend` | **0 B** | 47.6 MB |
| `promtail` | **52 MB** | 255 MB |
| `docker-exporter` | **25.6 kB** | 19.4 MB |
| `postgres` | **63 B** | 294 MB |
| `prometheus` | **0 B** | 307 MB |
| `alertmanager` | **0 B** | 80.1 MB |
| `loki` | **596 kB** | 157 MB |
| `grafana` | **0 B** | 1.03 GB |