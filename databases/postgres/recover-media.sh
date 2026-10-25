#!/usr/bin/env bash
# Merge old media metadata into the shared database without replacing new uploads.
set -euo pipefail
umask 077

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_container="${1:?Usage: recover-media.sh OLD_CONTAINER [SHARED_CONTAINER] | --volume OLD_VOLUME [SHARED_CONTAINER]}"
target_container="${2:-postgres_db}"
source_volume=""
if [ "$source_container" = --volume ]; then
    source_volume="${2:?Provide the existing old media volume name}"
    target_container="${3:-postgres_db}"
    source_container="media-recovery-$$"
    docker volume inspect "$source_volume" >/dev/null
    if [ -n "$(docker ps -q --filter "volume=$source_volume")" ]; then
        echo "The source volume is in use. Pass its existing container name instead." >&2
        exit 1
    fi
fi
if [ "$source_container" = "$target_container" ]; then
    echo "Source and target containers must be different." >&2
    exit 1
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$target_container")" != true ]; then
    echo "Start the shared PostgreSQL container and apply Media migrations first." >&2
    exit 1
fi

started_source=false
created_source=false
remote_csv=""
cleanup() {
    if [ -n "$remote_csv" ]; then
        docker exec "$target_container" rm -f "$remote_csv" >/dev/null 2>&1 || true
    fi
    if [ "$created_source" = true ]; then
        docker rm -f "$source_container" >/dev/null 2>&1 || true
    elif [ "$started_source" = true ]; then
        docker stop "$source_container" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
if [ -n "$source_volume" ]; then
    # No password is supplied: an accidentally empty volume must fail to initialize.
    docker create --name "$source_container" --network none \
        --mount "type=volume,source=$source_volume,target=/var/lib/postgresql/data" \
        -e POSTGRES_USER=media -e POSTGRES_DB=media postgres:16-alpine >/dev/null
    created_source=true
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$source_container")" != true ]; then
    docker start "$source_container" >/dev/null
    started_source=true
fi
for attempt in {1..30}; do
    if docker exec "$source_container" sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

source_psql() {
    docker exec -i "$source_container" sh -c \
        'exec psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"' sh "$@"
}
target_psql() {
    docker exec -i "$target_container" sh -c \
        'exec psql -X -U "$POSTGRES_USER" -d "${MEDIA_POSTGRES_DB:-media}" -v ON_ERROR_STOP=1 "$@"' sh "$@"
}

# Fail before modifying anything if either database is missing its media table.
source_psql -Atc 'SELECT count(*) AS source_records FROM public."MediaUpload";'
target_psql -Atc 'SELECT count(*) AS target_records FROM public."MediaUpload";'
backup_root="${MEDIA_RECOVERY_BACKUP_DIR:-$project_dir/backups}"
mkdir -p "$backup_root"
backup_dir="$(mktemp -d "$backup_root/media-recovery-XXXXXXXX")"
docker exec "$source_container" sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/source.dump"
docker exec "$target_container" sh -c \
    'exec pg_dump -U "$POSTGRES_USER" -d "${MEDIA_POSTGRES_DB:-media}" -Fc' > "$backup_dir/target-before.dump"
echo "Database backups saved to $backup_dir"

# Explicit columns allow older source schemas without later nullable columns.
columns="$(source_psql -Atc "SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.\"MediaUpload\"'::regclass AND attnum > 0 AND NOT attisdropped;")"
source_psql -c 'COPY public."MediaUpload" TO STDOUT WITH (FORMAT csv)' > "$backup_dir/source.csv"
remote_csv="$(docker exec "$target_container" mktemp /tmp/media-recovery-XXXXXXXX)"
docker cp "$backup_dir/source.csv" "$target_container:$remote_csv"

# Only missing IDs are inserted. Other uniqueness conflicts abort the transaction.
# Existing records (including newer deletion/status changes) always win.
target_psql <<SQL
BEGIN;
SET LOCAL lock_timeout = '15s';
CREATE TEMP TABLE recovered_media (LIKE public."MediaUpload" INCLUDING DEFAULTS) ON COMMIT DROP;
\copy recovered_media ($columns) FROM '$remote_csv' WITH (FORMAT csv)
LOCK TABLE public."MediaUpload" IN SHARE ROW EXCLUSIVE MODE;
WITH inserted AS (
    INSERT INTO public."MediaUpload" ($columns)
    SELECT $columns FROM recovered_media
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
SELECT count(*) AS recovered_records FROM inserted;
SELECT count(*) AS total_records FROM public."MediaUpload";
COMMIT;
SQL
echo "Recovery complete. Existing records and new uploads were preserved."
