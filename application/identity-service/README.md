# Identity service

Owner: **obendaou**. She maintains Guild Chat's Node.js/TypeScript service for
accounts, sessions, profiles, avatars and friendships. It runs a Fastify HTTP API
and a gRPC server used by chat-service and org-service.

## Stack and structure

| Component | Implementation |
|---|---|
| Runtime | Node.js 24 in CI; `node:lts-alpine` in Docker; TypeScript 7 with ES modules |
| HTTP | Fastify 5, Zod 4 validation, `@fastify/multipart` uploads |
| Persistence | Prisma 7, `@prisma/adapter-pg`, `pg`, PostgreSQL 16 |
| Authentication | bcrypt 6 (cost 12), jsonwebtoken 9 (HS256), Node crypto for refresh tokens |
| Internal API | `@grpc/grpc-js` and `@grpc/proto-loader` |
| Development/tests | tsx watch mode and Vitest 5 |

[package.json](package.json) declares dependencies and scripts;
[package-lock.json](package-lock.json) records the resolved versions.

HTTP requests pass through `src/routes`, `src/controllers`, Zod schemas in
`src/schemas`, services in `src/services`, and database repositories in
`src/repositories`. Authentication and error handling live in `src/plugins`.
[src/server.ts](src/server.ts) starts both listeners and handles shutdown.

## Container configuration

Compose loads the repository's root `.env`; start with [the template](../../.env.example).

| Variable | Default or requirement |
|---|---|
| `DATABASE_URL` | Required PostgreSQL connection URL; in Compose, use `postgres_db:5432` and the identity database credentials. |
| `JWT_SECRET` | Required signing secret; replace the template value. |
| `JWT_ISSUER` | `ft-transcendence` |
| `JWT_TTL_SECONDS` | `900` (15 minutes) |
| `JWT_REFRESH_TTL_SECONDS` | `604800` (7 days) |
| `IDENTITY_HTTP_PORT` | `8083`, listening on `0.0.0.0` |
| `GRPC_PORT` | `9090`, listening on `0.0.0.0` |
| `AVATAR_DIR` | `/tmp/identity-avatars`, backed by the `identity_avatars` volume in Compose |

The Node gRPC server reads **`GRPC_PORT`**. The root template's
`IDENTITY_GRPC_PORT` configures chat's gRPC client; org's client currently connects
to `identity-service:9090` directly. Keep port 9090 for the existing stack.
Identity does not read the shared `PORT` variable used by chat and org.

Neither identity port is published to the host. Nginx strips `/api/users/`, so
`POST /api/users/login` reaches Fastify's `POST /login`. The gateway also forwards
`/avatars/` to identity. gRPC uses plaintext transport on the Docker network.

The Dockerfile installs dependencies, generates the Prisma client through
`npm run build`'s prebuild hook, and compiles TypeScript. The runtime image prunes
development dependencies and runs `npm start` (`dist/server.js`) as the `node` user.
The separate `migration` build target retains the Prisma CLI.

From the repository root, after configuring `.env`:

```sh
docker compose up -d --build identity-service
docker compose logs identity-migrate identity-service
```

This starts identity and its database/migration dependencies. Use `make` for the
whole application, including Nginx and the frontend.

## Database and migrations

[prisma/schema.prisma](prisma/schema.prisma) defines three models:

- **User → `users`:** UUID primary key, unique username/email, bcrypt password
  hash, display name, bio, avatar URL, provider fields and timestamps.
- **RefreshToken → `refresh_tokens`:** UUID primary key, user foreign key,
  unique SHA-256 token hash, expiry, revocation flag and a nullable `replaced_by`
  reference to the next token. User deletion cascades; deleting a replacement
  sets the old row's reference to null.
- **Friendship → `friendships`:** UUID primary key, requester/addressee user
  foreign keys, unique `pair_key`, status and timestamps. The key joins the
  sorted, lowercased UUIDs with `:` so either request direction has the same key.
  Both user relations cascade on deletion; indexes combine each user ID with status.

