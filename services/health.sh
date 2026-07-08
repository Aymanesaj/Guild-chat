#!/bin/sh

set -eu

PORT="${PORT:-8080}"

mkdir -p /www
echo '{"status":"ok"}' > /www/health
echo '{"status":"ok"}' > /www/ready

exec httpd -f -p "$PORT" -h /www