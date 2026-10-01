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
| `status.${DOMAIN}/` | `status-page:8080` | Gatus UI, assets and API on a separate host |
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

## Domain configuration

Set `DOMAIN=example.com` in `.env` (no scheme, port or path). It defaults to
`localhost`. Compose passes it to the gateway; `script.sh` uses
`envsubst '${DOMAIN}'` to render `nginx.conf` into `/etc/nginx/nginx.conf` at
startup. The explicit variable list preserves Nginx's `$host`, `$scheme`, `$1`,
and other runtime variables.

The main hostname, `www` alias, status subdomain, status redirects, and newly
generated self-signed certificates all use `DOMAIN`. Existing certificates are
preserved and need to be replaced if they do not cover a changed domain.

```bash
docker compose up -d --build --force-recreate nginx
```

## Proxy headers and uploads

Locations with their own `proxy_set_header` directives repeat the forwarded
client IP and protocol headers, including WebSocket and Grafana locations.
Nginx and ModSecurity allow request bodies up to 10 MiB. Backend-specific upload
limits still apply.

Gatus does not support a URL prefix. It uses `https://status.${DOMAIN}/`
in production and `https://status.localhost:8443/` locally. Point the production
subdomain at the same VM and include it in the TLS certificate. `/status/` now
redirects to the production subdomain; the main site's `/css/`, `/js/`, icons,
and `/api/v1/` routes are no longer sent to Gatus. No response rewriting is used.

## SSL / TLS Lifecycle (`script.sh`)

The `nginx_tls` named volume persists `/etc/nginx/conf` across container recreation.
At startup the script copies a mounted Let's Encrypt or custom certificate pair
from `./certs`, or generates a self-signed pair if a complete persisted pair
is unavailable. The private key is mode `600` inside the volume. If mounted files
are incomplete or unreadable, startup fails with an error instead of silently
using a different certificate. See `deploy/README.md` for host file permissions.

Self-signed certificates still cause a browser warning until trusted. Persistence
keeps the same certificate between deployments; `docker compose down -v` deletes
the volume and will cause a new certificate to be generated.