Compose runs `identity-migrate` with
`prisma migrate deploy --config prisma7.config.ts` before identity starts.
The [initial migration](prisma/migrations/20261007_initial_schema/migration.sql)
creates the tables. The [pair-key migration](prisma/migrations/20261008_add_friendship_pair_key/migration.sql)
backfills existing pairs, rejects duplicates and then enforces uniqueness.

If migration fails, inspect `docker compose logs identity-migrate`. Databases
created outside Prisma need a schema review and migration baseline before using
this path. Resolve existing duplicate friendship pairs explicitly; the migration
does not delete them for you.

## HTTP API

The paths below include the public gateway prefix. For direct local development
against Fastify on port 8083, remove `/api/users`.

### Public routes

| Method | Gateway path | Request and result |
|---|---|---|
| GET | `/api/users/health` | `{ "status": "ok", "service": "identity-service" }` |
| POST | `/api/users/register` | `{ "username", "email", "password", "displayName"? }`; returns an auth response with status 201. |
| POST | `/api/users/login` | `{ "identifier", "password" }`; identifier is a username or email; returns an auth response. |
| POST | `/api/users/auth/refresh` | `{ "refreshToken": "..." }`; rotates the token and returns a new auth response. |
| POST | `/api/users/auth/logout` | `{ "refreshToken": "..." }`; revokes that refresh session and returns 204. No bearer token required. |
| GET | `/api/users/avatars/{filename}` | Streams a stored JPEG, PNG or WebP avatar; also reachable as `/avatars/{filename}`. |

Registration, login and refresh return:

```text
{ tokenType: "Bearer", accessToken, refreshToken, user }
```

Usernames have 3–32 letters, numbers or underscores and normalize to lowercase.
Registration lowercases email addresses and accepts passwords of 8–128 characters.
Access tokens include the user ID as `sub`, the issuer, username, email and expiry.
Refresh tokens contain 32 random bytes, encoded as base64url; only their SHA-256
hashes enter the database. Rotation revokes the old row and links its replacement.
Reusing a rotated token revokes all refresh sessions for the user. Revoking refresh
tokens does not revoke already-issued access tokens before their expiry.

### Authenticated account routes

Send `Authorization: Bearer <accessToken>`.

| Method | Gateway path | Behavior |
|---|---|---|
| POST | `/api/users/auth/logout-all` | Revokes all refresh sessions for the authenticated user; returns 204. |
| GET | `/api/users/me` | Returns the caller's account, including email; excludes password hash and OAuth provider ID. |
| PUT | `/api/users/me` | Updates at least one of `username`, `displayName` or `bio`; returns the account. `bio: null` clears the bio. |
| POST | `/api/users/me/avatar` | Multipart file upload, limited to 5 MiB; declared MIME type must be JPEG, PNG or WebP. Returns the updated account. |
| DELETE | `/api/users/me/avatar` | Removes the avatar reference and stored file; returns the updated account. |
| GET | `/api/users/{id}` | Returns a public profile by UUID. |
| GET | `/api/users/username/available?username=...` | Returns `{ available, message }`. |
| GET | `/api/users/username/get?username=...` | Returns a public profile by normalized username. |

Public profiles contain `id`, `username`, `displayName`, `bio`, `avatarUrl` and
`createdAt`, excluding email and authentication fields. Profile updates limit
display names to 80 characters and bios to 280 characters.

Avatar filenames use random UUIDs. Uploading a replacement removes the old file;
a failed database update triggers cleanup of the newly written file. Retrieval
checks the filename and extension before streaming it from `AVATAR_DIR`.

### Authenticated friendship routes

| Method | Gateway path | Behavior |
|---|---|---|
| POST | `/api/users/friends/requests` | `{ "addresseeId": "<UUID>" }`; creates a `PENDING` request and returns 201. |
| POST | `/api/users/friends/requests/{id}/accept` | Only the addressee can accept a pending request; returns its `ACCEPTED` record. |
| POST | `/api/users/friends/requests/{id}/decline` | Only the addressee can decline a pending request; deletes it and returns 204. |
| GET | `/api/users/friends/requests` | Returns `{ incoming: [...], outgoing: [...] }` with request IDs, participant IDs, status and timestamps. |
| GET | `/api/users/friends` | Returns an array of accepted friends' public profiles. |
| DELETE | `/api/users/friends/{userId}` | Removes an accepted friendship with that user; returns 204. |

