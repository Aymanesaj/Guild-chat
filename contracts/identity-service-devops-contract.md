# Identity Service ↔ DevOps Contract

**Owner:** `obendaou`  
**Service:** `identity-service`  
**Application stack:** Node.js + TypeScript + Fastify  
**Database access:** PostgreSQL via Prisma  
**Internal RPC:** gRPC  
**Scope:** This document defines what `identity-service` expects from infrastructure. The identity-service developer does not own Docker Compose, Nginx, deployment, monitoring, or production database provisioning.

---

## 1. Service responsibilities

`identity-service` owns:

- Registration and login
- JWT access-token issuance and validation
- Refresh-token rotation and logout/session revocation
- User profiles
- Avatar storage
- GitHub OAuth
- Friend requests and friendships
- Internal gRPC identity API used by other backend services

The public API remains behind the existing Nginx gateway.

---

## 2. Runtime contract

The service runtime is changing from **Spring Boot / Java** to:

- Node.js
- TypeScript
- Fastify

The service process must be started by the container/infrastructure provided by DevOps.

The application will listen on:

| Purpose | Port | Visibility |
|---|---:|---|
| HTTP / Fastify API | `8083` | Internal container network; reached publicly through Nginx |
| gRPC | `9090` | Private backend network only |

### Important

Port `9090` must **not** be exposed publicly through Nginx or the host.

`chat-service` and `org-service` must be able to reach:

```text
identity-service:9090
```

inside the private Docker network.

---

## 3. Health check

The Spring Actuator health endpoint is no longer valid.

### New health endpoint

```http
GET /health
```

Expected response:

```json
{
  "status": "ok",
  "service": "identity-service"
}
```

Expected HTTP status:

```text
200
```

DevOps should configure the container health check against:

```text
http://localhost:8083/health
```

The old endpoint:

```text
/actuator/health/readiness
```

must no longer be used for `identity-service`.

---

## 4. PostgreSQL contract

The service uses the existing PostgreSQL infrastructure.

Current database service name:

```text
postgres
```

Current PostgreSQL port:

```text
5432
```

Inside Docker, the database host must therefore be reachable as:

```text
postgres:5432
```

The identity-service developer will use Prisma to access PostgreSQL.

### Preferred environment variable

DevOps should provide:

```env
DATABASE_URL=postgresql://<user>:<password>@postgres:5432/<database>?schema=public
```

The actual credentials must remain in infrastructure-managed environment/secrets configuration and must not be committed to Git.

If DevOps prefers to keep the existing individual PostgreSQL environment variables, they must provide enough values for the service to construct an equivalent connection URL.

---

## 5. Required environment variables

The container must provide the following variables.

### Application

```env
PORT=8083
GRPC_PORT=9090
```

### Database

Preferred:

```env
DATABASE_URL=...
```

### JWT

```env
JWT_SECRET=...
JWT_ISSUER=...
```

`JWT_SECRET` must not be committed to the repository.

### GitHub OAuth

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=...
```

### Avatar storage

Recommended:

```env
AVATAR_DIR=/tmp/identity-avatars
```

---

## 6. Persistent avatar volume

The existing identity avatar storage path should remain:

```text
/tmp/identity-avatars
```

The infrastructure should mount persistent storage there.

Existing Compose volume name:

```text
identity_avatars
```

Expected mapping:

```text
identity_avatars:/tmp/identity-avatars
```

This allows uploaded avatars to survive container recreation.

---

## 7. Public HTTP routes

Nginx should continue routing identity/user API requests to the HTTP service on port `8083`.

Expected public routes include:

```text
POST /api/users/register
POST /api/users/login

GET  /api/users/oauth/github/url
GET  /api/users/oauth/github/callback

POST /api/users/auth/refresh
POST /api/users/auth/logout

GET  /api/users/me
PUT  /api/users/me
POST /api/users/me/avatar

GET  /api/users/{id}

POST   /api/users/friends/requests
POST   /api/users/friends/requests/{id}/accept
POST   /api/users/friends/requests/{id}/decline
DELETE /api/users/friends/{userId}
GET    /api/users/friends
GET    /api/users/friends/requests
GET    /api/users/friends/username/get
```

The exact application behavior is owned by the identity-service developer.

DevOps only needs to preserve routing to the service.

---

## 8. Internal gRPC contract

The existing protobuf contract must remain compatible with the other services.

Service:

```text
identity.IdentityService
```

Required RPCs:

```text
ValidateToken
GetUser
AreFriends
```

Expected logical contract:

```text
ValidateToken({ token })
    -> { valid, user_id, username, email }

