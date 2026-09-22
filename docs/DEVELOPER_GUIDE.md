# Developer & Operations Handbook

Welcome to the `ft_transcendence` Developer & Operations Guide. This handbook explains how the infrastructure components operate under the hood, how traffic moves through the stack, and how to extend, configure, and troubleshoot services locally.

---

## 1. High-Level Architecture & Request Lifecycle

Every client interaction with `ft_transcendence` passes through a secure, multi-layer gateway pipeline before reaching microservices:

```
[Browser / Client]
       │  (HTTPS Port 8443)
       ▼
[Nginx API Gateway] ──────────────────┐
       │                              │
       ├─► 1. SSL/TLS Termination     │ (Unencrypted traffic on :8000
       │                              │  receives 301 redirect to :8443)
       ├─► 2. ModSecurity WAF         │
       │      (OWASP CRS v4 Anomaly   │
       │       Scoring & Blocking)    │
       │                              │
       ├─► 3. Nginx Rate Limiting     │
       │      (20 req/s, Burst 30)    │
       │                              │
       └─► 4. Reverse Proxy Routing ──┘
              │
              ├── /api/users/*, /api/auth/* ──► [identity-service:8083] ──► [postgres:5432]
              ├── /api/orgs/*               ──► [org-service:8082]      ──► [postgres:5432]
              ├── /api/chat/*, /ws/chat     ──► [chat-service:8081]     ──► [mongodb:27017]
              ├── /grafana/* (WAF Bypassed) ──► [grafana:3000]
              ├── /prometheus/* (WAF Bypass)──► [prometheus:9090]
              └── /                         ──► [Static React SPA (/dist)]
```

### Network Topology & Port Map
To maintain zero-trust microservice isolation, **only Nginx exposes ports to the host machine**. All other containers communicate exclusively over the internal Docker network (`private`).

| Service | Internal Hostname | Internal Port | Host Port | Ingress Route |
|---|---|---|---|---|
| **Nginx Gateway (HTTP)** | `nginx` | `80` | `8000` | Redirects to HTTPS |
| **Nginx Gateway (HTTPS)**| `nginx` | `443` | `8443` | Public entry point |
| **Identity Service** | `identity-service` | `8083` | *None (Hidden)* | `/api/users/`, `/api/auth/` |
| **Org Service** | `org-service` | `8082` | *None (Hidden)* | `/api/orgs/` |
| **Chat Service** | `chat-service` | `8081` | *None (Hidden)* | `/api/chat/`, `/ws/chat` |
| **PostgreSQL** | `postgres` | `5432` | *None (Hidden)* | Internal DB only |
| **MongoDB** | `mongodb` | `27017` | *None (Hidden)* | Internal DB only |
| **Grafana** | `grafana` | `3000` | *None (Hidden)* | `/grafana/` |
| **Prometheus** | `prometheus` | `9090` | *None (Hidden)* | `/prometheus/` |
| **Alertmanager** | `alertmanager` | `9093` | *None (Hidden)* | Internal alerting |
| **Docker Exporter** | `docker-exporter` | `8090` | *None (Hidden)* | `/metrics.prom` |
| **Nginx Exporter** | `nginx-exporter` | `9113` | *None (Hidden)* | Internal scrape only |

---

## 2. Daily Development Workflow

