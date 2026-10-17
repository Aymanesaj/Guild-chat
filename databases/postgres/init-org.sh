#!/bin/sh
set -eu

# The official image creates the identity database from POSTGRES_DB.
# Create the organization role and database in the same instance.
psql -X --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 \
    --set org_user="$ORG_POSTGRES_USER" \
    --set org_password="$ORG_POSTGRES_PASSWORD" \
    --set org_db="$ORG_POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'org_user', :'org_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'org_user')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'org_db', :'org_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'org_db')
\gexec
SQL