GetUser({ user_id })
    -> { user_id, username, display_name, avatar_url }

AreFriends({ user_a, user_b })
    -> { are_friends }
```

The canonical `.proto` file remains part of `identity-service`.

DevOps must ensure backend services can reach the gRPC endpoint over the private network.

---

## 9. Service discovery

Other backend services should use Docker/internal DNS rather than fixed IP addresses.

HTTP:

```text
identity-service:8083
```

gRPC:

```text
identity-service:9090
```

PostgreSQL:

```text
postgres:5432
```

No code should depend on container IP addresses.

---

## 10. Container expectations

DevOps owns the production Dockerfile and Compose configuration.

The container must:

- Run the Node/Fastify build of `identity-service`
- Start the service on `0.0.0.0:8083`
- Make internal gRPC available on `0.0.0.0:9090`
- Receive required environment variables
- Have network access to PostgreSQL
- Mount persistent avatar storage
- Provide a working health check against `/health`
- Restart according to the team's existing restart policy
- Run inside the existing private network

The identity-service developer will provide the application commands/scripts required by the Docker image, for example:

```text
npm run build
npm start
```

---

## 11. Nginx / gateway expectations

DevOps owns Nginx.

Requirements:

- Preserve existing `/api/users/...` routing to `identity-service:8083`
- Preserve HTTPS/TLS termination at the gateway
- Keep normal gateway security/rate-limiting policy
- Do not publicly proxy `9090`
- Do not require the identity service itself to terminate TLS

---

## 12. Monitoring

The service will expose:

```http
GET /health
```

for health/readiness checks.

Any Prometheus-specific metrics endpoint or infrastructure monitoring integration should be agreed separately with DevOps.

The old Spring/Micrometer Actuator endpoints must not be assumed to exist after the Fastify migration.

---

## 13. Database ownership boundary

`identity-service` owns the logical data model for:

```text
users
refresh_tokens
friendships
```

The application developer owns:

- Prisma schema
- Query/repository logic
- Application-level migration requirements

DevOps owns:

- PostgreSQL container/service
- Persistent database storage
- Production secrets
- Backup/restore infrastructure
- Deployment execution

Before applying production schema migrations, application and DevOps owners should agree on the migration procedure.

---

## 14. What changes because Spring Boot is being removed

DevOps should remove/update Spring-specific assumptions for **identity-service only**.

Examples:

```text
OLD                                NEW
----------------------------------------------------------------
Java 21 runtime                    Node.js runtime
Spring Boot                        Fastify
Maven                              npm
/actuator/health/readiness         /health
Spring datasource configuration   DATABASE_URL / Prisma
Spring gRPC implementation         Node gRPC implementation
Micrometer/Actuator assumptions    Fastify-specific monitoring
```

This migration does **not** imply that `org-service` or `chat-service` must change frameworks.

---

## 15. Acceptance checklist

Infrastructure integration is complete when:

- [ ] `identity-service` container builds successfully
- [ ] `identity-service` starts successfully
- [ ] `GET /health` returns HTTP 200
- [ ] identity-service can connect to PostgreSQL
- [ ] Nginx can reach identity-service HTTP on `8083`
- [ ] `chat-service` can reach `identity-service:9090`
- [ ] `org-service` can reach `identity-service:9090`
- [ ] port `9090` is not publicly exposed
- [ ] avatar volume is mounted at `/tmp/identity-avatars`
- [ ] JWT and OAuth secrets are provided through environment/secrets
- [ ] existing `/api/users/...` gateway routes continue to work

---

## 16. Ownership summary

### `obendaou` / identity-service developer

Owns:

```text
Fastify application
TypeScript code
Prisma schema and repositories
Authentication logic
JWT logic
Refresh-token logic
Profiles
Friends
OAuth
Avatar application logic
gRPC handlers
identity.proto compatibility
Tests
```

### DevOps developer

Owns:

```text
Dockerfile / image integration
docker-compose.yml
Nginx routing
Private networking
Environment/secrets injection
PostgreSQL infrastructure
Persistent volumes
Health-check configuration
Monitoring infrastructure
Deployment
Backups / restore
```

The boundary is: **identity-service defines what the application needs; DevOps defines how those requirements are deployed and operated.**
