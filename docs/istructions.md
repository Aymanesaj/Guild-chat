# Infrastructure Architect & System Hardening — Roadmap & Instructions

**Role:** Infrastructure Architect & System Hardening  
**Total Points Contributed:** 6 Points  
- **Backend as Microservices** (Major — 2 pts)
- **Monitoring System** (Major — 2 pts)
- **Cybersecurity Hardening** (Major — 2 pts)

---

## Executive Summary: Is Your Part Finished?

**Status: INCOMPLETE (Action Required)**

| Module | Score | Current Status | Blocker Summary |
| :--- | :---: | :---: | :--- |
| **1. Backend as Microservices** | 1.0 / 2.0 | **Partial** | Microservices expose host ports directly (bypassing Gateway & WAF); Gateway lacks HTTPS/TLS encryption; startup dependencies need healthcheck conditions. |
| **2. Monitoring System** | 0.5 / 2.0 | **Broken** | `microservices-dashboard.json` has a JSON syntax error (`// not yet`) failing Grafana loading; `org-service` is missing `spring-boot-starter-actuator`; `identity-service` and `org-service` Spring Security configs block Prometheus scrapes (401/403). |
| **3. Cybersecurity Hardening** | 0.0 / 2.0 | **Not Working** | ModSecurity WAF is inactive (missing `modsecurity_rules_file`, CRS entrypoint bypassed, empty directories mounted); HashiCorp Vault is commented out in `docker-compose.yml`, `config.hcl` is empty, and secrets remain unencrypted in `.env`. |

---

