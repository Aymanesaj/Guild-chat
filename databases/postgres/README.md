# PostgreSQL

Each application has its own PostgreSQL 16 container and storage:

| Application | Container / network host | Docker volume | Environment prefix |
| --- | --- | --- | --- |
| Identity | `identity-service_postgres` | `database` (existing volume retained) | `IDENTITY_POSTGRES_` |
| Organization | `org-service_postgres` | `org-service_postgres_data` | `ORG_POSTGRES_` |

Both listen on port 5432 inside the private Docker network. Neither publishes a
host port. Each container receives only its own `POSTGRES_USER`,
`POSTGRES_PASSWORD`, and `POSTGRES_DB` values from Compose. PostgreSQL creates
that database on the first start of an empty volume; no shared initialization
script is needed.

`DATABASE_URL` must match the identity credentials and database, with URL-special
characters in credentials percent-encoded. `ORG_DATASOURCE_URL` points to the
organization host and database; Compose supplies its credentials from
`ORG_POSTGRES_USER` and `ORG_POSTGRES_PASSWORD`. The `*_HOST` and `*_PORT`
variables are used by the backup daemon.

Changing initialization variables does not change credentials or databases in an
existing volume. Identity remains commented out in Compose until it is ready to run.

## Existing installation: copy organization data

The organization volume starts empty. Before starting the application with this
configuration, copy its database from the old `postgres` container. Run the
following from the repository root during a maintenance window. These commands
assume the existing organization database is named `org_service_db`; replace that
source name if your installation uses another name.

```bash
set -euo pipefail

# Stop writers and scheduled backups while the source database is copied.
docker compose stop org-service backup-service
mkdir -p backups
migration_dump="backups/org_before_split_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d org_service_db --no-owner --no-acl' \
  | gzip -9 > "$migration_dump"

# The old container must stop before identity reuses its data volume.
docker stop postgres
docker compose up -d --wait identity-service_postgres org-service_postgres

gunzip -c "$migration_dump" | docker exec -i org-service_postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
docker exec org-service_postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'

# Start the application and refresh database monitoring and backups.
docker compose up -d --build --remove-orphans
```

If another identity deployment writes to the old database, stop it before the
copy too. Keep the dump until application checks pass. The old organization
database remains in `database` as a fallback; no database or volume is deleted
by these steps. Never run both the old `postgres` container and
`identity-service_postgres` against that volume at the same time.

Backup filenames remain `postgres_*.sql.gz` for identity and `org_*.sql.gz` for
organization, so existing snapshot selection commands still work. Older SQL
dumps retain their original role ownership; when importing them into a container
with a different user, create the required roles or export with `--no-owner
--no-acl` as above.
