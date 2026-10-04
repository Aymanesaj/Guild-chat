#!/bin/sh
set -eu

: "${DISCORD_WEBHOOK_URL:?Set DISCORD_WEBHOOK_URL in .env to your replacement Discord webhook}"
case "$DISCORD_WEBHOOK_URL" in
    *[!A-Za-z0-9:/._-]*)
        echo 'DISCORD_WEBHOOK_URL contains invalid characters.' >&2
        exit 1
        ;;
esac
# Validate before inserting into YAML; never print the credential on failure.
if ! printf '%s\n' "$DISCORD_WEBHOOK_URL" | grep -Eq '^https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'; then
    echo 'DISCORD_WEBHOOK_URL must be a Discord webhook URL (without query parameters).' >&2
    exit 1
fi

umask 077
awk '{ gsub(/__DISCORD_WEBHOOK_URL__/, ENVIRON["DISCORD_WEBHOOK_URL"]); print }' \
    /etc/alertmanager/alertmanager.yml > /tmp/alertmanager.yml
unset DISCORD_WEBHOOK_URL
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml "$@"