Self-requests fail with 400. Existing relationships fail with 409, including
concurrent inserts that hit Prisma's `P2002` unique-constraint error. Removing a
pending request through `DELETE /friends/{userId}` returns 409; there is no outgoing
request cancellation endpoint. Lists currently have no server-side pagination.

## gRPC API

Service: **`identity.IdentityService`**, defined in
[src/grpc/identity.proto](src/grpc/identity.proto), on internal port 9090.

| RPC | Request | Response |
|---|---|---|
| `ValidateToken` | `{ token }` | `{ valid, user_id, username, email, expires_at }` |
| `GetUser` | `{ user_id }` | `{ user_id, username, display_name, avatar_url }` |
| `AreFriends` | `{ user_a, user_b }` | `{ are_friends }` |

`ValidateToken` verifies the HS256 signature, issuer, subject and expiry, then looks
up the user. `expires_at` is an `int64` Unix timestamp in seconds. Invalid tokens
or missing users produce `valid: false` and `expires_at: 0`. `GetUser` returns
gRPC `NOT_FOUND` for an unknown user. `AreFriends` returns true only for an accepted
relationship. Unexpected handler errors return gRPC `INTERNAL`.

Chat and org connect to `identity-service:9090` over the Docker network. The Node
handlers preserve the protobuf contract used by their Java stubs. The server starts
gRPC before opening the HTTP listener.

## Local development and checks

Use Node.js 24 and npm, matching identity CI. For a separate local development
database, run this from the repository root:

```sh
docker run -d --name guild-identity-dev-db \
  -e POSTGRES_USER=identity_dev \
  -e POSTGRES_PASSWORD=identity_dev \
  -e POSTGRES_DB=identity_dev \
  -p 127.0.0.1:55432:5432 postgres:16-alpine

docker exec guild-identity-dev-db pg_isready -U identity_dev -d identity_dev
```

Wait until `pg_isready` reports that PostgreSQL accepts connections, then:

```sh
cd application/identity-service
export DATABASE_URL='postgresql://identity_dev:identity_dev@127.0.0.1:55432/identity_dev?schema=public'
export JWT_SECRET='local-development-only-change-before-deployment'
export AVATAR_DIR=/tmp/guild-identity-dev-avatars
export IDENTITY_HTTP_PORT=8083
export GRPC_PORT=9090

npm ci
npm run generate
npx prisma migrate deploy --config prisma7.config.ts
npm run dev
```

`dotenv/config` reads `.env` in the current working directory. It does not load the
repository root's `.env` when launched from this service directory. Use exported
variables as above, or a git-ignored service-local `.env`. Compose database hostnames
are only reachable inside Docker; host development needs a reachable database URL.

Run checks from the service directory with those environment variables, using the
separate development/test database:

```sh
npm test -- src/tests
npm run build
```

The suite covers authentication, refresh/logout, profiles, avatar storage/retrieval,
friendships and gRPC. Some suites use mocks; database integration suites create and
remove test records in the configured database. Do not point them at production.
`npm run build` regenerates the Prisma client before compiling TypeScript.

[GitHub Actions](../../.github/workflows/ci-cd.yml) performs the same install,
generation, migration, test and build steps with a temporary PostgreSQL 16 service
and Node.js 24.

## Health and current integration gaps

- Docker and Gatus request `GET /health`. It reports HTTP liveness without querying
  PostgreSQL. Identity has no Actuator or Prometheus metrics endpoint.
- GitHub OAuth routes are absent. Provider fields and `GITHUB_*` variables remain
  from the earlier contract; they do not enable OAuth.
- The frontend currently calls `/auth/logout` without its required refresh-token
  body, then clears local tokens. It needs to send the body or call authenticated
  `/auth/logout-all` for server-side revocation.
- The frontend's outgoing-request cancel action uses the accepted-friend removal
  endpoint, so pending cancellations fail with 409.
- The Node gRPC listener reads `GRPC_PORT`, chat reads `IDENTITY_GRPC_PORT`, and
  org currently hardcodes port 9090. Their default settings agree.

See the [root README](../../README.md) for team contributions, module choices,
the complete database diagram and learning resources.
