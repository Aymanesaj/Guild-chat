# API Gateway & WAF (Nginx + ModSecurity)

The Gateway serves as the single public entrypoint for the `ft_transcendence` microservices architecture, handling TLS termination, Web Application Firewall (WAF) inspection, rate limiting, and reverse proxy routing.

---

## Architecture & Base Image

- **Base Image:** `owasp/modsecurity-crs:nginx`
- **Security Engine:** ModSecurity v3 with OWASP Core Rule Set (CRS) v4
- **Ports Exposed:**
  - `80` (HTTP) — redirects all plaintext traffic to HTTPS
  - `443` (HTTPS) — primary secure entrypoint
  - `8000`, `8443` — legacy/internal port mapping compatibility

---

## Routing Table

| Path Pattern | Target Upstream | Description |
| :--- | :--- | :--- |
| `/` | `frontend:80` | React Single Page Application (SPA) |
| `/api/users/` | `identity-service:8083` | User profile, avatars, and registration |
| `/api/auth/` | `identity-service:8083` | JWT issue/refresh and OAuth handlers |
| `/api/orgs/` | `org-service:8082` | Guilds, roles, channels, and permissions |
| `/api/rooms/` | `chat-service:8081` | Chat rooms and room membership |
| `/api/chat/` | `chat-service:8081` | Chat message REST endpoints |
| `/ws/chat` | `chat-service:8081` | Real-time WebSocket connection |
| `/status/` | `status-page:8080` | Gatus health status dashboard |
| `/grafana/` | `grafana:3000` | Grafana metrics visualization |
| `/prometheus/` | `prometheus:9090` | Prometheus monitoring (Internal IPs only) |
| `/metrics.prom` | `docker-exporter:8090` | Docker host metrics (Internal IPs only) |

---

## Security Policies & WAF Configuration

1. **OWASP ModSecurity Core Rule Set (CRS):**
   - Active blocking mode enabled (`SecRuleEngine On`).
   - Requests are checked against SQL Injection (SQLi), Cross-Site Scripting (XSS), Local File Inclusion (LFI), Remote Code Execution (RCE), and malicious bots.
2. **WebSocket & Observability Exceptions (`modsecurity-override.conf`):**
   - `/ws/` bypasses CRS body inspection to allow persistent WebSocket streams.
   - Internal observability tools (`/grafana/`, `/prometheus/`) bypass WAF parsing.
3. **Rate Limiting:**
   - Zone `api_limit` restricts clients to 20 requests/second with a burst of up to 30 requests. Excessive requests receive HTTP `429 Too Many Requests`.
4. **Internal Endpoint Protection:**
   - `/nginx_status`, `/prometheus/`, and `/metrics.prom` restrict access to `127.0.0.1` and private Docker bridge subnets (`172.16.0.0/12`, `10.0.0.0/8`, `192.168.0.0/16`), denying public traffic.

---

## SSL / TLS Lifecycle (`script.sh`)

When the gateway container boots:
1. It checks if `/certs/fullchain.pem` and `/certs/privkey.pem` exist (mounted from the host `./certs/` folder via Let's Encrypt).
2. If custom/Let's Encrypt certificates are present, Nginx loads them.
3. If no certificates are mounted, Nginx automatically generates a self-signed RSA-2048 certificate for `guild-chat.tech` so the gateway always starts cleanly without manual certificate generation.
