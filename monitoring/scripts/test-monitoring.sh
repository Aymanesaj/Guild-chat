#!/bin/bash
# Offline container checks after the required images have been pulled/built.
set -euo pipefail
cd "$(dirname "$0")/../.."

docker compose config -q
bash -n monitoring/metrics-exporters/docker-exporter/script.sh
sh -n monitoring/prometheus/start-alertmanager.sh

docker build -q -t monitoring-exporter-check monitoring/metrics-exporters/docker-exporter
docker run --rm --network none -v "$PWD/monitoring/metrics-exporters/docker-exporter:/checks:ro" \
    --entrypoint bash monitoring-exporter-check /checks/test.sh

docker run --rm --network none -v "$PWD/monitoring/prometheus:/checks:ro" \
    --entrypoint /bin/promtool prom/prometheus check rules /checks/alert_rules.yml
docker run --rm --network none -v "$PWD/monitoring/prometheus:/checks:ro" -w /checks \
    --entrypoint /bin/promtool prom/prometheus test rules alert_rules.test.yml

docker run --rm --network none \
    -e DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123/test_token \
    -v "$PWD/monitoring/prometheus:/etc/alertmanager:ro" --entrypoint /bin/sh prom/alertmanager \
    -c 'sh /etc/alertmanager/start-alertmanager.sh --version >/dev/null && amtool check-config /tmp/alertmanager.yml'

for webhook in '' 'not-a-url' $'https://discord.com/api/webhooks/123/test\ninjected'; do
    if docker run --rm --network none -e DISCORD_WEBHOOK_URL="$webhook" \
        -v "$PWD/monitoring/prometheus:/etc/alertmanager:ro" --entrypoint /bin/sh prom/alertmanager \
        /etc/alertmanager/start-alertmanager.sh --version >/dev/null 2>&1; then
        echo 'Alertmanager accepted an empty or invalid webhook' >&2
        exit 1
    fi
done
printf 'Monitoring checks passed (no Discord notifications sent).\n'
