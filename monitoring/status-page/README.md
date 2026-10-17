# System Health Status Page (Gatus)

This directory contains the configuration for the lightweight status dashboard engine (powered by [Gatus](https://github.com/TwiN/gatus)).

---

## Overview

The status service continuously monitors internal endpoints across core ingress, microservices, databases, and observability tooling every 10 seconds.

---

## Monitored Endpoints

| Group | Target Endpoint | Health Evaluation Criteria |
| :--- | :--- | :--- |
| **Core Ingress** | API Gateway (`http://nginx:80/nginx_status`) | HTTP `200` |
| **Core Ingress** | Frontend UI (`http://frontend:80/`) | HTTP `200` |
| **Microservices**| Identity Service (`http://identity-service:8083/health`) | HTTP `200`, `[BODY].status == ok`, `[BODY].service == identity-service` |
| **Microservices**| Org Service (`http://org-service:8082/actuator/health`) | HTTP `200` & `[BODY].status == UP` |
| **Microservices**| Chat Service (`http://chat-service:8081/actuator/health`) | HTTP `200` |
| **Databases**    | Identity PostgreSQL (`tcp://postgres_db:5432`) | TCP Connection Handshake |
| **Databases**    | Organization PostgreSQL (`tcp://org-service_postgres:5432`) | TCP Connection Handshake |
| **Databases**    | MongoDB (`tcp://mongodb:27017`) | TCP Connection Handshake |
| **Observability**| Prometheus (`http://prometheus:9090/-/healthy`) | HTTP `200` |
| **Observability**| Grafana (`http://grafana:3000/api/health`) | HTTP `200` |

---

## Access & Security

The status dashboard is served behind HTTP Basic Authentication:
- **URL:** `https://status.${DOMAIN}/`
- **Authentication:** Evaluated against bcrypt hash in environment variable `STATUS_PAGE_PASSWORD_BCRYPT_BASE64`.

For local development, use `https://status.localhost/` (resolves to loopback
in modern browsers). `make status` sets the local hostname explicitly for curl.
Production requires a DNS record for `status.${DOMAIN}` and a certificate
covering that name. Gatus owns routes only on this hostname, so its asset and API
paths do not interfere with application routes.