The root [`Makefile`](file:///home/seraph/dev/ft_transcendence/Makefile) automates common container operations.

### Quick Start
```bash
# 1. Ensure .env is present (copied from .env.example if not exists)
cp -n .env.example .env

# 2. Build and launch all services in detached mode
make up

# 3. View status of all containers
make ps

# 4. Stream real-time logs
make logs
```

### Targeted Component Commands
Instead of rebuilding the entire stack when editing one service, target specific subsystems:

```bash
# Rebuild & restart only the Gateway (Nginx & WAF)
make proxy

# Rebuild & restart only the Microservices (identity, org, chat)
make microservices

# Rebuild & restart the Observability Stack (grafana, prometheus, exporters, etc.)
make monitoring

# Teardown containers and remove orphaned volumes
make clean
```

---

## 3. How to Work with the API Gateway (Nginx)

The gateway files live in `gateway/`:
- [`gateway/nginx.conf`](file:///home/seraph/dev/ft_transcendence/gateway/nginx.conf): Nginx reverse proxy configuration.
- [`gateway/Dockerfile`](file:///home/seraph/dev/ft_transcendence/gateway/Dockerfile): Builds the frontend React bundle and pairs it with `owasp/modsecurity-crs:nginx`.
- [`gateway/script.sh`](file:///home/seraph/dev/ft_transcendence/gateway/script.sh): Generates SAN SSL certificates and invokes the OWASP CRS entrypoint.
- [`gateway/modsec/modsecurity-override.conf`](file:///home/seraph/dev/ft_transcendence/gateway/modsec/modsecurity-override.conf): Custom ModSecurity rules and bypass definitions.

### How to Add a New Route or Microservice
1. **Define the upstream in `gateway/nginx.conf`**:
   ```nginx
   upstream new-service { server new-service:8084; }
   ```
2. **Add a `location` block inside `server { listen 443 ssl; ... }`**:
   ```nginx
   location /api/new/ {
       limit_req zone=api_limit burst=30 nodelay;
       rewrite ^/api/new/(.*)$ /$1 break;
       proxy_pass http://new-service;
   }
   ```
3. **Add service dependency to `nginx` in `docker-compose.yml`**:
   ```yaml
   nginx:
     depends_on:
       new-service:
         condition: service_healthy
   ```
4. **Apply changes**:
   ```bash
   make proxy
   ```

---

## 4. Understanding & Managing ModSecurity WAF

The Gateway runs **ModSecurity v3** with **OWASP Core Rule Set (CRS v4.25.1)** in **blocking mode** (`SecRuleEngine On`).

### How Anomaly Scoring Works
Unlike simple regex firewalls that block on a single hit, OWASP CRS uses **collaborative anomaly scoring**:
1. Every incoming request is evaluated across multiple security rule sets (SQLi, XSS, RCE, Path Traversal, Protocol Violations, Scanner Detection).
2. Each rule violation contributes a score (e.g., Critical = 5, Error = 4, Warning = 3, Notice = 2).
3. At the end of Phase 2 (Request Body evaluation), `REQUEST-949-BLOCKING-EVALUATION.conf` calculates the total score.
4. If `TX:BLOCKING_INBOUND_ANOMALY_SCORE >= 5`, ModSecurity terminates the request and returns **`403 Forbidden`**.

### How to Inspect Blocked Requests
When a legitimate request is blocked or an attack is intercepted, inspect the Nginx logs:

```bash
docker logs --tail 100 nginx
```

Look for JSON transaction logs or error entries containing:
- `ruleId`: The specific CRS rule triggered (e.g., `942100` for SQLi, `932260` for RCE).
- `data` / `Matched Data`: The exact substring in the URL, header, or body that triggered the rule.
- `uri`: The request path.

### How to Add False-Positive Whitelists / Exclusions
When legitimate functionality triggers a WAF rule (like regex in PromQL or binary WebSocket data):

#### Method A: Disable WAF for an Entire Route in `gateway/nginx.conf`
For trusted administration or internal dashboards (e.g., Grafana):
```nginx
location /internal-dashboard/ {
    modsecurity off;
    proxy_pass http://internal-dashboard;
}
```

#### Method B: Disable Inspection via SecRule in `gateway/modsec/modsecurity-override.conf`
To turn off the rule engine for a specific path pattern:
```apache
SecRule REQUEST_URI "@beginsWith /ws/" \
    "id:10001,phase:1,pass,nolog,ctl:ruleEngine=Off"
```

#### Method C: Disable a Single Rule for a Specific Parameter
If only one parameter on one endpoint triggers a false positive:
```apache
SecRule REQUEST_URI "@beginsWith /api/custom-endpoint" \
    "id:10010,phase:1,pass,nolog,ctl:ruleRemoveTargetById=942100;ARGS:query_param"
```

After modifying `modsecurity-override.conf`, apply with:
```bash
make proxy
```

---

## 5. Monitoring & Instrumenting New Services

### How Prometheus Scrapes Targets
Prometheus is configured in [`infra/prometheus/prometheus.yml`](file:///home/seraph/dev/ft_transcendence/infra/prometheus/prometheus.yml). It periodically sends HTTP GET requests to `/actuator/prometheus` or `/metrics` across all containers.

### Instrumenting a Spring Boot Service (Java)
1. Add dependencies in `pom.xml`:
   ```xml
   <dependency>
       <groupId>org.springframework.boot</groupId>
       <artifactId>spring-boot-starter-actuator</artifactId>
   </dependency>
   <dependency>
       <groupId>io.micrometer</groupId>
       <artifactId>micrometer-registry-prometheus</artifactId>
   </dependency>
   ```
2. Enable the actuator endpoint in `application.yaml`:
   ```yaml
   management:
     endpoints:
       web:
         exposure:
           include: health,info,prometheus
     endpoint:
       prometheus:
         enabled: true
   ```
3. **CRITICAL — Whitelist Actuator in Spring Security**:
   Ensure your `SecurityConfig.java` permits actuator endpoints without authentication, otherwise Prometheus receives `401 Unauthorized` or `403 Forbidden`:
   ```java
   .authorizeHttpRequests(auth -> auth
       .requestMatchers("/actuator/**", "/healthz").permitAll()
       .anyRequest().authenticated()
   )
   ```
   And if using a custom `OncePerRequestFilter` (e.g. `JwtAuthenticationFilter`):
   ```java
   @Override
   protected boolean shouldNotFilter(HttpServletRequest request) {
       return request.getRequestURI().startsWith("/actuator");
   }
   ```

### Instrumenting a Node.js / Express Service (JavaScript/TypeScript)
1. Install `prom-client`:
   ```bash
   npm install prom-client
   ```
2. Register Prometheus metrics endpoint in Express:
   ```javascript
   import client from 'prom-client';
   client.collectDefaultMetrics();

   app.get('/actuator/prometheus', async (req, res) => {
     res.set('Content-Type', client.register.contentType);
     res.send(await client.register.metrics());
   });
   ```

### Registering the Scrape Job in Prometheus
In `infra/prometheus/prometheus.yml`, add under `scrape_configs`:
```yaml
  - job_name: 'new-service'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['new-service:8084']
```

---

## 6. Grafana & Custom Dashboards

- **URL:** `https://localhost:8443/grafana/`
- **Datasource:** Prometheus (`http://prometheus:9090`)
- **Dashboard Auto-Provisioning:**
  - Config file: `infra/grafana/dashboards/provider.yml`
  - Dashboard definitions: `infra/grafana/dashboards/*.json`
- **Adding / Saving Dashboards:**
  1. Build or customize a panel in the Grafana UI.
  2. Click **Dashboard Settings** $\rightarrow$ **JSON Model**.
  3. Save the JSON file into `infra/grafana/dashboards/<your-dashboard>.json`.
  4. Ensure the JSON is strictly valid (no comments or trailing commas). You can validate with:
     ```bash
     python3 -m json.tool infra/grafana/dashboards/<your-dashboard>.json > /dev/null
     ```

---

## 7. Common Troubleshooting & FAQs

### Q1: Why does a microservice show `down` in Prometheus / Grafana?
- **Check 1 (Is container running?):** `docker ps | grep <service-name>`.
- **Check 2 (Can Prometheus reach it?):**
  ```bash
  docker exec prometheus wget -qO- http://<service-name>:<port>/actuator/prometheus | head -n 10
  ```
- **Check 3 (Spring Security blocking?):** If `wget` returns 401/403, verify the `/actuator/**` bypass in both `SecurityConfig.java` and `JwtAuthenticationFilter.java`.

### Q2: Why does Grafana show `403 Forbidden` toasts or red warning triangles on panels?
- Grafana queries contain PromQL expressions (e.g. `sum(...)` or `{name=~".*"}`). If ModSecurity is accidentally enabled on `/grafana/`, CRS flags these expressions as SQLi.
- Ensure `modsecurity off;` is set in `gateway/nginx.conf` under `location /grafana/`.

### Q3: How do I test microservice endpoints directly if host ports are closed?
- **Option A (Via Gateway with HTTPS):**
  ```bash
  curl -k -i https://localhost:8443/api/users/healthz
  ```
- **Option B (From inside another container):**
  ```bash
  docker exec nginx curl -i http://identity-service:8083/healthz
  ```

### Q4: Nginx container fails to start with `error: cannot copy config files to /etc/modsecurity.d`
- **Cause:** Overwriting the directory structure or deleting `/etc/nginx/templates/modsecurity.d/` in the Dockerfile.
- **Fix:** In `gateway/Dockerfile`, copy custom overrides to `/etc/nginx/templates/modsecurity.d/modsecurity-override.conf.template` and let the official entrypoint populate `/etc/modsecurity.d`. Do NOT mount `:ro` volumes over `/etc/modsecurity.d/modsecurity-override.conf`.

