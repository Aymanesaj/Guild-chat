## Identity service

Owner: `obendaou`. The Node.js/TypeScript application uses Fastify and Prisma.
It currently provides `GET /health`; the API routes and gRPC methods below
describe the service contract. The previous Java implementation remains in
`demo/` and is excluded from the Node image.

### Container configuration

The Dockerfile runs `npm ci`, `npm run build`, and then `npm start`
(`dist/server.js`). Compose loads the root `.env`; use `.env.example` as the
template. Identity has no inline `environment` block in Compose.

- `IDENTITY_HTTP_PORT=8083` controls Fastify's listener on `0.0.0.0`.
- `IDENTITY_GRPC_PORT=9090` is the target port used by chat and reserved for
  the identity gRPC server, which is not implemented yet.
- Avoid a shared `PORT` variable. Chat and org retain their own Compose
  overrides, and identity reads only `IDENTITY_HTTP_PORT`.
- `DATABASE_URL` points to PostgreSQL at `identity-service_postgres:5432`. JWT and GitHub
  credentials also come from `.env`, which must not be committed.
- `identity_avatars` persists files at `/tmp/identity-avatars`; keep
  `AVATAR_DIR` set to that path. The image runs as the `node` user.
- Neither identity port is published on the host. Nginx keeps the existing
  `/api/users/` prefix rewrite, so `/api/users/login` reaches `/login`.
- Docker and Gatus check `/health`. Identity has no Actuator metrics scrape.

The Prisma schema defines users, refresh tokens, and friendships. Compose runs
the `identity-migrate` service (`prisma migrate deploy`) before starting identity.
Its dedicated Docker build target retains the Prisma CLI; the runtime image
contains only production dependencies. The initial migration creates the tables
on an empty database, followed by the friendship pair-key upgrade.

Run `docker compose up -d --build identity-service` from the repository root.
If migration fails, inspect `docker compose logs identity-migrate`; identity
will not start until migrations succeed. Existing databases created outside
Prisma need their schema checked and migration history baselined before using
this deployment path; do not delete stored data to bypass a migration error.

### Public gateway routes

All routes go through the Nginx gateway:

- `POST /api/users/register`
- `POST /api/users/login`
- `GET /api/users/oauth/github/url`
- `GET /api/users/oauth/github/callback?code=...`
- `GET /api/users/avatars/{filename}`

### Authenticated gateway routes

Send `Authorization: Bearer <accessToken>`:

- `GET /api/users/me`
- `PUT /api/users/me`
- `POST /api/users/me/avatar`
- `GET /api/users/{id}`

### New auth endpoints (refresh + logout)

- `POST /api/users/auth/refresh` — body `{ "refreshToken": "..." }` → returns a new access + refresh pair. The old refresh token is revoked; reusing a revoked refresh token revokes **all** sessions for that user.
- `POST /api/users/auth/logout` — authenticated; revokes all refresh tokens for the current user.

`AuthResponse` now includes `refreshToken` alongside `accessToken`.

### Friends endpoints (authenticated)

- `POST /api/users/friends/requests` — body `{ "addresseeId": "..." }` → creates a `PENDING` request.
- `POST /api/users/friends/requests/{id}/accept` — only the addressee may accept.
- `POST /api/users/friends/requests/{id}/decline` — only the addressee may decline.
- `DELETE /api/users/friends/{userId}` — removes an accepted friendship.
- `GET /api/users/friends` — list of accepted friends.
- `GET /api/users/friends/requests` — `{ "incoming": [...], "outgoing": [...] }`.
- `GET /api/users/friends/username/get?username=<USERNAME>` — to get by the username.

### gRPC contract (internal, port 9090)

Service: `identity.IdentityService` (proto package `identity`, file `src/grpc/identity.proto`).

| RPC | Request | Response |
|---|---|---|
| `ValidateToken` | `{ token }` | `{ valid, user_id, username, email }` |
| `GetUser` | `{ user_id }` | `{ user_id, username, display_name, avatar_url }` |
| `AreFriends` | `{ user_a, user_b }` | `{ are_friends }` |

Chat-service and org-service call these over the private network at
`identity-service:9090`. The Node implementation still needs to provide the handlers.

### Infra needs (handoff)

- Compose exposes port `9090` inside the private network only.
- The SQL below documents the previous Java data model. Current Prisma
  migrations live in `prisma/migrations` and are deployed by `identity-migrate`.

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  replaced_by UUID,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE friendships (
  id UUID PRIMARY KEY,
  requester_id UUID NOT NULL,
  addressee_id UUID NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  CONSTRAINT uk_friendships_pair UNIQUE (requester_id, addressee_id)
);
CREATE INDEX idx_friendships_requester ON friendships(requester_id);
CREATE INDEX idx_friendships_addressee ON friendships(addressee_id);
```

### Local development

GitHub Actions runs identity checks directly in `.github/workflows/ci-cd.yml`:
start a temporary PostgreSQL database, install dependencies, generate Prisma,
apply migrations, run the existing `src/tests` tests, and build the service.
Docker Compose checks the existing `/health` endpoint, and Nginx waits for that
check to pass. This healthcheck verifies the HTTP server is responding.

From `application/identity-service`:

```sh
npm ci
npm run build
npm run dev
```

From the repo root:

```sh
docker compose up --build identity-service
```
