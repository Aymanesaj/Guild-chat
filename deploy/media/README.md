# Media setup

Use the existing root `.env` for R2 credentials and the Media database URL/password.
The required variables are listed in `.env.example`. Keep `.env` private (`chmod
600 .env`); do not commit it or print resolved Compose settings in CI logs.

## R2 dashboard

1. Create a dedicated bucket, such as `ft-transcendence-media`. Keep **r2.dev
   public access disabled** and do not attach a public custom domain or Worker.
2. Create an R2 API token with **Object Read & Write**, choose **Apply to specific
   buckets only**, and select this bucket. Put its access key and secret in `.env`.
3. Configure CORS with this single origin:

   ```json
   [{
     "AllowedOrigins": ["https://guild-chat.tech"],
     "AllowedMethods": ["GET", "HEAD", "PUT"],
     "AllowedHeaders": ["Content-Type"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 300
   }]
   ```

4. Add lifecycle rules for prefix `tmp/`: delete objects after **1 day** and
   abort incomplete multipart uploads after **1 day**. URL expiry does not
   delete objects; lifecycle deletion is asynchronous.

Use `tmp/<uploadId>/<objectId>` for uploads, `avatars/<userId>/<mediaId>` for
avatars, and `attachments/<roomId>/<mediaId>` for attachments. Prefixes need no
folder creation. Media must validate uploads before moving them out of `tmp/`.

## Compose

The service builds from `application/media-service/Dockerfile` using
`node:24-alpine`, runs as the built-in `node` user, and starts Fastify on internal
port `8084`. Its `/health` endpoint checks that the process is responding.

```bash
docker compose config -q
docker compose up -d --build media-service
```

Media uses the shared `postgres_db` container alongside Identity and Organization,
with its own `media` database and role in the `database` volume. Set
`MEDIA_DATABASE_URL` to use `postgres_db:5432`, and keep its credentials/database
consistent with `MEDIA_POSTGRES_USER`, `MEDIA_POSTGRES_PASSWORD`, and
`MEDIA_POSTGRES_DB`. All services use the existing `private` network.
Neither Media nor its database publishes host ports, and Nginx
has no Media route. This network also permits outbound R2 HTTPS.

On a fresh volume, `databases/postgres/init-media.sh` creates the media role and
database automatically. For an existing `database` volume, initialize them before
starting Media (recreating `postgres_db` loads the new environment and script):

```bash
docker compose up -d postgres_db
docker compose exec -T postgres_db sh /docker-entrypoint-initdb.d/20-init-media.sh
docker compose up -d --build media-service
```

The script only creates missing objects; it preserves existing data and passwords.
Existing uploads also need their `MediaUpload` records transferred from the old
database; pointing Media at an empty database makes old images unavailable even
when the objects still exist in R2. After applying Media migrations to the shared
database, recover those records on the machine hosting the app:

```bash
# Find the old container, including stopped containers.
docker ps -a --filter label=com.docker.compose.service=media-postgres --format '{{.Names}}'
bash databases/postgres/recover-media.sh <old-container-name>
```

The recovery script saves both database dumps under `backups/media-recovery-*`,
then merges missing IDs in a transaction. It preserves new uploads and existing
records, including deletion/status changes; it can be rerun safely. It temporarily
starts a stopped source container and stops it again afterward. Run this only
after Media has switched to the shared database and no service writes to the old
database. It does not alter R2 objects or restore objects already deleted from R2.

Keep the old `media_database` volume until old images load successfully. Deployment
uses `--remove-orphans`, so the old container may already be gone. In that case:

```bash
docker volume ls --filter label=com.docker.compose.volume=media_database --format '{{.Name}}'
bash databases/postgres/recover-media.sh --volume <old-volume-name>
```

This mode temporarily mounts the existing volume in an isolated Postgres 16
container, then removes that temporary container while retaining the volume.

This is a runnable Fastify starter. R2 operations, database access, upload routes
and gRPC still need implementation; no gRPC server runs yet.
The intended browser flow remains Nginx → Identity/Chat, with authorized,
short-lived presigned URLs for R2 access.

Add Media database backup coverage before storing production metadata; the
existing backup service does not include this database.

References: [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
