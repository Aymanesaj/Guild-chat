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
If the former `media-postgres` container has metadata to keep, stop Media writes,
dump that database and restore it into the shared instance before starting Media.
The old `media_database` volume is not copied or deleted by this change; retain it
until the transfer is verified, then remove the old container.

This is a runnable Fastify starter. R2 operations, database access, upload routes
and gRPC still need implementation; no gRPC server runs yet.
The intended browser flow remains Nginx → Identity/Chat, with authorized,
short-lived presigned URLs for R2 access.

Add Media database backup coverage before storing production metadata; the
existing backup service does not include this database.

References: [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
