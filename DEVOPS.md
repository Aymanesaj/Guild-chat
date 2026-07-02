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
