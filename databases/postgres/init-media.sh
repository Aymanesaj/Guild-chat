#!/bin/sh
set -eu

# Keep media metadata in its own database on the shared PostgreSQL instance.
psql -X --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
    --set media_user="$MEDIA_POSTGRES_USER" \
    --set media_password="$MEDIA_POSTGRES_PASSWORD" \
    --set media_db="$MEDIA_POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'media_user', :'media_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'media_user')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'media_db', :'media_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'media_db')
\gexec
SQL