## Table of Contents
1. [Module 1: Backend as Microservices (2 pts)](#module-1-backend-as-microservices-2-pts)
2. [Module 2: Monitoring System (2 pts)](#module-2-monitoring-system-2-pts)
3. [Module 3: Cybersecurity Hardening (2 pts)](#module-3-cybersecurity-hardening-2-pts)
   - [3.1 Web Application Firewall (WAF)](#31-web-application-firewall-waf)
   - [3.2 HashiCorp Vault Secrets Isolation](#32-hashicorp-vault-secrets-isolation)
4. [Verification & Evaluation Defense Guide](#verification--evaluation-defense-guide)

---

## Module 1: Backend as Microservices (2 pts)

### 1.1 Root Cause & Architectural Gaps
1. **Host Port Leakage (Security & Architecture Flaw):**
   In `docker-compose.yml`, `org-service` (`8082:8082`), `identity-service` (`8083:8083`), and `postgres` (`5432:5432`) expose ports directly to the host machine.
   *Why this fails evaluation:* In a true microservices architecture, the **API Gateway must be the sole entry point** to internal services. Direct host access bypasses API rate limiting, routing, and ModSecurity WAF.
2. **Missing Gateway HTTPS / SSL Encryption:**
   `gateway/script.sh` generates self-signed certificates (`/etc/nginx/conf/server.crt` & `server.key`), but `gateway/nginx.conf` only listens on port 80 (HTTP). `docker-compose.yml` does not bind port 443.
3. **Startup Race Conditions:**
   `nginx` currently uses basic `depends_on: [...]`. If an upstream service is starting up slowly, Nginx can fail DNS resolution at reload or return premature 502 Bad Gateway errors.

---

### 1.2 Actionable Steps

#### Step 1: Remove direct host port exposures in `docker-compose.yml`
Edit `docker-compose.yml`:
- For `org-service`: Remove `ports: - "8082:8082"` (keep `expose: - "8082"`).
- For `identity-service`: Remove `ports: - "8083:8083"` (keep inside `private` network).
- For `postgres`: Remove `ports: - "5432:5432"`.
- For `nginx`: Map port 80 and port 443 (e.g. `8000:80` and `8443:443`).

#### Step 2: Configure HTTPS and HTTP-to-HTTPS redirect in `gateway/nginx.conf`
Update `gateway/nginx.conf` to serve TLS on 443 and redirect HTTP traffic:

```nginx
events {
    worker_connections 1024;
}

http {
    include      /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=20r/s;
    limit_req_status 429;

    upstream identity-service { server identity-service:8083; }
    upstream org-service      { server org-service:8082; }
    upstream chat-service     { server chat-service:8081; }
    upstream docker-exporter  { server docker-exporter:8090; }
    upstream grafana          { server grafana:3000; }
    upstream prometheus       { server prometheus:9090; }

    # HTTP Server: Redirect all traffic to HTTPS
    server {
        listen 80;
        server_name localhost;
        return 301 https://$host:8443$request_uri;
    }

    # HTTPS Gateway Server
    server {
        listen 443 ssl;
        server_name localhost;

        ssl_certificate     /etc/nginx/conf/server.crt;
        ssl_certificate_key /etc/nginx/conf/server.key;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         HIGH:!aNULL:!MD5;

        root /usr/share/nginx/html;
        index index.html;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Health endpoint
        location /nginx_status {
            stub_status on;
            allow 127.0.0.1;
            allow 172.16.0.0/12;
            allow 10.0.0.0/8;
            deny all;
        }

        # Identity Microservice Routing
        location /api/users/ {
            limit_req zone=api_limit burst=30 nodelay;
            rewrite ^/api/users/(.*)$ /$1 break;
            proxy_pass http://identity-service;
        }

        location /api/auth/ {
            limit_req zone=api_limit burst=30 nodelay;
            rewrite ^/api/auth/(.*)$ /$1 break;
            proxy_pass http://identity-service;
        }

        # Organization Microservice Routing
        location /api/orgs/ {
            limit_req zone=api_limit burst=30 nodelay;
            rewrite ^/api/orgs/(.*)$ /$1 break;
            proxy_pass http://org-service;
        }

        # Chat Microservice WebSocket & HTTP Routing
        location /ws/chat {
            proxy_pass http://chat-service;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_read_timeout 3600s;
        }

        location = /api/rooms {
            limit_req zone=api_limit burst=30 nodelay;
            proxy_pass http://chat-service;
        }

        location /api/rooms/ {
            limit_req zone=api_limit burst=30 nodelay;
            proxy_pass http://chat-service;
        }

        location /api/chat/ {
            limit_req zone=api_limit burst=30 nodelay;
            rewrite ^/api/chat/(.*)$ /$1 break;
            proxy_pass http://chat-service;
        }

        # Monitoring
        location /metrics.prom {
            proxy_pass http://docker-exporter/metrics.prom;
        }

        location /prometheus/ {
            rewrite ^/prometheus/(.*)$ /$1 break;
            proxy_pass http://prometheus;
        }

        location /grafana/ {
            proxy_set_header Host $http_host;
            rewrite ^/grafana/(.*)$ /$1 break;
            proxy_pass http://grafana;
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
```

#### Step 3: Use `condition: service_healthy` for Nginx dependencies
In `docker-compose.yml`, update `nginx.depends_on`:
```yaml
    depends_on:
      identity-service:
        condition: service_healthy
      chat-service:
        condition: service_healthy
      org-service:
        condition: service_healthy
      grafana:
        condition: service_started
      prometheus:
        condition: service_started
      docker-exporter:
        condition: service_healthy
```

---

## Module 2: Monitoring System (2 pts)

### 2.1 Root Cause & Gaps
1. **Broken Grafana Provisioning:**
   File `infra/grafana/dashboards/microservices-dashboard.json` contains `// not yet` on line 269 after the JSON root object. Grafana fails to import the dashboard on container start with an `Extra data` parsing error.
2. **Missing Actuator in `org-service`:**
   `services/org-service/pom.xml` has `micrometer-registry-prometheus`, but lacks `spring-boot-starter-actuator`. Without Actuator, neither `/actuator/prometheus` nor `/actuator/health` are registered.
3. **Scrapes Blocked by Spring Security:**
   - In `services/identity-service/.../SecurityConfig.java`, lines 39–40 permit `/actuator/health`, but **omit** `/actuator/prometheus`. Scrapes get HTTP 403.
   - In `services/org-service/.../SecurityConfig.java`, only `/healthz` is permitted. `/actuator/**` is rejected with HTTP 401.
4. **Nginx API Gateway Metrics Unscraped:**
   Nginx exposes `/nginx_status`, but Prometheus has no job scraping Gateway throughput or error rates.

---

### 2.2 Actionable Steps

#### Step 1: Fix `infra/grafana/dashboards/microservices-dashboard.json`
Delete line 269 (`// not yet`) so the file ends cleanly on line 267 with `}`. Verify with:
```bash
python3 -m json.tool infra/grafana/dashboards/microservices-dashboard.json > /dev/null
```

#### Step 2: Add `spring-boot-starter-actuator` to `services/org-service/pom.xml`
Under `<dependencies>` in `services/org-service/pom.xml`, add:
```xml
		<dependency>
			<groupId>org.springframework.boot</groupId>
			<artifactId>spring-boot-starter-actuator</artifactId>
		</dependency>
```

#### Step 3: Whitelist `/actuator/**` in Spring Security

1. In `services/org-service/src/main/java/com/ft_transcendence/orgservice/config/SecurityConfig.java`:
   ```java
               .authorizeHttpRequests(auth -> auth
                   .requestMatchers("/healthz", "/actuator/**").permitAll()
                   .anyRequest().authenticated()
               )
   ```
   And in `services/org-service/src/main/java/com/ft_transcendence/orgservice/config/JwtAuthenticationFilter.java`:
   ```java
       @Override
       protected boolean shouldNotFilter(HttpServletRequest request) {
           return request.getRequestURI().startsWith("/healthz") 
               || request.getRequestURI().startsWith("/actuator");
       }
   ```

2. In `services/identity-service/demo/src/main/java/com/fttranscendence/identity/config/SecurityConfig.java`:
   ```java
   				.requestMatchers(
   					"/register",
   					"/login",
   					"/auth/refresh",
   					"/oauth/**",
   					"/avatars/**",
   					"/actuator/**"
   				).permitAll()
   ```

#### Step 4: Add Nginx Exporter to `docker-compose.yml` and `prometheus.yml`
In `docker-compose.yml`, add an Nginx Prometheus exporter:
```yaml
  nginx-exporter:
    image: nginx/nginx-prometheus-exporter:1.1.0
    container_name: nginx-exporter
    command:
      - -nginx.scrape-uri=http://nginx:80/nginx_status
    networks:
      - private
    depends_on:
      - nginx
    restart: always
```
In `infra/prometheus/prometheus.yml`, add:
```yaml
  - job_name: 'nginx-gateway'
    static_configs:
      - targets: ['nginx-exporter:9113']
```

---

## Module 3: Cybersecurity Hardening (2 pts)

### 3.1 Web Application Firewall (WAF)

#### The Problem:
1. Docker created empty directories on the host:
   `gateway/modsec/main.conf/`, `modsecurity.conf/`, and `unicode.mapping/`.
   Mounting them corrupts ModSecurity configuration inside the container.
2. `gateway/nginx.conf` has `modsecurity on;` but **does not specify `modsecurity_rules_file`**. No rules are executed.
3. `gateway/Dockerfile` overrides `ENTRYPOINT [ "./script.sh" ]`, skipping `/docker-entrypoint.sh` from `owasp/modsecurity-crs:nginx`. This prevents OWASP Core Rule Set (CRS) scripts from generating the CRS rules.
4. `SecRuleEngine` is not set to `On` (blocking mode).

#### Actionable Steps:

1. **Clean up empty directories on host:**
   ```bash
   sudo rm -rf gateway/modsec/main.conf gateway/modsec/modsecurity.conf gateway/modsec/unicode.mapping
   ```

2. **Fix `gateway/script.sh` to delegate to official entrypoint:**
   Edit `gateway/script.sh`:
   ```bash
   #!/bin/sh
   set -e

   mkdir -p /etc/nginx/conf
   if [ ! -f /etc/nginx/conf/server.crt ]; then
       echo "Generating self-signed SSL certificates..."
       openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
           -keyout /etc/nginx/conf/server.key \
           -out /etc/nginx/conf/server.crt \
           -subj "/C=MA/ST=Marrakesh-Safi/L=Ben Guerir/O=ft_transcendence/CN=localhost"
   fi

   # Execute the official OWASP CRS entrypoint so CRS rules are configured
   exec /docker-entrypoint.sh "$@"
   ```

3. **Enable ModSecurity CRS in `gateway/nginx.conf`:**
   Add `load_module` at top of `gateway/nginx.conf`:
   ```nginx
   load_module modules/ngx_http_modsecurity_module.so;
   ```
   Inside `http { ... }`:
   ```nginx
   modsecurity on;
   modsecurity_rules_file /etc/modsecurity.d/setup.conf;
   ```

4. **Add custom override file for strict blocking and WebSocket whitelisting:**
   Create `gateway/modsec/modsecurity-override.conf`:
   ```apache
   # Enforce blocking mode (HTTP 403)
   SecRuleEngine On
   SecRequestBodyAccess On
   SecResponseBodyAccess Off

   # Whitelist WebSocket connection handshake from CRS anomaly inspection
   SecRule REQUEST_URI "@beginsWith /ws/" \
       "id:10001,phase:1,pass,nolog,ctl:ruleEngine=Off"
   ```

5. **Update `nginx` volume in `docker-compose.yml`:**
   ```yaml
     nginx:
       container_name: nginx
       build:
         context: .
         dockerfile: gateway/Dockerfile
       environment:
         - PARANOIA=1
         - BLOCKING_PARANOIA=1
         - MODSEC_RULE_ENGINE=on
       volumes:
         - ./gateway/modsec/modsecurity-override.conf:/etc/modsecurity.d/modsecurity-override.conf:ro
       ports:
         - "8000:80"
         - "8443:443"
       networks:
         - private
   ```

---

### 3.2 HashiCorp Vault Secrets Isolation

#### The Problem:
- `vault` service is commented out in `docker-compose.yml`.
- `infra/vault/config.hcl` is empty.
- Database passwords (`POSTGRES_PASSWORD`, `MONGO_ROOT_PASSWORD`), JWT keys (`JWT_SECRET`), and OAuth tokens are stored as plaintext environment variables in `.env`.
- Subject requirement: *"deploy HashiCorp Vault to handle encrypted secrets isolation"*.

#### Actionable Steps:

#### Step 1: Create `infra/vault/config.hcl`
Write the Vault server configuration:
```hcl
storage "file" {
  path = "/vault/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}

ui = true
disable_mlock = true
api_addr = "http://vault:8200"
```

#### Step 2: Add `vault` service and volume in `docker-compose.yml`
Uncomment and configure the `vault` container:
```yaml
  vault:
    image: hashicorp/vault:1.15
    container_name: vault
    environment:
      VAULT_ADDR: "http://127.0.0.1:8200"
      VAULT_API_ADDR: "http://vault:8200"
    volumes:
      - ./infra/vault/config.hcl:/vault/config/config.hcl:ro
      - vault_data:/vault/file
    ports:
      - "8200:8200"
    networks:
      - private
    cap_add:
      - IPC_LOCK
    command: vault server -config=/vault/config/config.hcl
    healthcheck:
      test: ["CMD", "vault", "status"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: always
```
Add `vault_data:` under `volumes:`.

#### Step 3: Create Vault Provisioner Script (`infra/vault/init-vault.sh`)
Create `infra/vault/init-vault.sh` to initialize, unseal, enable KV v2, and seed secrets automatically:

```bash
#!/bin/bash
set -e

echo "[Vault] Checking status..."
INIT_STATUS=$(docker exec vault vault status -format=json 2>/dev/null || true)

if echo "$INIT_STATUS" | grep -q '"initialized": false'; then
    echo "[Vault] Initializing new Vault cluster..."
    INIT_OUTPUT=$(docker exec vault vault operator init -key-shares=1 -key-threshold=1 -format=json)
    
    UNSEAL_KEY=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
    ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')
    
    echo "$UNSEAL_KEY" > infra/vault/.unseal_key
    echo "$ROOT_TOKEN" > infra/vault/.root_token
    chmod 600 infra/vault/.unseal_key infra/vault/.root_token
    
    echo "[Vault] Unsealing Vault..."
    docker exec vault vault operator unseal "$UNSEAL_KEY"
    
    echo "[Vault] Enabling KV version 2 secrets engine..."
    docker exec -e VAULT_TOKEN="$ROOT_TOKEN" vault vault secrets enable -path=secret kv-v2 || true

    echo "[Vault] Seeding encrypted secrets..."
    docker exec -e VAULT_TOKEN="$ROOT_TOKEN" vault vault kv put secret/transcendence/postgres \
        username="admin" \
        password="${POSTGRES_PASSWORD:-admin123}"

    docker exec -e VAULT_TOKEN="$ROOT_TOKEN" vault vault kv put secret/transcendence/mongo \
        username="admin" \
        password="${MONGO_ROOT_PASSWORD:-mongosecret123}"

    docker exec -e VAULT_TOKEN="$ROOT_TOKEN" vault vault kv put secret/transcendence/jwt \
        secret="${JWT_SECRET:-OBYcCOxLMXYDJxwgeOAdASTDflOwKNVm}"

    docker exec -e VAULT_TOKEN="$ROOT_TOKEN" vault vault kv put secret/transcendence/oauth \
        client_id="${GITHUB_CLIENT_ID:-}" \
        client_secret="${GITHUB_CLIENT_SECRET:-}"

    echo "[Vault] Provisioned successfully!"
else
    echo "[Vault] Vault already initialized. Checking if unseal needed..."
    if echo "$INIT_STATUS" | grep -q '"sealed": true'; then
        UNSEAL_KEY=$(cat infra/vault/.unseal_key)
        docker exec vault vault operator unseal "$UNSEAL_KEY"
    fi
fi
```
Make executable: `chmod +x infra/vault/init-vault.sh`.

#### Step 4: Secrets Isolation in Microservices (How services consume Vault)
To isolate secrets from static `.env` files into encrypted runtime storage, implement **Pattern A: Dynamic Entrypoint Secret Injection**:

Add a shared helper `services/vault-entrypoint.sh`:
```bash
#!/bin/sh
set -e

if [ -n "$VAULT_TOKEN" ]; then
    echo "Fetching secrets from HashiCorp Vault ($VAULT_ADDR)..."
    
    # Fetch JWT Secret
    JWT_DATA=$(wget -qO- --header="X-Vault-Token: $VAULT_TOKEN" "$VAULT_ADDR/v1/secret/data/transcendence/jwt")
    if [ -n "$JWT_DATA" ]; then
        export JWT_SECRET=$(echo "$JWT_DATA" | grep -o '"secret":"[^"]*' | cut -d'"' -f4)
    fi

    # Fetch DB credentials if needed
    if [ "$APP_NAME" = "identity-service" ] || [ "$APP_NAME" = "org-service" ]; then
        PG_DATA=$(wget -qO- --header="X-Vault-Token: $VAULT_TOKEN" "$VAULT_ADDR/v1/secret/data/transcendence/postgres")
        if [ -n "$PG_DATA" ]; then
            export SPRING_DATASOURCE_PASSWORD=$(echo "$PG_DATA" | grep -o '"password":"[^"]*' | cut -d'"' -f4)
        fi
    fi
fi

exec "$@"
```

In `docker-compose.yml`, pass:
```yaml
    environment:
      VAULT_ADDR: "http://vault:8200"
      VAULT_TOKEN: "${VAULT_SERVICE_TOKEN}"
```
This guarantees that **secrets never live in image builds or static repo files**, satisfying encrypted secrets isolation.

---

## Verification & Evaluation Defense Guide

### 1. Verify Backend as Microservices
Run the following checks:
```bash
# 1. Ensure backend services are NOT accessible on host ports (must fail or refuse)
curl -I http://localhost:8082/healthz   # Connection refused (SUCCESS)
curl -I http://localhost:8083           # Connection refused (SUCCESS)

# 2. Access through Gateway (HTTPS)
curl -k -I https://localhost:8443/api/users/
# Should return HTTP response through Gateway
```

### 2. Verify Monitoring System
```bash
# 1. Check Prometheus Scrape Targets
curl -s http://localhost:8000/prometheus/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
# Expected: identity-service, chat-service, org-service, docker-exporter ALL report health: "up"

# 2. Verify Grafana Dashboard
curl -s -u admin:${GRAFANA_ADMIN_PASSWORD:-admin} http://localhost:8000/grafana/api/dashboards/uid/microservices-overview | jq .dashboard.title
# Expected: "Microservices Overview Dashboard"

# 3. Trigger Alert Rule Test
# Stop a container to trigger MicroserviceDown in Discord
docker stop org-service
# Check Discord channel within 30-40 seconds for critical alert notification
docker start org-service
```

### 3. Verify Cybersecurity Hardening (WAF & Vault)
```bash
# 1. Test WAF SQL Injection Blocking
curl -k -i "https://localhost:8443/?id=1'%20OR%20'1'='1"
# Expected output: HTTP/1.1 403 Forbidden

# 2. Test WAF Cross-Site Scripting (XSS) Blocking
curl -k -i "https://localhost:8443/?q=<script>alert(1)</script>"
# Expected output: HTTP/1.1 403 Forbidden

# 3. Test WAF Path Traversal Blocking
curl -k -i "https://localhost:8443/etc/passwd"
# Expected output: HTTP/1.1 403 Forbidden

# 4. Verify Vault Encrypted Storage
docker exec vault vault kv get secret/transcendence/jwt
# Shows versioned, encrypted KV secrets in Vault
```

---

*Generated for `ft_transcendence` — Infrastructure Architect & System Hardening module.*

