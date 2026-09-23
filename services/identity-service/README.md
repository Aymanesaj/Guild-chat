## Identity service

Spring Boot microservice owned by member 3. It handles local auth, JWT issuing,
profile records, avatar uploads, and GitHub OAuth bootstrap.

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

Service: `identity.IdentityService` (proto package `identity`, file `src/main/proto/identity.proto`).

| RPC | Request | Response |
|---|---|---|
| `ValidateToken` | `{ token }` | `{ valid, user_id, username, email }` |
| `GetUser` | `{ user_id }` | `{ user_id, username, display_name, avatar_url }` |
| `AreFriends` | `{ user_a, user_b }` | `{ are_friends }` |

Chat-service and org-service should call these instead of re-parsing JWTs locally. The gRPC server runs on its own port and is **not** behind the Spring Security filter chain — services calling it must already be inside the cluster network.

### Infra needs (handoff)

- Expose port `9090` on the identity-service container in `docker-compose.yml`.
- The identity DB needs two new tables: `refresh_tokens` and `friendships`. JPA `ddl-auto=update` will create them in dev; for prod, hand the schema below to the infra owner.

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

From `services/identity-service/demo`:

```sh
MAVEN_USER_HOME=/tmp/maven ./mvnw test
```

From the repo root:

```sh
docker compose up --build identity-service
```
