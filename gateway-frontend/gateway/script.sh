#!/bin/sh
set -eu
umask 077

export DOMAIN="${DOMAIN:-localhost}"
case "$DOMAIN" in
    *[!A-Za-z0-9.-]* | .* | *.)
        echo 'DOMAIN must be a hostname, without a scheme, port, or path.' >&2
        exit 1
        ;;
esac
# Substitute only our placeholder, preserving Nginx variables such as $host and $1.
envsubst '${DOMAIN}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# This directory is backed by the nginx_tls volume in Compose.
mkdir -p /etc/nginx/conf
if [ -e /certs/fullchain.pem ] || [ -e /certs/privkey.pem ]; then
    cert=/certs/fullchain.pem
    key=/certs/privkey.pem
elif [ -e /certs/server.crt ] || [ -e /certs/server.key ]; then
    cert=/certs/server.crt
    key=/certs/server.key
else
    cert=
    key=
fi

if [ -n "$cert" ]; then
    if [ ! -r "$cert" ] || [ ! -r "$key" ]; then
        echo 'Mounted TLS certificate/key is missing or unreadable. See deploy/README.md for ownership and permissions.' >&2
        exit 1
    fi
    echo 'Applying mounted TLS certificates...'
    cp -f "$cert" /etc/nginx/conf/server.crt
    cp -f "$key" /etc/nginx/conf/server.key
elif [ ! -s /etc/nginx/conf/server.crt ] || [ ! -s /etc/nginx/conf/server.key ]; then
    echo 'Generating persistent self-signed TLS certificates...'
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/conf/server.key \
        -out /etc/nginx/conf/server.crt \
        -subj "/CN=${DOMAIN}" \
        -addext "subjectAltName=DNS:${DOMAIN},DNS:www.${DOMAIN},DNS:status.${DOMAIN},DNS:status.localhost,DNS:localhost,IP:127.0.0.1"
fi

chmod 600 /etc/nginx/conf/server.key
chmod 644 /etc/nginx/conf/server.crt
exec /docker-entrypoint.sh "$@"
