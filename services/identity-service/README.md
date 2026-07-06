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

### Local development

From `services/identity-service/demo`:

```sh
MAVEN_USER_HOME=/tmp/maven ./mvnw test
```

From the repo root:

```sh
docker compose up --build identity-service
```
